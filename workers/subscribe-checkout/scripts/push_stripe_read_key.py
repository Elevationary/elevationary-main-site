#!/usr/bin/env python3
"""
Push STRIPE_READ_KEY (Live restricted key, scope: checkout.sessions:read +
subscriptions:read) to the subscribe-checkout Worker's secret store.

Reads value via dotenv pattern from ~/.elevationary/secrets.env. Pipes value
into `wrangler secret put` via stdin so the value never appears in process
args / argv / shell history.

Usage:
  python3 scripts/push_stripe_read_key.py --env preview
  python3 scripts/push_stripe_read_key.py --env production
"""
import argparse
import os
import subprocess
import sys
from pathlib import Path

from dotenv import load_dotenv

SECRETS_PATH = Path.home() / ".elevationary" / "secrets.env"
PROJECT_ROOT = Path(__file__).resolve().parent.parent
WRANGLER = PROJECT_ROOT / "node_modules" / ".bin" / "wrangler"
SECRET_NAME = "STRIPE_READ_KEY"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--env", required=True, choices=["preview", "production"])
    args = ap.parse_args()

    load_dotenv(str(SECRETS_PATH), override=False)
    value = os.environ.get(SECRET_NAME, "")
    if not value:
        sys.exit(f"ERROR: {SECRET_NAME} not set in {SECRETS_PATH}")

    cmd = [str(WRANGLER), "secret", "put", SECRET_NAME, "--env", args.env]
    print(f"Pushing {SECRET_NAME} to Worker (env={args.env})")
    proc = subprocess.run(
        cmd,
        input=value + "\n",
        text=True,
        capture_output=True,
        cwd=str(PROJECT_ROOT),
    )
    # stdout from wrangler secret put echoes the secret NAME only; never the value.
    if proc.stdout:
        sys.stdout.write(proc.stdout)
    if proc.stderr:
        sys.stderr.write(proc.stderr)
    if proc.returncode != 0:
        sys.exit(f"wrangler secret put failed with rc={proc.returncode}")
    print(f"\n{SECRET_NAME} pushed to env={args.env}.")


if __name__ == "__main__":
    main()
