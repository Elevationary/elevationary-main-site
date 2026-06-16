#!/usr/bin/env python3
"""
Stripe provisioning script — Test Mode bootstrap for subscribe-checkout Worker.

Reads STRIPE_TEST_KEY (or STRIPE_LIVE_KEY) from ~/.elevationary/secrets.env via
the fleet's dotenv pattern (mirrors send_brian.py / memory_router.py).

Subcommands:
  probe        — list 1 product, confirm livemode + scope
  create-all   — create 3 Products + 6 Prices + 1 Coupon + ELEVATE50 promo code
  list         — list Products + Prices + Coupons + Promotion Codes (paginated)
  inspect-session <id>  — fetch a Checkout Session + print its subscription_data.metadata
  deactivate-promo-codes <coupon_id>  — set active=false on every promo code under a coupon

Modes:
  --mode test  (default) — uses STRIPE_TEST_KEY
  --mode live            — uses STRIPE_LIVE_KEY (refuses without explicit --i-mean-live)

Never echoes the secret key. All Stripe IDs go to stdout for capture.
"""
import argparse
import json
import os
import sys
import urllib.parse

import requests
from dotenv import load_dotenv

SECRETS_PATH = os.path.expanduser("~/.elevationary/secrets.env")
STRIPE_BASE = "https://api.stripe.com"
STRIPE_VERSION = "2025-08-27.basil"


def load_key(mode: str, allow_live: bool) -> str:
    load_dotenv(SECRETS_PATH, override=False)
    if mode == "test":
        key = os.environ.get("STRIPE_TEST_KEY", "")
        if not key:
            sys.exit("ERROR: STRIPE_TEST_KEY not set in ~/.elevationary/secrets.env")
        if not key.startswith("sk_test_"):
            sys.exit("ERROR: STRIPE_TEST_KEY does not look like a test key (sk_test_*)")
        return key
    if mode == "live":
        if not allow_live:
            sys.exit("ERROR: refusing live mode without --i-mean-live flag")
        key = os.environ.get("STRIPE_LIVE_KEY", "")
        if not key:
            sys.exit("ERROR: STRIPE_LIVE_KEY not set in ~/.elevationary/secrets.env")
        if not key.startswith("sk_live_") and not key.startswith("rk_live_"):
            sys.exit("ERROR: STRIPE_LIVE_KEY does not look like a live key (sk_live_/rk_live_)")
        return key
    sys.exit(f"ERROR: unknown mode {mode}")


def stripe_call(method: str, path: str, key: str, form: dict | None = None) -> dict:
    url = STRIPE_BASE + path
    headers = {
        "Authorization": "Bearer " + key,
        "Stripe-Version": STRIPE_VERSION,
    }
    if form is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    r = requests.request(method, url, headers=headers, data=form, timeout=30)
    if not r.ok:
        sys.exit(f"Stripe API {method} {path} failed HTTP {r.status_code}: {r.text[:500]}")
    return r.json()


def probe(key: str) -> None:
    r = stripe_call("GET", "/v1/products?limit=1", key)
    items = r.get("data", [])
    if items:
        print(f"livemode: {items[0].get('livemode')}")
        print(f"first_product: {items[0].get('id')} - {items[0].get('name')}")
    else:
        print("livemode: (no products to inspect — confirms fresh test space)")
    print(f"count: {len(items)}")
    print(f"has_more: {r.get('has_more')}")


