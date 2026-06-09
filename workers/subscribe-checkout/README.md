# `subscribe-checkout` Worker

Buyer-side Stripe Checkout Session creator for elevationary.com.

**Status (2026-06-09):** Skeleton — scaffolded, vitest green, **not yet deployed**. Awaiting CEO **Q6** (Stripe Products + Prices + restricted API key).

**Spec:** `~/Antigravity_Data/Website/docs/plans/stripe_checkout_integration_spec_2026_06_08.md` (ORS PASS Standard 2026-06-08). Every architectural decision below is cited to a spec § number. Do NOT diverge without re-running spec ORS Stage 3.

**Skeleton ORS:** `~/Antigravity_Data/Website/docs/ORS_logs/ORS_website_stripe_checkout_skeleton_2026_06_09.md`.

---

## What it does

1. Buyer POSTs `{ tier, billing_period, stream, swimlanes_accessible[], email, name?, company? }` to `/api/checkout`.
2. Worker validates (`validation.ts`) → derives `ct_id` (`ct_id.ts`) → resolves-or-creates Sales Contact in R2 (`contact.ts`) → calls Stripe `POST /v1/checkout/sessions` with full `subscription_data.metadata` (`stripe.ts`) → returns `{ ok: true, checkout_url }`.
3. Browser redirects to Stripe-hosted checkout. Stripe owns payment from there → Sales receiver picks up the webhook → Worker `subscriber-content` v2.2 sees the new sub on next request.

**Website does NOT receive Stripe webhooks in v1** (spec § 5 routes them to Sales). `src/webhook.ts` is a forward-optionality stub for future Customer Portal events (spec § 10 Q5/Q7) — NOT routed in v1.

---

## Module map (spec § 3 architecture)

| File | Purpose | Spec ref |
|---|---|---|
| `src/index.ts` | Router: `POST /api/checkout`, `OPTIONS` for CORS preflight, `405` for everything else | spec § 3 step sequence |
| `src/types.ts` | `CheckoutRequest`, `SubscriptionMetadata`, `Env`, `WorkerError` | spec § 2 + § 3 |
| `src/validation.ts` | Email regex (§ 3.2), tier/billing-period/stream enums, swimlanes count + value enforcement, stream derivation (§ 3.5) | spec § 3.2 + § 3.5 |
| `src/ct_id.ts` | Email → `ct_id` canonicalization (lowercase, strip plus-addressing, `@./.` → `_`) | spec § 3.4 |
| `src/contact.ts` | Sales Contact resolve-or-create against R2; F-6 collision check; § 3.11 JSON shape | spec § 3.11 + § 8 F-6 |
| `src/stripe.ts` | Form-encoded bracket-notation encoder (§ 3.3); Stripe API call with `Stripe-Version` + `Idempotency-Key` (§ 6) | spec § 3.3 + § 6 |
| `src/idempotency.ts` | KV-backed per-IP rate limit + per-email lockout (spec § 3.7) | spec § 3.7 + § 8 F-3/F-4 |
| `src/origin.ts` | Origin allow-list per env (spec § 3.8) | spec § 3.8 + § 8 F-13 |
| `src/webhook.ts` | **STUB** — forward-optionality only; NOT routed in v1 | divergence note in skeleton ORS |

---

## TODO markers (CEO-gated swap-in points)

Every CEO-gated value is a grep-findable `TODO(CEO Qn)` comment. List:

```bash
grep -rn "TODO(" workers/subscribe-checkout/src/
```

| Tag | Spec ref | Unblocks when |
|---|---|---|
| `TODO(CEO Q6)` | spec § 3 secret bindings | CEO provisions Stripe Products + restricted key |
| `TODO(CEO Q4)` | spec § 10 Q4 | CEO decides annual v1 vs monthly-only |
| `TODO(CEO Q7)` | spec § 7 + § 10 Q7 | CEO configures Stripe Customer Portal |
| `TODO(Sales coordination)` | spec § 3.10 + § 3.11 | Sales Agent confirms Contact JSON schema |
| `TODO(Marketing brand)` | spec § 4 | Marketing brand foundation lands |
| `TODO(activation)` | divergence note | Customer Portal scope opens (Q5/Q7) |

---

## Build + test

```bash
cd workers/subscribe-checkout/
npm install          # not yet committed — node_modules excluded from git
npm run typecheck    # tsc --noEmit
npm test             # vitest run
```

---

## Activation procedure (post-CEO Q6 — DO NOT RUN UNTIL ALL STEPS POSSIBLE)

Cite this sequence in the activation-time **Detailed-rigor implementation ORS**:

1. **CEO provisions in Stripe Dashboard:**
   - 3 monthly Prices (Individual / Functional Bundle / All-Access) + 3 annual if Q4 ratifies.
   - Restricted API key with scope `write:checkout.sessions`. (Possibly add `read:checkout.sessions` if welcome page reads session by ID — spec § 7 says no Stripe API call from welcome page, so the read scope may be droppable.)
2. **Create KV namespaces** — `wrangler kv:namespace create "IDEMPOTENCY_KV"` (twice: prod + `--env preview`). Paste IDs into `wrangler.toml`.
3. **Set all secrets** per the secret table in `wrangler.toml`.
4. **Uncomment routes block** in `wrangler.toml`.
5. **Preview deploy first** — `wrangler deploy --env preview`. Verify `DRY_RUN_CONTACT_WRITE=true` short-circuits Stripe + R2 writes; log inspection per spec § 3.10.
6. **Sales Agent reads dry-run logs**, confirms § 3.11 Contact JSON shape matches schema.
7. **Set `DRY_RUN_CONTACT_WRITE=false`** in preview → full Test Mode round-trip with Stripe test card `4242 4242 4242 4242` → confirm Sales receiver picks up the webhook + writes `sales/subscriptions/<sb_id>.json` + Worker `subscriber-content` v2.2 returns 200 for `/editions/` on the new buyer's email.
8. **Production deploy** — `wrangler deploy` (no env flag). Append Worker-side `STRIPE_SECRET_KEY` row to `~/Antigravity_Data/Administrator/docs/secret_consumer_registry.md`.
9. **Drop placeholder URLs** from `src/_data/site.json` (`stripeCheckoutIndividualUrl`, etc.) and ship `/subscribe/` lane-picker UI per spec § 4.

---

## Cross-references

- **Pairs spec (canonical work order):** `~/Antigravity_Data/Website/docs/plans/stripe_checkout_integration_spec_2026_06_08.md`
- **Newsletter funnel architecture (pair-spec):** `~/Antigravity_Data/Newsletter/docs/plans/subscriber_funnel_architecture_2026_06_08.md`
- **Sales contract source-of-truth:** `~/Antigravity/Elevationary_Sales/scripts/stripe_webhook.py` lines 204–305 + `subscription.schema.json` v2
- **Existing entitlement Worker:** `~/Antigravity/Website/workers/subscriber-content/` v2.2 (version `459d1ab9-…`)
- **Skeleton walkthrough:** `~/Antigravity_Data/Website/docs/walkthroughs/walkthrough_stripe_checkout_skeleton_2026_06_09.md`
