#!/usr/bin/env python3
"""
Push CF Access service-token pair (CF_ACCESS_CLIENT_ID + CF_ACCESS_CLIENT_SECRET)
to the subscribe-checkout Worker. Reads both values from ~/.elevationary/
secrets.env via the dotenv pattern.

Use AFTER James creates the service token in dash.cloudflare.com → Access →
Service Auth and pastes the two values into secrets.env, e.g.:

  CF_ACCESS_CLIENT_ID=<token id>.access
  CF_ACCESS_CLIENT_SECRET=<long secret>

Usage:
  python3 scripts/push_cf_access_token.py --env preview
  python3 scripts/push_cf_access_token.py --env production
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


def push_one(env_arg: str, name: str, value: str) -> None:
    cmd = [str(WRANGLER), "secret", "put", name]
    # Only pass --env for preview; production is the top-level config without
    # an [env.production] block.
    if env_arg == "preview":
        cmd += ["--env", "preview"]
    print(f"Pushing {name}")
    proc = subprocess.run(
        cmd,
        input=value + "\n",
        text=True,
        capture_output=True,
        cwd=str(PROJECT_ROOT),
    )
    if proc.stdout:
        sys.stdout.write(proc.stdout)
    if proc.stderr:
        sys.stderr.write(proc.stderr)
    if proc.returncode != 0:
        sys.exit(f"wrangler secret put {name} failed with rc={proc.returncode}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--env", required=True, choices=["preview", "production"])
    args = ap.parse_args()

    load_dotenv(str(SECRETS_PATH), override=False)
    client_id = os.environ.get("CF_ACCESS_CLIENT_ID", "")
    client_secret = os.environ.get("CF_ACCESS_CLIENT_SECRET", "")
    if not client_id or not client_secret:
        sys.exit("ERROR: CF_ACCESS_CLIENT_ID or CF_ACCESS_CLIENT_SECRET not set in secrets.env")

    push_one(args.env, "CF_ACCESS_CLIENT_ID", client_id)
    push_one(args.env, "CF_ACCESS_CLIENT_SECRET", client_secret)
    print(f"\nBoth secrets pushed to env={args.env}.")


if __name__ == "__main__":
    main()
