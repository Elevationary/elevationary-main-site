#!/usr/bin/env python3
"""
Pushes Worker secrets to Cloudflare via `wrangler secret bulk`. Reads
STRIPE_TEST_KEY (or STRIPE_LIVE_KEY) from ~/.elevationary/secrets.env via
the fleet's dotenv pattern, plus the Stripe Price IDs from
scripts/stripe_test_ids.json (or stripe_live_ids.json).

Wrangler `secret bulk` accepts JSON via stdin and writes each kv into the
Worker's secret store atomically. Wrangler prints the secret NAMES on success
but never the values — secret never appears in process args or stdout.
"""
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

from dotenv import load_dotenv

SECRETS_PATH = Path.home() / ".elevationary" / "secrets.env"
PROJECT_ROOT = Path(__file__).resolve().parent.parent
WRANGLER = PROJECT_ROOT / "node_modules" / ".bin" / "wrangler"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--env", required=True, choices=["preview", "production"])
    ap.add_argument("--ids-file", default=None,
                    help="JSON file with prices map (default: stripe_test_ids.json for preview, stripe_live_ids.json for production)")
    args = ap.parse_args()

    load_dotenv(str(SECRETS_PATH), override=False)

    if args.env == "preview":
        key_name = "STRIPE_TEST_KEY"
        ids_default = PROJECT_ROOT / "scripts" / "stripe_test_ids.json"
    else:
        key_name = "STRIPE_LIVE_KEY"
        ids_default = PROJECT_ROOT / "scripts" / "stripe_live_ids.json"

    stripe_key = os.environ.get(key_name, "")
    if not stripe_key:
        sys.exit(f"ERROR: {key_name} not set in ~/.elevationary/secrets.env")

    ids_path = Path(args.ids_file) if args.ids_file else ids_default
    if not ids_path.exists():
        sys.exit(f"ERROR: ids file not found: {ids_path}")

    with ids_path.open() as f:
        ids = json.load(f)

    prices = ids.get("prices", {})
    if not prices:
        sys.exit(f"ERROR: no prices found in {ids_path}")

    # Build the secrets bulk payload.
    payload = {"STRIPE_SECRET_KEY": stripe_key}
    payload.update(prices)

    print(f"Pushing {len(payload)} secrets to Worker (env={args.env}):")
    for k in payload:
        print(f"  - {k}")

    # `wrangler secret bulk` reads JSON from stdin.
    cmd = [str(WRANGLER), "secret", "bulk", "--env", args.env]
    proc = subprocess.run(
        cmd,
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        cwd=str(PROJECT_ROOT),
    )
    # Wrangler may emit progress on stderr; passthrough.
    if proc.stdout:
        # stdout from wrangler secret bulk only ever names secrets, never values.
        sys.stdout.write(proc.stdout)
    if proc.stderr:
        sys.stderr.write(proc.stderr)
    if proc.returncode != 0:
        sys.exit(f"wrangler secret bulk failed with rc={proc.returncode}")
    print("\nDone.")


if __name__ == "__main__":
    main()
