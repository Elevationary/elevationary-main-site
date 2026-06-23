#!/usr/bin/env python3
"""
Smoke-test the STRIPE_READ_KEY value loaded from ~/.elevationary/secrets.env.
Hits two scope-bound endpoints to verify (a) auth succeeds, (b) scope covers
both checkout.sessions:read and subscriptions:read.

Outputs only HTTP status codes + response object types — never the key,
never customer PII.

Usage:
  python3 scripts/smoke_test_stripe_read.py
"""
import os
import sys
from pathlib import Path

import requests
from dotenv import load_dotenv

SECRETS_PATH = Path.home() / ".elevationary" / "secrets.env"

load_dotenv(str(SECRETS_PATH), override=False)
key = os.environ.get("STRIPE_READ_KEY", "")
if not key:
    sys.exit("ERROR: STRIPE_READ_KEY not set")

# Echo only the prefix (e.g., 'rk_live_' vs 'sk_live_' vs 'sk_test_') so we can
# confirm key type without leaking the value.
prefix = key[: key.find("_", key.find("_") + 1) + 1] if key.count("_") >= 2 else key[:8]
print(f"Key type: {prefix}...  (length {len(key)} chars)")

api = "https://api.stripe.com/v1"
headers = {"Authorization": f"Bearer {key}"}

tests = [
    ("GET", "/checkout/sessions", {"limit": 1}, "checkout.sessions:read"),
    ("GET", "/subscriptions", {"limit": 1}, "subscriptions:read"),
]

all_ok = True
for method, path, params, scope_label in tests:
    r = requests.request(method, api + path, headers=headers, params=params, timeout=10)
    obj = ""
    try:
        body = r.json()
        obj = body.get("object", "")
        n = len(body.get("data", [])) if obj == "list" else 0
        detail = f"object={obj!r} data_count={n}"
    except Exception:
        detail = f"non-json body ({len(r.text)} chars)"
    ok = r.status_code == 200
    all_ok = all_ok and ok
    print(f"  {scope_label:30s}  HTTP {r.status_code}  {detail}")
    if not ok:
        # Show error type (Stripe envelope has .error.type + .error.code) — never value.
        try:
            err = r.json().get("error", {})
            print(f"    error.type={err.get('type')!r} error.code={err.get('code')!r}")
        except Exception:
            pass

if all_ok:
    print("\nSMOKE: PASS — STRIPE_READ_KEY authenticates and both required scopes are present.")
    sys.exit(0)
else:
    print("\nSMOKE: FAIL — at least one endpoint returned non-200.")
    sys.exit(1)
