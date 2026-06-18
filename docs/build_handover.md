# Website Build Handover — 2026-06-17 (interim check-in; substantive Stripe work 2026-06-16; Team Elevation audit COMPLETE today)

## Agent
Website (Public-Facing Web Properties Code Specialist)

## Reports To
Administrator (Fleet COO + Code Pilot)

## Interim Update — 2026-06-17

**Process / governance day — no code changes.** Stripe Checkout state unchanged from 2026-06-16 (preview Worker `subscribe-checkout-preview` version `cd0567cb-…` still live at `https://subscribe-checkout-preview.ar-ef1.workers.dev`; awaiting CEO browser-completion of Session `cs_test_b1F6pJK0qM6amjrUNeuveDsQkm6fX52TiRnlu66NWf8OJ4ozWNFpvHNyHV` with test card `4242 4242 4242 4242` to validate `subscription_data.metadata` propagation per `task_aeec81fc`). Production smoke clean (HTTP/2 200).

### Team Elevation Self-Audit COMPLETE (2026-06-17)

Per COO dispatch 2026-06-17 implementing Phase 3 of master `Team_Elevation` project. **ORS PASS Standard.**

- **Project count owned:** 4 (concentrated in 2 portfolios where 100% of active work lives).
- **State breakdown:** (a) In-flight Phase × 1 (Subscription_Revenue_Pipeline) + (c) Between-phases × 1 (Migrate_ElevationaryCom) + DRIFT × 1 (Update_EOs) + Closed × 1 (WebSiteFoundation).
- **scope_text M.O.S.T. attribution APPENDED (not clobbered)** on the two active Projects:
  - `Subscription_Revenue_Pipeline` → O3 + O2 / S2 + S6 + S7 / I1 Subscription Revenue.
  - `Migrate_ElevationaryCom` → O4 + O3 / S7 + S2 / I6 Brand Foundation Locked + Applied.
- **Append pattern** chosen so other co-owning teammates (Sales, Newsletter) can append theirs without clobber.
- **Re-query verified** via grep on cached `get_project` output.

**Top 3 drift findings surfaced to COO** (full 7 in audit doc):
1. **F2** — CLAUDE_CODE.md amendment NOT yet landed in Website's `directives/`. Wrap-up enforcement won't engage until propagated.
2. **F1** — `Update_EOs` cross-owner drift (22/22 tasks 🟢 but Project + Phases + Deliverables stuck 🔲 because Owner=James on Deliverables blocks self-flip per EDGE CASES). COO doctrine call needed.
3. **F4** — Probation horizon convention not yet set fleet-wide. Deferred filing `subscribe-checkout-preview` Probation deliverable pending COO convention.

### Artifacts landed today (2026-06-17)

- **ORS:** `~/Antigravity_Data/Website/docs/ORS_logs/ORS_website_team_elevation_self_audit_2026_06_17.md` — PASS Standard. L4 `ors-logs/-72e36ccf`.
- **Audit doc:** `~/Antigravity_Data/Website/docs/audits/team_elevation_self_audit_2026_06_17.md` (NEW directory under data dir).
- **Walkthrough:** `~/Antigravity_Data/Website/docs/walkthroughs/walkthrough_website_team_elevation_self_audit_2026_06_17.md`. L4 `walkthroughs/-75c667`.
- **2 P4D3 row writes** (scope_text appends on Subscription_Revenue_Pipeline + Migrate_ElevationaryCom).
- **2 auto-memories** saved at `~/.claude/projects/-Users-jamesszmak-Antigravity-Website/memory/`:
  - `feedback_voice_messages_use_send_brian.md` (carry-forward from 2026-06-14).
  - `feedback_telegram_page_on_substantial_deliverable.md` (new today — page is required, chat reply is not the page).

### Outstanding asks

- **CEO:** browser-complete Test Mode validation (`task_aeec81fc`, ~1 min) — unblocks LIVE activation.
- **COO:** dispositions on F1 (cross-owner status flips), F2 (amendment propagation), F4 (Probation horizon).

### Today's wrap-up

Doc-only interim — handover refresh, backlog reaffirmation, session_log via wrap-up script, production smoke verification. `--skip-ors` NOT needed (the Team Elevation audit IS a fully-closed ORS PASS today, satisfies the wrap-up gate).

