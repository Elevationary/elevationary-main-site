#!/usr/bin/env python3
"""Assert that a push to `main` actually deployed elevationary.com.

WHY THIS EXISTS — finding F3 of ORS_esc149_release_first_push_deploy_2026_08_31.md
(filed as P4D3 task_e99e08df):

`elevationary-main-site` is Git-connected on Cloudflare Pages, so `git push origin main`
*is* the production deploy. Cloudflare Pages honours `[skip ci]`, and TimeKeeper
auto-generates `chore: update timelog [skip ci]` commits. When a content push lands on
one of those as HEAD, Pages creates a deployment record and SKIPS THE BUILD ENTIRELY,
while every ordinary check reports success:

    git push exit code              -> 0        (says nothing about the deploy)
    Pages deployment created        -> yes      (created != built)
    wrangler pages deployment list  -> `Idle`   (identical to a healthy queue)
    curl https://elevationary.com/  -> HTTP 200 (from the STALE deployment)

Measured 2026-10-03: 4 of the last 25 production deployments were skipped
(2026-06-24, 07-12, 08-31, and 2026-09-20 — three weeks AFTER a one-off manual
remediation, unnoticed). Roughly half the commits in a typical push carry the token,
so this is near a coin flip, not an edge case.

TWO DESIGN RULES THIS TOOL EXISTS TO HOLD:

  1. `is_skipped: True` is an IMMEDIATE TERMINAL FAILURE, even under --wait.
     A skipped deployment never enters a stage whose *status* is `skipped` — it
     reports latest_stage `queued/idle` forever. A naive waiter therefore times out
     indistinguishably from a slow build, which is how the 2026-09-20 skip went
     unnoticed for five weeks.

  2. A MEASUREMENT FAILURE IS NEVER A DEPLOY FAILURE. No token, no network, bad
     JSON, API error -> exit 2 UNMEASURABLE, never exit 1 FAIL. On 2026-10-03 a
     sibling harness with no CA trust store scored its own transport failures as
     measurements and reported "36/36 surfaces regressed" on a completely healthy
     site; the correct-looking response to that was a destructive rollback. A false
     alarm is worse than a false clean, because it drives destructive remediation.

EXIT CODES
    0  PASS          newest production deployment built, matches origin/main, and serves the site
    1  FAIL          the push did not deploy (skipped, stale, failed, or canceled)
    2  UNMEASURABLE  could not measure -- NOT a verdict about the deploy
    3  PENDING       a build is genuinely in progress; nothing is wrong yet

USAGE
    export CLOUDFLARE_API_TOKEN=...          # read from env only, never an argument
    git push origin main
    python3 scripts/verify_deploy.py --wait 300
"""

from __future__ import annotations

import argparse
import json
import os
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.request

PROJECT = "elevationary-main-site"
# Non-secret account identifier; already present in this repo's committed docs.
DEFAULT_ACCOUNT = "ef1f0428ea72ee0f92c38067bcba8812"
PROD_HOSTNAME = "elevationary.com"

PASS, FAIL, UNMEASURABLE, PENDING = 0, 1, 2, 3

TERMINAL_BAD = {"failure", "canceled"}


class Unmeasurable(Exception):
    """Raised when the state could not be read. Never a verdict about the deploy."""


def _token() -> str:
    tok = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
    if not tok:
        raise Unmeasurable(
            "CLOUDFLARE_API_TOKEN is not set. This is a measurement gap, not a failed "
            "deploy -- do not conclude anything about production from it."
        )
    return tok


def _api(path: str, account: str, method: str = "GET") -> dict:
    """Call the Pages API. READ-ONLY -- nothing in this tool passes a non-GET method. Tries urllib with an explicit CA bundle, falls back to curl.

    Any transport, auth or parse problem raises Unmeasurable -- never a FAIL.
    """
    url = f"https://api.cloudflare.com/client/v4/accounts/{account}{path}"
    headers = {"Authorization": f"Bearer {_token()}"}
    errors = []

    # Transport 1: urllib with certifi's CA bundle when available. The 2026-10-03
    # harness defect was an interpreter shipping no usable trust store, so the bundle
    # is pinned explicitly rather than left to the default.
    try:
        try:
            import certifi

            ctx = ssl.create_default_context(cafile=certifi.where())
        except ImportError:
            ctx = ssl.create_default_context()
        req = urllib.request.Request(url, headers=headers, method=method)
        with urllib.request.urlopen(req, context=ctx, timeout=30) as resp:
            return _parse(resp.read().decode("utf-8"), "urllib")
    except Unmeasurable:
        raise
    except Exception as exc:  # transport-level only
        errors.append(f"urllib: {type(exc).__name__}: {exc}")

    # Transport 2: curl, which carries the system trust store independently.
    # The token goes in a header on stdin-free argv; -s keeps it out of the output.
    try:
        out = subprocess.run(
            ["curl", "-s", "--max-time", "30", "-X", method,
             "-H", f"Authorization: Bearer {_token()}", url],
            capture_output=True, text=True, check=False,
        )
        if out.returncode != 0:
            raise RuntimeError(f"curl exit {out.returncode}: {out.stderr.strip()[:200]}")
        return _parse(out.stdout, "curl")
    except Unmeasurable:
        raise
    except Exception as exc:
        errors.append(f"curl: {type(exc).__name__}: {exc}")

    raise Unmeasurable("every transport failed -- " + " | ".join(errors))


