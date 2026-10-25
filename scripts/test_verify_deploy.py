#!/usr/bin/env python3
"""Equivalence-class + red-team suite for scripts/verify_deploy.py.

Stdlib only, no network, no token: every case is a synthetic API response fed
through --fixture. Run it as:

    python3 scripts/test_verify_deploy.py

Each case asserts the EXIT CODE, because the exit code is the contract — the
whole point of the tool is that a measurement failure (2) can never be mistaken
for a failed deploy (1).

The one class that is NOT fixtured is the live skipped-build case: production is
genuinely one skipped deployment behind, so `python3 scripts/verify_deploy.py`
with no arguments exercises it against the real API.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TOOL = os.path.join(HERE, "verify_deploy.py")

PASS, FAIL, UNMEASURABLE, PENDING = 0, 1, 2, 3
NAMES = {0: "PASS", 1: "FAIL", 2: "UNMEASURABLE", 3: "PENDING"}

GOOD_SHA = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0"
OTHER_SHA = "0f9e8d7c6b5a40392817263544556677889900aa"


def deployment(**over):
    """A healthy, serving production deployment; override fields per case."""
    d = {
        "id": "deadbeefcafef00d",
        "environment": "production",
        "created_on": "2026-10-24T12:00:00Z",
        "is_skipped": False,
        "latest_stage": {"name": "deploy", "status": "success"},
        "deployment_trigger": {"type": "github:push",
                               "metadata": {"commit_hash": GOOD_SHA}},
        "aliases": ["https://elevationary.ai", "https://elevationary.com"],
    }
    d.update(over)
    return d


def envelope(deployments, success=True):
    return {"success": success, "errors": [], "result": deployments}


def run(body, *args):
    """Write `body` as a fixture and run the tool. Returns (exit_code, stdout+stderr)."""
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        fh.write(body if isinstance(body, str) else json.dumps(body))
        path = fh.name
    try:
        # Deliberately hostile environment: no token at all. Fixture mode must not need one.
        env = {k: v for k, v in os.environ.items() if k != "CLOUDFLARE_API_TOKEN"}
        out = subprocess.run(
            [sys.executable, TOOL, "--fixture", path, *args],
            capture_output=True, text=True, env=env,
        )
        return out.returncode, (out.stdout + out.stderr)
    finally:
        os.unlink(path)


CASES = [
    # --- Stage 2.5: equivalence classes over the deployment state space ---
    ("built, commit matches, holds the production alias",
     envelope([deployment()]), [f"--expect-commit={GOOD_SHA}"], PASS),

    ("build SKIPPED by [skip ci] -- terminal, must not wait",
     envelope([deployment(is_skipped=True, aliases=None,
                          latest_stage={"name": "queued", "status": "idle"})]),
     [f"--expect-commit={GOOD_SHA}", "--wait=120", "--interval=1"], FAIL),

    ("build still running",
     envelope([deployment(latest_stage={"name": "build", "status": "active"},
                          aliases=None)]),
     [f"--expect-commit={GOOD_SHA}"], PENDING),

    ("build failed",
     envelope([deployment(latest_stage={"name": "build", "status": "failure"},
                          aliases=None)]),
     [f"--expect-commit={GOOD_SHA}"], FAIL),

    ("build canceled",
     envelope([deployment(latest_stage={"name": "deploy", "status": "canceled"},
                          aliases=None)]),
     [f"--expect-commit={GOOD_SHA}"], FAIL),

    ("STALE -- no deployment exists for the pushed commit",
     envelope([deployment(deployment_trigger={"type": "github:push",
                                              "metadata": {"commit_hash": OTHER_SHA}})]),
     [f"--expect-commit={GOOD_SHA}"], FAIL),

    ("deployed but alias not yet propagated",
     envelope([deployment(aliases=[])]), [f"--expect-commit={GOOD_SHA}"], PENDING),

    ("short commit hash on either side still compares equal",
     envelope([deployment(deployment_trigger={"type": "github:push",
                                              "metadata": {"commit_hash": GOOD_SHA[:7]}})]),
     [f"--expect-commit={GOOD_SHA}"], PASS),

    ("commit comparison explicitly disabled",
     envelope([deployment(deployment_trigger={"type": "github:push",
                                              "metadata": {"commit_hash": OTHER_SHA}})]),
     ["--expect-commit="], PASS),

    ("ad_hoc trigger (a forced build) is as valid as a push",
     envelope([deployment(deployment_trigger={"type": "ad_hoc",
                                              "metadata": {"commit_hash": GOOD_SHA}})]),
     [f"--expect-commit={GOOD_SHA}"], PASS),

    ("newest is a skipped push, an older deployment is the one serving",
     envelope([deployment(id="newest00", created_on="2026-10-24T13:00:00Z",
                          is_skipped=True, aliases=None,
                          latest_stage={"name": "queued", "status": "idle"}),
               deployment(id="serving0", created_on="2026-10-24T12:00:00Z")]),
     [f"--expect-commit={GOOD_SHA}"], FAIL),

    ("preview deployments are ignored when picking production",
     envelope([dict(deployment(id="preview0", environment="preview",
                               created_on="2026-10-24T14:00:00Z")),
               deployment(id="prodlive", created_on="2026-10-24T12:00:00Z")]),
     [f"--expect-commit={GOOD_SHA}"], PASS),

    # --- Stage 3: red-team. Every one of these MUST be UNMEASURABLE, never FAIL. ---
    ("no production deployments at all",
     envelope([]), [f"--expect-commit={GOOD_SHA}"], UNMEASURABLE),

    ("only preview deployments exist",
     envelope([deployment(environment="preview")]),
     [f"--expect-commit={GOOD_SHA}"], UNMEASURABLE),

    ("API reports success=false",
     envelope([deployment()], success=False),
     [f"--expect-commit={GOOD_SHA}"], UNMEASURABLE),

    ("response body is not JSON (e.g. an HTML error page)",
     "<html><body>503 Service Unavailable</body></html>",
     [f"--expect-commit={GOOD_SHA}"], UNMEASURABLE),

    ("response body is empty",
     "", [f"--expect-commit={GOOD_SHA}"], UNMEASURABLE),

    # RT-1: this case FAILED on first run -- the tool reported PENDING ("a build is in
    # progress (/)"), so a --wait run would have polled to timeout and then said nothing.
    # The expectation below is UNMEASURABLE, not FAIL: an unreadable record is an
    # instrument problem, and calling it a failed deploy is the false alarm that drives
    # destructive remediation.
    ("malformed deployment -- every field missing",
     envelope([{"environment": "production", "created_on": "2026-10-24T12:00:00Z"}]),
     [f"--expect-commit={GOOD_SHA}"], UNMEASURABLE),

    # RT-1b: stage readable and successful, but no commit_hash -- must not PASS, because
    # the origin/main guarantee cannot be checked. The quiet direction is the dangerous one.
    ("deployed and aliased but commit_hash absent",
     envelope([deployment(deployment_trigger={"type": "github:push", "metadata": {}})]),
     [f"--expect-commit={GOOD_SHA}"], UNMEASURABLE),

    ("...and with the commit check disabled, the same record is a legitimate PASS",
     envelope([deployment(deployment_trigger={"type": "github:push", "metadata": {}})]),
     ["--expect-commit="], PASS),

    ("result is null",
     {"success": True, "errors": [], "result": None},
     [f"--expect-commit={GOOD_SHA}"], UNMEASURABLE),
]


def main() -> int:
    width = max(len(name) for name, *_ in CASES)
    failures = []
    for name, body, args, want in CASES:
        got, output = run(body, *args)
        ok = got == want
        print(f"{'ok  ' if ok else 'FAIL'}  {name:<{width}}  want={NAMES[want]:<12} got={NAMES.get(got, got)}")
        if not ok:
            failures.append((name, want, got, output.strip()))

    print()
    print(f"{len(CASES) - len(failures)}/{len(CASES)} cases pass")
    for name, want, got, output in failures:
        print(f"\n--- {name}: wanted {NAMES[want]}, got {NAMES.get(got, got)} ---\n{output}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