---

## Substantive Session Summary (2026-06-16 — carried forward verbatim)

**Major progress session — Stripe Checkout Test Mode is functionally activated.** Worker deployed, Stripe Test Mode catalog provisioned, smoke test returns valid Stripe Checkout Session URLs. One open verification remaining (browser-complete a Test Mode checkout to confirm `subscription_data.metadata` propagates correctly to the resulting Subscription) before the LIVE-side activation work can proceed safely.

### Today's deliverables

**Stripe Test Mode catalog provisioned** (`acct_1S9DtzC5seLx7yR7` in Test Mode):
- 3 Products (Individual Access / Functional Bundle / All-Access Corporate Pass) with MBP-ratified descriptions + `tier_key` metadata.
- 6 Prices ($29/$290, $69/$690, $149/$1490 — monthly + annual per tier).
- 1 Coupon `EJ7eBI1C` (Founding Member 50% off, `duration: repeating`, `duration_in_months: 3`).
- 1 Promotion Code `ELEVATE50` (`promo_1Tj17lC5seLx7yR7N8oUXo2D`, `max_redemptions: 100`, `restrictions.first_time_transaction: true`).
- All IDs persisted to [`workers/subscribe-checkout/scripts/stripe_test_ids.json`](workers/subscribe-checkout/scripts/stripe_test_ids.json) for reproducibility + Worker reference. Safe to commit — IDs only, no secrets.

**Worker `subscribe-checkout-preview` deployed** at `https://subscribe-checkout-preview.ar-ef1.workers.dev` (Version ID `cd0567cb-17f2-4681-8f10-9056f1c0ddcf`):
- KV binding `IDEMPOTENCY_KV` → `dd29099b31b5431fba7cfe6aa32242f5` (preview namespace).
- R2 binding `R2_SALES` → `gemini-content-factory` (shared bucket; sales/ prefix).
- 7 secrets via `wrangler secret bulk`: `STRIPE_SECRET_KEY` (Test Mode) + 6 `STRIPE_PRICE_*` IDs.
- Vars: `WORKER_ENV=preview`, `ALLOWED_ORIGINS`, `STRIPE_API_VERSION=2025-08-27.basil`, `DRY_RUN_CONTACT_WRITE=true`.