def list_all(key: str) -> None:
    print("=== Products ===")
    r = stripe_call("GET", "/v1/products?limit=100&active=true", key)
    for p in r.get("data", []):
        print(f"  {p['id']}  {p['name']}  livemode={p.get('livemode')}  metadata={p.get('metadata')}")

    print("\n=== Prices ===")
    r = stripe_call("GET", "/v1/prices?limit=100&active=true", key)
    for p in r.get("data", []):
        rec = p.get("recurring") or {}
        print(f"  {p['id']}  product={p['product']}  ${p['unit_amount']/100:.2f}/{rec.get('interval','?')}  metadata={p.get('metadata')}")

    print("\n=== Coupons ===")
    r = stripe_call("GET", "/v1/coupons?limit=100", key)
    for c in r.get("data", []):
        print(f"  {c['id']}  {c.get('name','(no name)')}  pct_off={c.get('percent_off')}  duration={c.get('duration')}  duration_in_months={c.get('duration_in_months')}  max_redemptions={c.get('max_redemptions')}  times_redeemed={c.get('times_redeemed')}")

    print("\n=== Promotion Codes (first 100) ===")
    r = stripe_call("GET", "/v1/promotion_codes?limit=100&active=true", key)
    for p in r.get("data", []):
        rest = p.get("restrictions", {})
        print(f"  {p['id']}  code={p['code']}  coupon={p.get('promotion',{}).get('coupon')}  max={p.get('max_redemptions')}  first_time_only={rest.get('first_time_transaction')}  times_redeemed={p.get('times_redeemed')}")
    if r.get("has_more"):
        print(f"  (has_more: yes — total > 100)")


TIERS = [
    {
        "key": "individual-access",
        "name": "Individual Access",
        "description": "Single swimlane subscription — pick any 1 of 10 in your chosen stream (commercial or nonprofit).",
        "monthly_cents": 2900,
        "annual_cents": 29000,
    },
    {
        "key": "functional-bundle",
        "name": "Functional Bundle",
        "description": "3 swimlanes from a single stream — buyer's choice. 21% savings vs 3 Individual subscriptions.",
        "monthly_cents": 6900,
        "annual_cents": 69000,
    },
    {
        "key": "all-access-pass",
        "name": "All-Access Corporate Pass",
        "description": "All 10 swimlanes within one stream (Commercial or Nonprofit). 49% savings vs 10 Individual subscriptions.",
        "monthly_cents": 14900,
        "annual_cents": 149000,
    },
]


def create_all(key: str) -> None:
    """Create 3 Products + 6 Prices + 1 Coupon + ELEVATE50 Promotion Code."""
    out: dict[str, str] = {}
    print("Creating Products + Prices...")
    for tier in TIERS:
        # Product
        prod = stripe_call("POST", "/v1/products", key, form={
            "name": tier["name"],
            "description": tier["description"],
            "metadata[tier_key]": tier["key"],
        })
        prod_id = prod["id"]
        print(f"  Product: {prod_id}  ({tier['name']})")

        # Monthly price
        price_m = stripe_call("POST", "/v1/prices", key, form={
            "product": prod_id,
            "unit_amount": tier["monthly_cents"],
            "currency": "usd",
            "recurring[interval]": "month",
            "metadata[tier_key]": tier["key"],
            "metadata[billing]": "monthly",
        })
        out[f"{tier['key'].upper().replace('-', '_')}_MONTHLY"] = price_m["id"]
        print(f"    Monthly Price: {price_m['id']}  ${tier['monthly_cents']/100:.2f}/mo")

        # Annual price
        price_a = stripe_call("POST", "/v1/prices", key, form={
            "product": prod_id,
            "unit_amount": tier["annual_cents"],
            "currency": "usd",
            "recurring[interval]": "year",
            "metadata[tier_key]": tier["key"],
            "metadata[billing]": "annual",
        })
        out[f"{tier['key'].upper().replace('-', '_')}_ANNUAL"] = price_a["id"]
        print(f"    Annual Price:  {price_a['id']}  ${tier['annual_cents']/100:.2f}/yr")

    # Founding Member Coupon
    print("\nCreating Founding Member Coupon (50% off, repeating, 3 months)...")
    coupon = stripe_call("POST", "/v1/coupons", key, form={
        "name": "Founding Member 50% off (3 months)",
        "percent_off": 50,
        "duration": "repeating",
        "duration_in_months": 3,
        "metadata[campaign]": "founding-member-elevate50",
    })
    coupon_id = coupon["id"]
    out["FOUNDING_COUPON"] = coupon_id
    print(f"  Coupon: {coupon_id}")

    # ELEVATE50 Promotion Code
    print("\nCreating ELEVATE50 Promotion Code (max_redemptions=100, first_time_only)...")
    promo = stripe_call("POST", "/v1/promotion_codes", key, form={
        "coupon": coupon_id,
        "code": "ELEVATE50",
        "max_redemptions": 100,
        "restrictions[first_time_transaction]": "true",
        "metadata[campaign]": "founding-member-elevate50",
    })
    out["ELEVATE50_PROMO_CODE_ID"] = promo["id"]
    out["ELEVATE50_CODE_STRING"] = promo["code"]
    print(f"  Promotion Code: {promo['id']}  code={promo['code']}")

    print("\n=== Capture for Worker config ===")
    print(json.dumps(out, indent=2))