def _parse(body: str, transport: str) -> dict:
    try:
        data = json.loads(body)
    except ValueError as exc:
        raise Unmeasurable(f"{transport} returned non-JSON ({exc}); first 200 chars: {body[:200]!r}")
    if not data.get("success"):
        raise Unmeasurable(f"{transport}: API reported success=false; errors={data.get('errors')}")
    data["_transport"] = transport
    return data


def _expected_commit(explicit: str | None) -> str | None:
    """The commit production is supposed to be serving. None means 'do not compare'."""
    if explicit == "":
        return None
    if explicit:
        return explicit.strip()
    try:
        out = subprocess.run(
            ["git", "rev-parse", "origin/main"],
            capture_output=True, text=True, check=True,
        )
        return out.stdout.strip()
    except Exception as exc:
        raise Unmeasurable(
            f"could not read origin/main ({exc}); pass --expect-commit <sha> or "
            "--expect-commit '' to skip the comparison"
        )


def _production(deployments: list[dict]) -> list[dict]:
    prod = [d for d in deployments if d.get("environment") == "production"]
    prod.sort(key=lambda d: d.get("created_on") or "", reverse=True)
    return prod


def _describe(d: dict) -> str:
    stage = d.get("latest_stage") or {}
    meta = (d.get("deployment_trigger") or {}).get("metadata") or {}
    return (
        f"{d.get('id', '?')[:8]} commit={str(meta.get('commit_hash', '?'))[:7]} "
        f"trigger={(d.get('deployment_trigger') or {}).get('type')} "
        f"is_skipped={d.get('is_skipped')} "
        f"stage={stage.get('name')}/{stage.get('status')} "
        f"aliases={d.get('aliases')}"
    )