**Smoke test results:**
- ✅ CORS preflight (`OPTIONS /api/checkout`) returns HTTP 204 with correct `Access-Control-*` headers + `Vary: Origin`.
- ✅ POST `/api/checkout` with valid body returns `{ok: true, checkout_url: "https://checkout.stripe.com/c/pay/cs_test_..."}`.
- ✅ Dry-run Contact synthesis logs proposed Sales Contact JSON without R2 write (spec § 3.10).
- ✅ Email derivation works: `smoke-test-1@example.com` → `ct_smoke-test-1_example_com` (plus-stripping per spec § 3.4).
- ✅ Stripe Session creates with all configured fields (`success_url`, `cancel_url`, `allow_promotion_codes`, `customer_email`, `line_items`, `mode: subscription`).
- ⏳ **PENDING:** Browser-complete a Test Mode checkout to verify `subscription_data.metadata` populates on the resulting Subscription (Stripe Sessions API doesn't echo `subscription_data` on retrieve — write-only field; must complete payment to validate via `subscription.metadata`).

### Bugs found + fixed this session

**1. EMAIL_LOCKOUT_TTL_SEC was 30, Cloudflare KV minimum is 60.** First smoke-test POST returned Cloudflare error 1101 (Worker threw exception). Log: `KV PUT failed: 400 Invalid expiration_ttl of 30. Expiration TTL must be at least 60.` Fixed in [`src/idempotency.ts`](workers/subscribe-checkout/src/idempotency.ts) by bumping to 60 with a comment citing today's smoke-test discovery. Spec § 3.7 said 30s; reality says 60s floor. Worker redeployed. Second smoke test passed.

### Major operational discoveries

**LIVE Stripe account `acct_1S9DtzC5seLx7yR7` is already extensively provisioned** from a March 26, 2026 session:
- 3 Products + 6 Prices matching MBP exactly to the penny. **Activation will reuse these IDs — no LIVE Products/Prices need creation.**
- 2 Coupons (`dTwd1p8S`, `TEyye1SG`) named "30-Day Preview Access" — 100% off, once, max_redemptions=100, campaign=preview-2026. Both at 0/100 redeemed.
- 100+ `PREVIEW-XXXXXX` Promotion Codes (single-use each, all tied to `dTwd1p8S`). Sequenced 1–100. CEO directed deactivation via `active=false` per code; scheduled for LIVE-side work.

**Second Stripe account `acct_1SFiCnCOzcWjCZ90` exists** with same display name "Elevationary, Inc". Different `acct_` ID. Origin unknown — P4D3 `task_1ec7983b` filed under `P4_D1_Entitlement_Worker` for later audit. Not touched today. NOT to be confused with the Sandbox account `acct_1S9DuBC3YEf5bh1i`.

**Stripe MCP OAuth approach is a dead-end for our use case** (~90 min investigation):
- Stripe MCP access toggle is global per account (not mode-specific).
- Live account has MCP access toggle; Sandbox has separate toggle; Live's built-in Test Mode has NO MCP access at all.
- OAuth grant is mode-locked at consent time and cannot be switched by toggling the dashboard mode after-the-fact.
- Even with both Live + Sandbox MCP enabled, OAuth consent doesn't reliably pick the dashboard's current context.
- **Pivot:** bearer-token via Python script + dotenv pattern, mirroring the fleet's existing pattern (`send_brian.py`, `memory_router.py`). Read STRIPE_TEST_KEY from `~/.elevationary/secrets.env`, hit Stripe REST API directly. Classifier-allowed via script-execution pattern; ad-hoc inline reads of secrets file are blocked (correct behavior).

### Fleet-pattern scripts created this session

**[`workers/subscribe-checkout/scripts/stripe_provision.py`](workers/subscribe-checkout/scripts/stripe_provision.py)** — CRUD against Stripe API via REST. Subcommands:
- `probe` — list 1 product, confirm `livemode` + scope (smoke test for key + mode).
- `create-all` — create 3 Products + 6 Prices + Founding Coupon + ELEVATE50 promo code.
- `list` — list Products + Prices + Coupons + Promotion Codes (paginated).
- `inspect-session --session <id>` — full Session JSON dump for round-trip validation.
- `test-create-session` — direct-API Session creation with metadata, for encoder verification.
- `deactivate-promo-codes --coupon <id>` — set `active=false` on every Promotion Code under a Coupon (for LIVE PREVIEW deactivation).
- `--mode test` (default) reads `STRIPE_TEST_KEY`. `--mode live` requires `--i-mean-live` flag + reads `STRIPE_LIVE_KEY`.

**[`workers/subscribe-checkout/scripts/configure_worker_secrets.py`](workers/subscribe-checkout/scripts/configure_worker_secrets.py)** — pushes Worker secrets via `wrangler secret bulk`. Reads STRIPE_*_KEY from secrets.env + Price IDs from `stripe_test_ids.json` / `stripe_live_ids.json`. Wrangler bulk subcommand never echoes values; secret never enters process args or stdout.

Both scripts follow the fleet's dotenv + requests pattern. Classifier-allowed via named-script execution (ad-hoc inline reads of secrets remain blocked — correct posture).

## What's Live (changes from prior handover marked)

| Component | State | Change |
|---|---|---|
| Cloudflare Worker `subscriber-content` v2.2 | DEPLOYED — `459d1ab9-…`. | Unchanged. |
| Cloudflare Worker `subscribe-checkout-preview` | **DEPLOYED — `cd0567cb-17f2-4681-8f10-9056f1c0ddcf`** at `https://subscribe-checkout-preview.ar-ef1.workers.dev`. | **NEW today.** |
| Cloudflare Worker `subscribe-checkout` (production) | NOT YET DEPLOYED. Awaits LIVE catalog provisioning gate. | Unchanged. |
| Cloudflare Access "Subscriber Content" | LIVE. AUD `3c0a5765…0bfa`. | Unchanged. |
| R2 bucket `gemini-content-factory` | Single bucket; `sales/` + `newsletter/` prefixes. | Unchanged. |
| Stripe Products + Prices (LIVE) | 3 Products + 6 Prices matching MBP. Created 2026-03-26. | Discovered today (already existed). |
| Stripe Products + Prices (Test Mode) | **3 Products + 6 Prices NEW today** (matching LIVE shapes). | **NEW today.** |
| Stripe Coupons (LIVE) | 2 stale "30-Day Preview Access" coupons. 100% off, once, 100/100 codes preview-2026. | Discovered today. To deactivate via `active=false` on codes when LIVE-side work resumes. |
| Stripe Promotion Codes (LIVE) | 100 stale `PREVIEW-XXXXXX` codes. 0/100 redeemed each. | Discovered today. Scheduled for deactivation. |
| Stripe Coupon ELEVATE50 (Test Mode) | **`EJ7eBI1C` — 50%/3 mo NEW today.** | **NEW today.** |
| Stripe Promo Code ELEVATE50 (Test Mode) | **`promo_1Tj17lC5seLx7yR7N8oUXo2D` NEW today.** `max_redemptions=100`, `first_time_transaction=true`. | **NEW today.** |
| Stripe ELEVATE50 in LIVE | NOT YET CREATED. Will mirror Test Mode shape when LIVE-side work resumes. | Pending. |
| Worker secret `STRIPE_SECRET_KEY` (subscriber-content, LIVE) | Set, restricted `subscriptions:read`. | Unchanged. |
| Worker secret `STRIPE_SECRET_KEY` (subscribe-checkout-preview, Test Mode) | **SET today via `wrangler secret bulk`.** | **NEW today.** |
| Worker secret `STRIPE_SECRET_KEY` (subscribe-checkout production) | NOT YET PROVISIONED. Restricted scope `write:checkout.sessions` planned. | Pending. |
| Public routes | HTTP/2 200 unchanged. | Unchanged. |

## What Got Done This Session (chronological)

1. **CEO ratified Q4** — Monthly + annual together (6 Prices).
2. **CEO ratified Q6a** — Confirm MBP pricing as-is + design ELEVATE50 promo in parallel (`50% off first 3 months`, `max_redemptions: 100`, first-time-only).
3. **Discovered LIVE state** — Existing 3 Products + 6 Prices at MBP pricing (created 2026-03-26); 100 stale PREVIEW-XXXXXX codes from a never-executed "30-Day Preview Access" campaign.
4. **Filed P4D3 `task_1ec7983b`** — investigate second Elevationary, Inc account `acct_1SFiCnCOzcWjCZ90` (different `acct_` ID; provenance unknown).
5. **Tried Stripe MCP OAuth → Test Mode (~90 min)** — Multiple attempts: revoke + reconnect from Test Mode dashboard; disable LIVE MCP + enable Sandbox MCP; etc. All landed back in LIVE. Confirmed MCP OAuth grant is mode-locked at consent time and Live's built-in Test Mode has no MCP at all.
6. **Pivoted to bearer-token script pattern** — `stripe_provision.py` mirrors fleet's `dotenv` pattern (`send_brian.py`, `memory_router.py`). STRIPE_TEST_KEY in `~/.elevationary/secrets.env`. Classifier-clean.
7. **Provisioned Test Mode catalog** — `create-all` ran clean: 3 Products + 6 Prices + Founding Coupon + ELEVATE50 promo. ~3 seconds. IDs persisted to `scripts/stripe_test_ids.json`.
8. **Configured Worker** — Created preview + production KV namespaces; updated `wrangler.toml` to uncomment `env.preview.r2_buckets` + `env.preview.kv_namespaces` blocks with the actual IDs; pushed 7 secrets via `wrangler secret bulk`.
9. **Deployed `subscribe-checkout-preview` Worker** — `wrangler deploy --env preview`. All bindings confirmed at deploy time. Worker live at `*.workers.dev` URL.
10. **First smoke test → Worker threw `1101`** — Captured via `wrangler tail`. Root cause: `EMAIL_LOCKOUT_TTL_SEC = 30` violates Cloudflare KV's 60s minimum.
11. **Fixed `idempotency.ts`** — Bumped to 60 with explanatory comment. Redeployed. Second smoke test green.
12. **Created fresh Session for metadata validation** — `cs_test_b1F6pJK0qM6amjrUNeuveDsQkm6fX52TiRnlu66NWf8OJ4ozWNFpvHNyHV` — pending browser completion to verify `subscription_data.metadata` propagates to resulting Subscription.

## Remaining Work

### IMMEDIATE GATE — Metadata browser validation (CEO action, ~1 min)

Open the Test Mode Session URL in browser, complete payment with Stripe test card `4242 4242 4242 4242`. Worker round-trip then verifiable by retrieving the resulting Subscription via API and confirming `subscription.metadata` contains all 5 expected fields (`contact_id`, `stream`, `tier`, `swimlanes_accessible`, `source`).

Without this gate: 95% confidence the Worker is correct (encoder unit-tests passing, encoder Python replica matches Stripe's spec exactly), but Stripe's `subscription_data` field is write-only on Session retrieve — only way to verify metadata is set correctly is to complete the checkout.

Session for validation: `cs_test_b1F6pJK0qM6amjrUNeuveDsQkm6fX52TiRnlu66NWf8OJ4ozWNFpvHNyHV`.

P4D3 `task_<new>` filed for this validation (see P4D3 section below).

### After validation passes — LIVE activation

When metadata validation is clean and CEO confirms proceed:
1. **Re-enable LIVE MCP toggle** OR use `stripe_provision.py --mode live --i-mean-live` with `STRIPE_LIVE_KEY` in secrets.env.
2. **Create Founding Coupon + ELEVATE50 promo code in LIVE** (Products/Prices already exist in LIVE — no duplication needed).
3. **Deactivate 100 stale PREVIEW-XXXXXX codes in LIVE** — `stripe_provision.py deactivate-promo-codes --mode live --i-mean-live --coupon dTwd1p8S` (and again for `TEyye1SG`).
4. **CEO creates LIVE restricted API key** — Dashboard → Developers → API keys → Create restricted key → Checkout Sessions: Write → `rk_live_...`. Tell Website Agent when ready; we run `wrangler secret put STRIPE_SECRET_KEY` (no `--env` for production) to set it.
5. **Configure production env Worker** — uncomment production `routes` block in `wrangler.toml` (`elevationary.com/api/checkout/*`), push 6 LIVE price IDs + `STRIPE_SECRET_KEY` via wrangler bulk, `wrangler deploy` for production env.
6. **Append Secret Consumer Registry row** — `~/Antigravity_Data/Administrator/docs/secret_consumer_registry.md` for the new restricted key (name + smoke test only, NEVER value).
7. **Run a controlled LIVE Test Mode round-trip** to validate the production Worker (same email pattern as today's preview validation, just hitting the production URL with a real card + immediate cancel + refund + cleanup).
8. **Detailed-rigor implementation ORS** at end.

### Parallel work — `/subscribe/` UI + welcome page (Eleventy)

(Unchanged from prior handover.)

- `src/subscribe/index.njk` rewrite per spec § 4: 3 forms with lane-picker (Individual 1 / Functional Bundle 3 / All-Access stream-only).
- Drop placeholder `stripeCheckout*Url` keys from `src/_data/site.json`.
- New `src/subscribe/welcome/index.njk` per spec § 7. **Note: today's Test Mode round-trip hit a 404 at this URL because the page doesn't exist — that's expected for now.**
- Brand pass deferred (`~/Antigravity/Elevationary_Marketing/brand/` still empty as of 2026-06-04).

### Other open work (unchanged from prior handover)

- **Stage 2.6(b) browser live-fire** — independent track. Awaits CEO 2-OTP-able inboxes + Stripe Test Mode key + 5 pre-staged test subs.
- **Sales-side optimizations** — `historical_access_from` projection, `index_contacts_by_email.json`, contact-by-email uniqueness invariant. Sales-owned.
- **Q7 — Stripe Customer Portal config + URL** — affects `/account/` portal + welcome page.
- **Q2 — Welcome-send flow Option A vs B** — Newsletter-side concern; Website ships zero code either way in v1.
- **Q5 — Re-subscribe envelope ownership** — separate spec; not initial-checkout scope.
- **Q3 — Postmark plan upgrade trigger** — Newsletter-side; defer.

## Open Questions (CEO)

(Unchanged from prior handover, modulo Q4 + Q6a resolved this session.)

| # | Resolved? | Notes |
|---|---|---|
| Q1 | RATIFIED 2026-06-08 | Section 2 Option B. |
| Q2 | OPEN | Welcome-send Option A recommended; defer until acquisition rate ≥ 10/wk. |
| Q3 | OPEN | Newsletter-side; defer. |
| Q4 | **RATIFIED 2026-06-16** | Monthly + annual together (6 Prices). |
| Q5 | OPEN | Re-subscribe envelope; separate spec. |
| Q6a | **RATIFIED 2026-06-16** | MBP pricing as-is + ELEVATE50 promo (50%/3 mo, max_redemptions=100, first-time-only). |
| Q6b | RATIFIED 2026-06-16 | Restricted key scope: `write:checkout.sessions` only. |
| Q6c | EXECUTED 2026-06-16 | Test Mode provisioning complete. LIVE work pending after validation gate. |
| Q7 | OPEN | Stripe Customer Portal config. Affects welcome page + `/account/`. |

## Do Not Re-Try (Carried Fleet Rules + 2026-06-16 additions)

(Carry-forward + additions from this session.)

- **From 2026-06-16 (this session):** Cloudflare KV's `expirationTtl` floor is 60 seconds. Any KV write with TTL < 60 throws at runtime. Spec design tables that show < 60s TTL are aspirational; always validate against Cloudflare runtime constraints. Captured inline at `src/idempotency.ts:8`.

- **From 2026-06-16:** Stripe MCP OAuth grant is mode-locked at consent time. The toggle in `dashboard.stripe.com/settings/mcp` is global (account-level), not mode-specific. Live's built-in Test Mode has NO MCP toggle at all. Sandbox MCP is a separate `acct_` boundary with its own toggle. **To do Stripe API write work from an agent: use a Test Mode restricted/secret key passed via the fleet dotenv pattern (`~/.elevationary/secrets.env` loaded by a named script using `dotenv.load_dotenv()`). Do NOT attempt MCP-based mode switching — it's a dead-end on this account configuration.**

- **From 2026-06-16:** Stripe Checkout Session `subscription_data` is a **write-only request parameter** — not returned in GET responses. To verify metadata propagation, complete the Session via test card and inspect the resulting Subscription's `metadata`, OR trust the encoder's unit tests + Python-replica verification. Do NOT interpret an empty `subscription_data` field in Session retrieve as evidence the metadata wasn't set.

- **From 2026-06-16:** When MCP OAuth is intractable, pivot to bearer-token API access via named script + dotenv. The classifier blocks inline `python3 -c` reads of `~/.elevationary/secrets.env` (correct), but allows named-script execution that reads via `dotenv.load_dotenv()`. Mirror `send_brian.py` / `memory_router.py` patterns.

(All prior rules from 2026-06-09 and earlier carry forward unchanged.)

## Infrastructure State

- **Cloudflare Pages** auto-deploy active from `github.com/Elevationary/elevationary-main-site`. Pre-this-session build still live.
- **Cloudflare Worker `subscriber-content` v2.2** — version `459d1ab9-e767-4c83-b73c-3a7ba2b41c63` DEPLOYED. Untouched today.
- **Cloudflare Worker `subscribe-checkout-preview`** — **DEPLOYED 2026-06-16 — version `cd0567cb-17f2-4681-8f10-9056f1c0ddcf`** at `https://subscribe-checkout-preview.ar-ef1.workers.dev`.
- **Cloudflare Worker `subscribe-checkout` (production env)** — NOT YET DEPLOYED.
- **Cloudflare KV namespaces created today:**
  - `subscribe-checkout-IDEMPOTENCY_KV_preview` → `dd29099b31b5431fba7cfe6aa32242f5` (bound to preview Worker).
  - `subscribe-checkout-IDEMPOTENCY_KV` → `9c504f7ad12f48118df4d0f8f686f489` (production, created but unbound — will bind when production Worker deploys).
- **Cloudflare Access "Subscriber Content"** — CONFIGURED + ACTIVE. AUD `3c0a5765…0bfa`. Untouched today.
- **R2 bucket `gemini-content-factory`** — single bucket; `sales/` + `newsletter/` prefixes. Untouched today.
- **Stripe Test Mode catalog (`acct_1S9DtzC5seLx7yR7` in Test Mode)** — provisioned today. 3 Products + 6 Prices + Founding Coupon + ELEVATE50 promo. IDs in `scripts/stripe_test_ids.json`.
- **Stripe LIVE catalog (`acct_1S9DtzC5seLx7yR7`)** — 3 Products + 6 Prices pre-existing (2026-03-26). 2 stale Coupons + 100 stale PREVIEW codes scheduled for deactivation.
- **Stripe second account `acct_1SFiCnCOzcWjCZ90`** — separate Elevationary, Inc account; provenance unknown. P4D3 audit task filed.
- **Stripe Sandbox account `acct_1S9DuBC3YEf5bh1i`** — exists, untouched today.
- **Worker secrets (preview env)** — `STRIPE_SECRET_KEY` (Test Mode `sk_test_...`) + 6 `STRIPE_PRICE_*` IDs all set via `wrangler secret bulk`.
- **DNS:** Cloudflare hosted zone unchanged.
- **Telegram bot:** `agentName: "Website"` in `~/.elevationary/bots.json` entry [8].

## Branch State

On `main`. 2026-06-16 substantive commit: `d8310ab` (Stripe Test Mode catalog + preview Worker deploy). 2026-06-17 interim wrap-up commit appends this handover refresh + backlog reaffirmation as a single doc-only commit (no code change). Untracked carried: `.tmp/`, `directives/CLAUDE_CODE.md.bak.20260520`, `docs/SESSION_LOG.md`, snapshot autosaves, `.claude/` internal state.

## Tech Stack

(Unchanged + new today.)

- Eleventy 3.1.5 · luxon 3.7.2 · Cloudflare Pages · Cloudflare Worker `subscriber-content` v2.2.
- subscribe-checkout Worker: TypeScript, `@cloudflare/workers-types`, no production deps (direct fetch against Stripe REST + hand-rolled form encoder).
- **NEW today — provisioning scripts:** Python 3 + `dotenv` (already fleet-standard) + `requests` (already fleet-standard). At `workers/subscribe-checkout/scripts/`.

## ORS + Walkthrough + L4 Cross-References

- **Spec (canonical work order — prior session):** `~/Antigravity_Data/Website/docs/plans/stripe_checkout_integration_spec_2026_06_08.md` — ORS PASS 2026-06-08. L4 `agent-context/stripe_checkout_integration_spec_2026_06_08-d1c0288f`.
- **Skeleton ORS (prior session):** `~/Antigravity_Data/Website/docs/ORS_logs/ORS_website_stripe_checkout_skeleton_2026_06_09.md` — ORS PASS (Standard). L4 `ors-logs/-c08f14f9`.
- **Skeleton walkthrough (prior session):** `~/Antigravity_Data/Website/docs/walkthroughs/walkthrough_stripe_checkout_skeleton_2026_06_09.md`. L4 `walkthroughs/-fbb339fd`.
- **Activation-time ORS (this session work):** TBD — opens at next session when LIVE work begins. Will document the full Test Mode → LIVE flip + smoke results + remediation for the EMAIL_LOCKOUT_TTL bug + observability signal definition.
- **Paired Newsletter spec (read-only reference):** `~/Antigravity_Data/Newsletter/docs/plans/subscriber_funnel_architecture_2026_06_08.md`.
- **Sales contract source-of-truth:** `~/Antigravity/Elevationary_Sales/scripts/stripe_webhook.py` lines 204–305 + `subscription.schema.json` v2.
- **Stage 2.6(b) runbook (carried):** `~/Antigravity_Data/Website/docs/stage_2_6b_live_fire_runbook_2026_06_04.md`.
- **Pass 2 ORS (carried — trust anchor for Worker v2.2):** `ORS_p9_d3_detailed_redteam_pass2_2026_06_03.md` — ORS PASS (Detailed).