def inspect_session(key: str, session_id: str) -> None:
    """Fetch a Checkout Session + print full object for round-trip validation."""
    r = stripe_call("GET", f"/v1/checkout/sessions/{session_id}?expand[]=line_items", key)
    print("=== Full Session JSON ===")
    print(json.dumps(r, indent=2, default=str))


def deactivate_promo_codes(key: str, coupon_id: str) -> None:
    """Set active=false on every Promotion Code that references the given Coupon."""
    starting_after = None
    deactivated = 0
    while True:
        qs = f"limit=100&coupon={urllib.parse.quote(coupon_id)}"
        if starting_after:
            qs += f"&starting_after={starting_after}"
        r = stripe_call("GET", f"/v1/promotion_codes?{qs}", key)
        items = r.get("data", [])
        if not items:
            break
        for p in items:
            if p.get("active"):
                stripe_call("POST", f"/v1/promotion_codes/{p['id']}", key, form={"active": "false"})
                print(f"  deactivated {p['id']}  code={p['code']}")
                deactivated += 1
            else:
                print(f"  already inactive: {p['id']}  code={p['code']}")
        if not r.get("has_more"):
            break
        starting_after = items[-1]["id"]
    print(f"\nTotal deactivated: {deactivated}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=["probe", "list", "create-all", "inspect-session", "test-create-session", "deactivate-promo-codes"])
    ap.add_argument("--mode", choices=["test", "live"], default="test")
    ap.add_argument("--i-mean-live", action="store_true", help="explicit confirmation for --mode live writes")
    ap.add_argument("--coupon", help="coupon id for deactivate-promo-codes")
    ap.add_argument("--session", help="checkout session id for inspect-session")
    args = ap.parse_args()

    key = load_key(args.mode, allow_live=args.i_mean_live)

    if args.command == "probe":
        probe(key)
    elif args.command == "list":
        list_all(key)
    elif args.command == "create-all":
        create_all(key)
    elif args.command == "inspect-session":
        if not args.session:
            sys.exit("ERROR: --session required for inspect-session")
        inspect_session(key, args.session)
    elif args.command == "test-create-session":
        # Direct Stripe API call mirroring the Worker payload shape, to isolate
        # whether the issue is in the Worker's encoder or Stripe API itself.
        ids = json.load(open(os.path.join(os.path.dirname(__file__), "stripe_test_ids.json")))
        price_id = ids["prices"]["STRIPE_PRICE_INDIVIDUAL_MONTHLY"]
        form = {
            "mode": "subscription",
            "customer_email": "direct-test@example.com",
            "line_items[0][price]": price_id,
            "line_items[0][quantity]": "1",
            "subscription_data[metadata][contact_id]": "ct_direct_test_example_com",
            "subscription_data[metadata][stream]": "commercial",
            "subscription_data[metadata][tier]": "individual",
            "subscription_data[metadata][swimlanes_accessible]": "commercial_leadership_aim",
            "subscription_data[metadata][source]": "stripe_checkout_elevationary_com",
            "success_url": "https://elevationary.com/subscribe/welcome/?session_id={CHECKOUT_SESSION_ID}",
            "cancel_url": "https://elevationary.com/subscribe/?cancelled=1",
            "allow_promotion_codes": "true",
            "billing_address_collection": "auto",
            "automatic_tax[enabled]": "false",
        }
        r = stripe_call("POST", "/v1/checkout/sessions", key, form=form)
        print(f"Created session: {r.get('id')}")
        print(f"URL: {r.get('url')}")
        # Immediately inspect.
        print("\n=== Inspect result ===")
        inspect_session(key, r["id"])
    elif args.command == "deactivate-promo-codes":
        if not args.coupon:
            sys.exit("ERROR: --coupon required for deactivate-promo-codes")
        deactivate_promo_codes(key, args.coupon)


if __name__ == "__main__":
    main()