def _evaluate(newest: dict, expected: str | None) -> tuple[int, str]:
    """Classify one deployment. Returns (exit_code, human explanation)."""
    meta = (newest.get("deployment_trigger") or {}).get("metadata") or {}
    commit = str(meta.get("commit_hash") or "")
    stage = newest.get("latest_stage") or {}
    status = (stage.get("status") or "").lower()
    name = (stage.get("name") or "").lower()
    aliases = newest.get("aliases") or []

    # RULE 1 -- terminal, and deliberately checked before anything else.
    if newest.get("is_skipped") is True:
        return FAIL, (
            "THE BUILD WAS SKIPPED. The newest production deployment carries "
            "is_skipped=True, which means Cloudflare Pages honoured a `[skip ci]` token "
            "on the pushed HEAD and never built. Production is still serving the "
            "PREVIOUS deployment. This is terminal -- waiting cannot change it, because "
            "a skipped deployment reports latest_stage queued/idle forever."
        )

    # RT-1 (Stage 3): a deployment record we cannot read is a MEASUREMENT gap, not a
    # failed deploy. Without this guard an all-fields-missing record fell through to the
    # PENDING default and reported "a build is in progress (/)" -- which under --wait
    # polls to timeout and then says nothing, the same silent shape as the F3 defect
    # this tool exists to close. Classifying it FAIL would be worse still: a false alarm
    # drives destructive remediation.
    if not name or not status:
        raise Unmeasurable(
            f"deployment {newest.get('id', '?')} has no readable latest_stage "
            f"({stage!r}) -- cannot tell whether it built."
        )

    if status in TERMINAL_BAD:
        return FAIL, f"the build reached {name}/{status} -- it did not deploy."

    # RT-1b (Stage 3): if we were asked to confirm a commit and the record does not
    # carry one, the comparison cannot be performed. Returning PASS here would be a
    # quiet false clean -- the dangerous direction.
    if expected and not commit:
        raise Unmeasurable(
            f"deployment {newest.get('id', '?')} carries no commit_hash, so it cannot be "
            f"confirmed as origin/main ({expected[:7]}). Re-run with --expect-commit '' "
            "only if you genuinely do not need that guarantee."
        )

    if expected and commit and not (commit.startswith(expected) or expected.startswith(commit)):
        return FAIL, (
            f"the newest production deployment is for commit {commit[:7]}, but origin/main "
            f"is {expected[:7]}. No deployment exists for the pushed commit."
        )

    if name == "deploy" and status == "success":
        if any(PROD_HOSTNAME in a for a in aliases):
            return PASS, (
                f"deployed and serving. It holds the {PROD_HOSTNAME} alias, which is the "
                "field that names the deployment actually answering the site."
            )
        return PENDING, (
            "the build succeeded but this deployment does not yet hold the "
            f"{PROD_HOSTNAME} alias. Usually alias propagation; re-check shortly."
        )

    return PENDING, f"a build is in progress ({name}/{status})."


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="Assert that the newest production Pages deployment actually built "
                    "and serves origin/main. Closes finding F3 (the `[skip ci]` "
                    "silent-non-deploy class).",
        epilog="Exit codes: 0 PASS | 1 FAIL | 2 UNMEASURABLE (not a verdict) | 3 PENDING",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--account", default=os.environ.get("CLOUDFLARE_ACCOUNT_ID", DEFAULT_ACCOUNT),
                    help="Cloudflare account id (default: this site's account)")
    ap.add_argument("--expect-commit", default=None, metavar="SHA",
                    help="commit production should be serving; default `git rev-parse "
                         "origin/main`. Pass '' to skip the comparison.")
    ap.add_argument("--wait", type=int, default=0, metavar="SECONDS",
                    help="poll until terminal, up to SECONDS (default 0: single shot). "
                         "A skipped build fails immediately regardless.")
    ap.add_argument("--interval", type=int, default=10, metavar="SECONDS",
                    help="poll interval when --wait is used (default 10)")
    ap.add_argument("--fixture", default=None, metavar="PATH",
                    help="read an API response from a JSON file instead of calling the "
                         "API. For testing this tool; performs no network call.")
    args = ap.parse_args(argv)

    def read_state() -> dict:
        if args.fixture:
            # RT-5 (Stage 3): an unreadable fixture crashed with a FileNotFoundError
            # traceback, which exits 1 -- i.e. a typo in a path reported "the deploy
            # failed". Every read problem is UNMEASURABLE.
            try:
                with open(args.fixture, encoding="utf-8") as fh:
                    body = fh.read()
            except OSError as exc:
                raise Unmeasurable(f"could not read fixture {args.fixture}: {exc}")
            return _parse(body, f"fixture:{args.fixture}")
        return _api(f"/pages/projects/{PROJECT}/deployments?per_page=10", args.account)

    try:
        expected = _expected_commit(args.expect_commit)
        deadline = time.time() + max(0, args.wait)
        while True:
            data = read_state()
            prod = _production(data.get("result") or [])
            if not prod:
                raise Unmeasurable("the API returned no production deployments at all")
            newest = prod[0]
            code, why = _evaluate(newest, expected)
            if code != PENDING or time.time() >= deadline:
                break
            print(f"… PENDING: {why} (retrying in {args.interval}s)", file=sys.stderr)
            time.sleep(args.interval)
    except Unmeasurable as exc:
        print(f"UNMEASURABLE: {exc}", file=sys.stderr)
        print("This says NOTHING about production. Do not roll back, do not redeploy, "
              "and do not record a deploy result on the strength of it.", file=sys.stderr)
        return UNMEASURABLE

    label = {PASS: "PASS", FAIL: "FAIL", PENDING: "PENDING"}[code]
    print(f"{label}: {why}")
    print(f"  newest production: {_describe(newest)}")
    if expected:
        print(f"  origin/main      : {expected[:7]}")
    serving = next((d for d in prod if any(PROD_HOSTNAME in a for a in (d.get('aliases') or []))), None)
    if serving is not None and serving is not newest:
        print(f"  actually serving : {_describe(serving)}")

    if code == FAIL:
        print()
        print("REMEDIATION -- force a build without rewriting history:")
        print(f"  curl -X POST -H \"Authorization: Bearer $CLOUDFLARE_API_TOKEN\" \\")
        print(f"    https://api.cloudflare.com/client/v4/accounts/{args.account}"
              f"/pages/projects/{PROJECT}/deployments -F branch=main")
        print("  (an `ad_hoc` trigger is not subject to `[skip ci]`; that is exactly how")
        print("   deployment 7de98dd2 was forced after the 2026-08-31 skip)")
        print("  This tool deliberately does NOT run that command: creating a production")
        print("  deployment is an outward-facing action and belongs to whoever is pushing.")

    return code


if __name__ == "__main__":
    sys.exit(main())
