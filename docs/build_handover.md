# Website Build Handover — 2026-06-20 (TEAMAGENT TRANSITION POINT — read end-to-end on cold restart)

## ⚡ TRANSITION NOTICE (TOP)

**This is the boundary between Claude Code IDE environment and TeamAgent environment.**

The Website agent is transitioning from the Claude Code IDE (where this handover was written) to a TeamAgent instance operating via A2A (agent-to-agent) messaging + Telegram interface. **The first thing the new TeamAgent should do on restart is read this entire document, then run the Onboarding Scan per `directives/CLAUDE_CODE.md`.** All prior session state is captured here in dense form.

**If you're the new TeamAgent reading this — welcome back to yourself. You are Website. Everything you need to resume work is below.**

---

## Identity

| | |
|---|---|
| **Agent** | Website (Public-Facing Web Properties Code Specialist) |
| **Reports to** | Administrator (Fleet COO + Code Pilot) → Business Leader (James) |
| **App code** | `/Users/jamesszmak/Antigravity/Website/` — Eleventy 3.1.5 site + Cloudflare Workers |
| **Data dir** | `/Users/jamesszmak/Antigravity_Data/Website/` — ORS logs, plans, walkthroughs, audits, archives |
| **Telegram bot** | display name `ElWebsite`, canonical `@EleSentinelIntelBot`, agent name `Website` in `~/.elevationary/bots.json` entry [8] |
| **Deploy chain** | Cloudflare Pages auto-builds from `github.com/Elevationary/elevationary-main-site` on push to `main`. Build = `npm run build` → `_site/`. Cloudflare reads from GitHub, not local. |
| **GitHub remote** | `https://github.com/Elevationary/elevationary-main-site` |
| **Production URL** | `https://elevationary.com` (HTTP/2 200 verified 2026-06-20) |
| **Brand authority** | Elevationary_Marketing owns voice/tone/visual; Website implements. `~/Antigravity/Elevationary_Marketing/brand/` still partially empty as of last check. |

**M.O.S.T. attribution** (per Team Elevation doctrine, M.O.S.T. canonical ratified 2026-06-17): **O3 + O2 / S2 + S6 + S7 / I1 Subscription Revenue** (primary) + **O4 + O3 / S7 + S2 / I6 Brand Foundation** (secondary).

---

## ⭐ CURRENT STATE — One-paragraph summary

**Stripe Checkout preview Worker is deployed at `https://subscribe-checkout-preview.ar-ef1.workers.dev` (version `cd0567cb-17f2-4681-8f10-9056f1c0ddcf`) with Test Mode Stripe catalog fully provisioned. We are awaiting CEO James to browser-complete a single Test Mode checkout (`task_aeec81fc`) to validate that `subscription_data.metadata` propagates correctly to the resulting Subscription. Once that gate flips, `task_b0d86b20` LIVE activation begins.** Parallel work item `task_d02e87e8` (Eleventy `/subscribe/` lane-picker UI) is unblocked and could start anytime. Production smoke clean. No code is broken. No money is at risk. Resume from `task_b0d86b20` when CEO confirms validation.

---

## ⭐ EXACT NEXT ACTION ON RESTART

### Step 1 — Onboarding Scan (mandatory before any work)

Run the standard Onboarding Scan per `directives/CLAUDE_CODE.md`:

1. `cd ~/Antigravity/Website && python3 ~/.gemini/antigravity/skills/time_keeper/scripts/time_keeper.py START`
2. `cat docs/build_handover.md` (this file)
3. `ls -lt /Users/jamesszmak/Antigravity_Data/Website/docs/ORS_logs/ | head -5` then read the most recent ORS log end-to-end. **Trust anchor: most recent log is `ORS_website_team_elevation_self_audit_2026_06_17.md` — PASS Standard.** Audit class, doc-only ORS.
4. Read `docs/backlog.md` — top entries are Team Elevation findings + Stripe LIVE activation gate.
5. `~/.gemini/antigravity/runtime/fleet_engine_venv/bin/python3 ~/.gemini/antigravity/skills/memory_router/scripts/memory_router.py status` — memory stack health.
6. `curl -sI https://elevationary.com/` — production smoke.

### Step 2 — Query P4D3 for your current-state surface

Per the Team Elevation doctrine (newly enforced):

```
get_project("Subscription_Revenue_Pipeline")
list_tasks(project_id="Subscription_Revenue_Pipeline", owner="Website")
```

You should see your scope_text M.O.S.T. attribution + Phase P4_Entitlement_Worker_and_Gated_Routes active + current Tasks `task_b0d86b20` (🟡, your next action when unblocked) and `task_d02e87e8` (🟡, parallelizable).

Also check **`task_aeec81fc`** (Owner: James) — if it's flipped 🟢, the validation gate cleared and you can immediately begin LIVE activation. If still 🔲, see Step 3.

### Step 3 — Page James via Telegram if validation gate still open

If `task_aeec81fc` is still 🔲, send a one-line Telegram check-in:

```bash
python3 ~/.gemini/antigravity/skills/telegram_pager/scripts/send_notification.py "Website" \
  "Website TeamAgent online. Standing by for CEO Test Mode validation: Session cs_test_b1F6pJK0qM6amjrUNeuveDsQkm6fX52TiRnlu66NWf8OJ4ozWNFpvHNyHV with card 4242 4242 4242 4242. Once complete, task_b0d86b20 LIVE activation begins."
```

### Step 4 — Pick your next action based on James's response

- **If James confirms validation passed:** Proceed to LIVE activation per the activation sequence below.
- **If James asks you to start UI work:** Proceed to `task_d02e87e8` (Eleventy `/subscribe/` lane-picker + `/subscribe/welcome/` landing page).
- **If James points you elsewhere:** Follow his direction; this handover is the resume point if anything is unclear.

---

## ⭐ LIVE Activation Sequence (post-validation gate)

When James confirms `task_aeec81fc` validation passed, execute in this order:

1. **Confirm validation result via API** — Retrieve the resulting Subscription via Stripe API and verify `subscription.metadata` contains all 5 expected fields (`contact_id`, `stream`, `tier`, `swimlanes_accessible`, `source`). The fresh validation Session was `cs_test_b1F6pJK0qM6amjrUNeuveDsQkm6fX52TiRnlu66NWf8OJ4ozWNFpvHNyHV` (Individual monthly). Use `stripe_provision.py inspect-session --mode test --session cs_test_...` after extending it to follow the `subscription` field to retrieve the Subscription object. (Note: `subscription_data` is write-only on Session retrieve — verified Stripe API design — must follow `session.subscription` field to the Subscription object.)

2. **Switch to LIVE mode credentials** — You'll need `STRIPE_LIVE_KEY` set in `~/.elevationary/secrets.env`. James creates a restricted API key in Stripe Dashboard (LIVE mode, `acct_1S9DtzC5seLx7yR7`) with scope **`write:checkout.sessions` ONLY** (per spec § 8 F-11). He pastes the value into secrets.env himself (classifier-protected; you never see the value).

3. **Create LIVE Founding Coupon + ELEVATE50 Promotion Code** — Products + Prices already exist in LIVE (since 2026-03-26, MBP-matching). Only the promo objects need creation. Run:
   ```bash
   python3 ~/Antigravity/Website/workers/subscribe-checkout/scripts/stripe_provision.py create-all --mode live --i-mean-live
   ```
   Edit the script's `create-all` to skip Product/Price creation in LIVE mode (since they exist) — or write a `create-promo-only --mode live` subcommand. **Save IDs to `scripts/stripe_live_ids.json`** (gitignored — contains LIVE Price IDs which are not secret but James prefers they not be in git).

4. **Deactivate 100 stale PREVIEW-XXXXXX codes in LIVE** — Run:
   ```bash
   python3 .../stripe_provision.py deactivate-promo-codes --mode live --i-mean-live --coupon dTwd1p8S
   python3 .../stripe_provision.py deactivate-promo-codes --mode live --i-mean-live --coupon TEyye1SG
   ```
   This sets `active=false` on each code (reversible). CEO confirmed deactivation 2026-06-16.

5. **Configure production env Worker** — Run:
   ```bash
   python3 .../scripts/configure_worker_secrets.py --env production
   ```
   This reads `STRIPE_LIVE_KEY` + LIVE Price IDs from `stripe_live_ids.json` and pushes 7 secrets via `wrangler secret bulk`.

6. **Uncomment production routes block** in `wrangler.toml`:
   ```toml
   [[routes]]
   pattern = "elevationary.com/api/checkout/*"
   zone_name = "elevationary.com"
   ```
   Also uncomment production env `r2_buckets` + `kv_namespaces` blocks (KV production ID is `9c504f7ad12f48118df4d0f8f686f489` — already in `scripts/stripe_test_ids.json`).

7. **Deploy production Worker:**
   ```bash
   cd ~/Antigravity/Website/workers/subscribe-checkout && ./node_modules/.bin/wrangler deploy
   ```
   (No `--env preview` flag → production deploy.)

8. **Append Secret Consumer Registry row** at `~/Antigravity_Data/Administrator/docs/secret_consumer_registry.md` — name + smoke test only, NEVER value. Format: see existing rows for `subscriber-content` Worker as reference pattern.

9. **Run a controlled LIVE round-trip** — Submit a real-money checkout via the production Worker using ELEVATE50 promo. Cheapest path: Individual monthly $29 × 50% off = $14.50. Refund immediately via Stripe Dashboard. Cancel sub. Clean up the Sales R2 entries (`sales/contacts/ct_*` + `sales/subscriptions/sb_*` + any inbox events). Document the cleanup in the implementation ORS.

10. **Detailed-rigor implementation ORS** documenting all steps + remediations + final state. L4 vault upload. Update build_handover + backlog. Telegram page James.

**Total LIVE activation effort: ~1-2 hours.**

---

## Repository structure (orient yourself)

```
~/Antigravity/Website/
├── CLAUDE.md                           # global agent OS — points to directives/CLAUDE_CODE.md
├── directives/
│   ├── CLAUDE_CODE.md                  # FULL operating directives — Team Elevation doctrine landed 2026-06-17 eve
│   ├── agent_charter.json
│   ├── charter.md
│   └── divergence_protocol.md
├── docs/
│   ├── build_handover.md               # this file
│   ├── backlog.md                      # active items
│   ├── ORS_logs/
│   │   └── TEMPLATE.md                 # copy this when opening a new ORS
│   └── SESSION_LOG.md                  # session diary (auto-managed)
├── src/                                # Eleventy 11ty site source
│   ├── _data/site.json                 # currently has placeholder stripeCheckout*Url keys to drop
│   ├── subscribe/
│   │   └── index.njk                   # placeholder Payment Link CTAs — to be replaced with /api/checkout form
│   └── (other njk templates)
├── workers/
│   ├── subscriber-content/             # v2.2 DEPLOYED — entitlement gating Worker; do not touch unless explicit task
│   └── subscribe-checkout/             # ⭐ ACTIVE — Stripe Checkout Worker
│       ├── src/
│       │   ├── index.ts                # router: POST /api/checkout, OPTIONS CORS
│       │   ├── types.ts                # CheckoutRequest, SubscriptionMetadata, Env, errors
│       │   ├── validation.ts           # spec § 3.2 email + § 3.5 stream derivation
│       │   ├── ct_id.ts                # spec § 3.4 email → ct_id
│       │   ├── contact.ts              # spec § 3.11 Sales Contact JSON shape; R2 read/write; DRY_RUN supported
│       │   ├── stripe.ts               # spec § 3.3 form encoder; § 6 Stripe API version pin
│       │   ├── idempotency.ts          # KV per-IP rate limit + per-email lockout (TTL 60s minimum — see Do Not Re-Try)
│       │   ├── origin.ts               # spec § 3.8 allow-list per env
│       │   └── webhook.ts              # STUB — forward optionality only; NOT routed in v1
│       ├── test/                       # 5 vitest suites, 62/62 passing
│       ├── scripts/
│       │   ├── stripe_provision.py     # ⭐ STRIPE CRUD via dotenv pattern — primary tool
│       │   ├── configure_worker_secrets.py  # ⭐ wrangler secret bulk pusher
│       │   └── stripe_test_ids.json    # Test Mode Price IDs (NOT secrets)
│       ├── package.json
│       ├── tsconfig.json
│       ├── wrangler.toml               # preview env active; production routes commented until LIVE activation
│       ├── vitest.config.ts
│       └── README.md
└── (other site infra)

~/Antigravity_Data/Website/             # data dir — read-only-from-app side; written via vault_upload.py + handover commits
├── docs/
│   ├── ORS_logs/                       # ORS logs land here (NOT in app repo)
│   ├── walkthroughs/                   # walkthroughs land here
│   ├── audits/                         # NEW directory — Team Elevation self-audit landed 2026-06-17
│   ├── plans/                          # specs + plans
│   │   └── stripe_checkout_integration_spec_2026_06_08.md  # ⭐ canonical work order — 670 lines, ORS PASS
│   └── stage_2_6b_live_fire_runbook_2026_06_04.md          # entitlement matrix runbook
└── (archives, fixtures, etc.)
```

---

## Active Workstreams (priority order)

### Workstream 1 — Stripe Checkout activation (BLOCKED on CEO validation, then ~1-2 hr)

**State:** Preview Worker deployed; Test Mode catalog provisioned; smoke test green; awaiting browser-validation of `subscription_data.metadata` propagation.

**P4D3 anchor:** `Subscription_Revenue_Pipeline / P4_Entitlement_Worker_and_Gated_Routes`.

**Active tasks:**
- `task_aeec81fc` — Owner: James — Browser-complete Test Mode validation (~1 min). **Gates Workstream 1 continuation.**
- `task_b0d86b20` — Owner: Website — Stripe LIVE activation (~1-2 hr after validation).
- `task_d02e87e8` — Owner: Website — Eleventy `/subscribe/` lane-picker UI + welcome page (parallelizable).

**Test Mode catalog already created (DO NOT DUPLICATE):**

| Stripe object | Test Mode ID |
|---|---|
| Individual Product | `prod_UiS1oM8SxbxR4D` |
| Functional Bundle Product | `prod_UiS1JaalWtSXx2` |
| All-Access Product | `prod_UiS1QyciLNfarx` |
| Individual Monthly Price ($29) | `price_1Tj17iC5seLx7yR7xKVzzVd1` |
| Individual Annual Price ($290) | `price_1Tj17iC5seLx7yR7oYuM4WqJ` |
| Functional Bundle Monthly ($69) | `price_1Tj17jC5seLx7yR7ge0RMoNv` |
| Functional Bundle Annual ($690) | `price_1Tj17jC5seLx7yR7ZT6vHxn7` |
| All-Access Monthly ($149) | `price_1Tj17kC5seLx7yR7rr8tDM8o` |
| All-Access Annual ($1,490) | `price_1Tj17kC5seLx7yR7YoZbAsde` |
| Founding Coupon (50%/3mo) | `EJ7eBI1C` |
| ELEVATE50 Promotion Code | `promo_1Tj17lC5seLx7yR7N8oUXo2D` |

**LIVE Stripe catalog already exists** (from 2026-03-26, untouched today):
| | |
|---|---|
| LIVE Individual Product | `prod_UPCUd0AYlpLqVy` |
| LIVE Functional Bundle Product | `prod_UPCUsdMrbEF9tB` |
| LIVE All-Access Product | `prod_UPCUMfSb1rmPs9` |
| LIVE Prices (6) | `price_1TQO5Y/Z/aC5seLx7yR7...` — see `scripts/stripe_test_ids.json` comment block or query LIVE via `stripe_provision.py list --mode live --i-mean-live` |
| Stale Coupons to deactivate | `dTwd1p8S` + `TEyye1SG` (100 PREVIEW-XXXXXX codes attached) |

**LIVE objects NOT YET CREATED:**
- LIVE Founding Coupon (50%/3 months)
- LIVE ELEVATE50 Promotion Code
- LIVE restricted API key for Worker (scope: `write:checkout.sessions`)

### Workstream 2 — Stage 2.6(b) browser live-fire (independent track)

**State:** Awaits CEO 2-OTP-able inboxes + 1 Stripe Test Mode key + 5 pre-staged test subscriptions. Independent of Stripe Checkout integration. Paint-by-numbers runbook exists at `~/Antigravity_Data/Website/docs/stage_2_6b_live_fire_runbook_2026_06_04.md` (992 lines, L4 vault `agent-context/-9d9d699c`).

### Workstream 3 — `/subscribe/` UI work (parallelizable with Workstream 1)

**State:** Per spec § 4, Eleventy work to ship lane-picker forms (Individual 1 / Functional Bundle 3 / All-Access stream-only) + drop placeholder `stripeCheckout*Url` keys from `src/_data/site.json` + create `/subscribe/welcome/` landing page. Functional-but-unstyled v1; brand pass deferred until Marketing brand foundation lands. P4D3: `task_d02e87e8`.

### Workstream 4 — Second Stripe account audit (low priority)

**State:** P4D3 `task_1ec7983b` filed for investigating `acct_1SFiCnCOzcWjCZ90` (separate "Elevationary, Inc" account, provenance unknown). Not blocking.

### Workstream 5 — `Migrate_ElevationaryCom` Phase 2 (between-phases, gated on cross-team)

**State:** Phase 1 substantively complete; Phase 2 awaits Elevationary_OS design doc + Newsletter handoff format Decisions (both 🔲 in P4D3). Not blocking Workstream 1.

### Workstream 6 — Team Elevation drift follow-ups

**State:** 3 open COO dispositions surfaced 2026-06-17:
- **F1** — Update_EOs cross-owner status flip doctrine call.
- ~~**F2**~~ — RESOLVED: CLAUDE_CODE.md amendment landed in `directives/` on 2026-06-17 eve (backup `CLAUDE_CODE.md.bak.20260617_eve_te_gap_close` evidences the patch).
- **F4** — Fleet-wide Probation horizon convention. Once set, file Probation deliverable for `subscribe-checkout-preview` Worker.

Plus 4 lower-priority findings in audit doc (cross-teammate Decision ownership; P4D3 v3 `list_rows_by_owner` request; column-header text leak; duplicate phases in Migrate_ElevationaryCom).

---

## Credentials + Secrets (paths, NEVER values)

| Secret | Path / location | Notes |
|---|---|---|
| `STRIPE_TEST_KEY` | `~/.elevationary/secrets.env` as `STRIPE_TEST_KEY=sk_test_...` | Test Mode, set 2026-06-16 |
| `STRIPE_LIVE_KEY` | `~/.elevationary/secrets.env` (NOT YET SET) | LIVE restricted, will be `rk_live_...` with `write:checkout.sessions` scope after James creates in Dashboard |
| Worker preview env secrets | Cloudflare via `wrangler secret bulk` | 7 secrets pushed 2026-06-16: `STRIPE_SECRET_KEY` + 6 `STRIPE_PRICE_*` IDs |
| Worker production env secrets | Cloudflare (NOT YET PUSHED) | Will mirror preview env structure with LIVE values |
| `TELEGRAM_API_KEY` + `TELEGRAM_USER_ID` | `~/.elevationary/secrets.env` | Already set for `send_notification.py` |
| `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID` | `~/.elevationary/secrets.env` | For voice messages via `send_brian.py` (rarely used) |
| Cloudflare Worker tokens | Wrangler login persistent at `~/.wrangler/` | Logged in to James's CF account; full Workers/Pages/D1/Zone permissions |

**Classifier protection:** `~/.elevationary/secrets.env` is classifier-blocked from inline reads (`python3 -c`, `cat`, `grep`, etc.). **Use the fleet's dotenv pattern instead:** named scripts that call `dotenv.load_dotenv(os.path.expanduser('~/.elevationary/secrets.env'))`. See `scripts/stripe_provision.py` for the working pattern.

---

## Operational Knowledge (CRITICAL — these gotchas cost me hours)

### Stripe MCP OAuth is a dead-end on this account configuration

**~90 minutes lost to this on 2026-06-16.** Stripe MCP at `mcp.stripe.com`:
- OAuth grant is **mode-locked at consent time**. Toggling the Dashboard mode after-the-fact doesn't switch MCP scope.
- The Live account's built-in Test Mode has **NO MCP toggle at all** (only LIVE has the toggle; Sandbox has its own).
- Sandbox is a separate `acct_id` from Live — wrong account boundary for our use case.

**Solution adopted:** bearer-token via Python script + dotenv pattern. **Use `scripts/stripe_provision.py` for ALL Stripe CRUD.** Subcommands: `probe`, `list`, `create-all`, `inspect-session`, `deactivate-promo-codes`, `test-create-session`. Mode flag: `--mode test` (default) or `--mode live --i-mean-live`. Reads key from `~/.elevationary/secrets.env`.

### Cloudflare KV `expirationTtl` minimum is 60 seconds

Spec § 3.7 listed 30s; reality says 60s. Hit during smoke test 2026-06-16; fixed inline at `src/idempotency.ts:8` with explanatory comment. **Don't trust spec design tables for runtime constraints; verify against Cloudflare runtime.**

### Stripe Checkout Session `subscription_data` is write-only

The field configures the resulting Subscription's metadata at creation time but does NOT echo back on Session GET. **To verify metadata propagation, follow `session.subscription` to the Subscription object after payment completes, then read `subscription.metadata`.** Don't interpret empty `subscription_data` in Session retrieve as evidence the metadata wasn't set.

### Wrangler v3 still in use; v4 is available but not migrated

`./node_modules/.bin/wrangler` is v3.114.17. Wrangler warns at every invocation about v4 being out. **Do NOT migrate to v4 without an explicit Wrangler_v3_to_v4_Upgrade plan** (project exists in P4D3 fleet governance). Migration could break subscriber-content Worker v2.2 production.

### Auto-mode classifier protects you from your own carelessness

Examples that fired correctly on this session:
- `delete LIVE Coupon` blocked when user had said "pause LIVE work first"
- `python3 -c` reading `~/.elevationary/secrets.env` blocked (correct: use named script pattern)
- New Stripe API write attempts blocked when "not in argparse choices" (suspicious novel ops)

**Trust the classifier.** When blocked, re-read its reason — it's catching boundary violations the agent missed.

### Telegram page is REQUIRED at substantial deliverable closures

Per Session Protocol in `directives/CLAUDE_CODE.md` AND auto-memory `feedback_telegram_page_on_substantial_deliverable.md`: **chat reply is NOT the page.** ORS PASS / audit close / dispatch completion / interim wrap-up ALL trigger `send_notification.py "Website" "<message>"`.

### Voice messages use `send_brian.py` (fleet standard) when explicitly requested

Per auto-memory `feedback_voice_messages_use_send_brian.md`: when James asks for a voice message, use `~/.gemini/antigravity/skills/telegram_bot/send_brian.py --agent Website --caption "..." "<text>"`. Cascade: ElevenLabs Brian (primary) → Gemini Charon → macOS say. **Not `telegram_pager` — that's text only.**

### M.O.S.T. attribution discipline (Team Elevation doctrine, 2026-06-17)

Every active Project's `scope_text` MUST reference M.O.S.T. Objective(s) + Strategy(ies). For shared multi-owner Projects, use the **append-pattern** (delimited block `[Website attribution — YYYY-MM-DD] Serves M.O.S.T.: ...`) so other teammates can append theirs without clobber. Don't unilaterally rewrite shared scope_text.

### Stripe Test Mode keys vs Live Mode keys vs Sandbox keys

All three exist; all start with `sk_*` but mean different things:
- `sk_test_51S9Dt...` — Live account in Test Mode. Same `acct_1S9DtzC5seLx7yR7`. **This is the right Test Mode for our spec.**
- `sk_live_51S9Dt...` — Live account in Live Mode. Same account. Real money.
- `sk_test_51S9Du...` — Sandbox account (`acct_1S9DuBC3YEf5bh1i`). Separate account. Unused for our work.

---

## Tech Stack

| Layer | Tool / Version |
|---|---|
| Static site | Eleventy 11ty 3.1.5 + luxon 3.7.2 |
| Deploy | Cloudflare Pages (auto from `main`) |
| Workers (production) | `subscriber-content` v2.2 (`459d1ab9-…`) — entitlement gating |
| Workers (preview) | `subscribe-checkout-preview` (`cd0567cb-…`) — Stripe checkout creation |
| Worker TS | `@cloudflare/workers-types`, no prod deps (`subscribe-checkout`); `marked@^12` for `subscriber-content` |
| Worker tests | vitest 2.1 — `subscribe-checkout` 62/62 passing |
| Wrangler | 3.114.17 (v3) |
| Stripe API version | `2025-08-27.basil` (pinned in `wrangler.toml [env.preview.vars]`) |
| R2 bucket | `gemini-content-factory` (shared with Sales/Newsletter via `sales/` + `newsletter/` prefixes) |
| KV namespaces | `subscribe-checkout-IDEMPOTENCY_KV_preview` (`dd29099b…`) + production (`9c504f7a…`) |
| Stripe accounts | LIVE `acct_1S9DtzC5seLx7yR7` (Elevationary, Inc), Sandbox `acct_1S9DuBC3YEf5bh1i`, mystery `acct_1SFiCnCOzcWjCZ90` (P4D3 audit task filed) |
| Fleet scripts | Python 3.13 + `dotenv` + `requests` |

---

## Communication channels (new environment)

| Channel | Use case | How to send |
|---|---|---|
| **Telegram** (primary outbound to James) | Status reports, substantial-deliverable closures, blockers | `python3 ~/.gemini/antigravity/skills/telegram_pager/scripts/send_notification.py "Website" "<text>"` → `@EleSentinelIntelBot` → James's phone |
| **Telegram voice** | When James explicitly requests voice | `python3 ~/.gemini/antigravity/skills/telegram_bot/send_brian.py --agent Website --caption "..." "<text>"` |
| **A2A messaging** (inter-agent) | Coordinating with Sales, Newsletter, Administrator, etc. | A2A protocol (specifics depend on TeamAgent runtime — confirm at restart) |
| **P4D3** | Work state + task delegation tracking | `elevationary_p4d3_*` MCP tools |
| **Git** | Code + docs persistence | `git commit` + `git push` on `main` → Cloudflare Pages auto-deploys |
| **L4 vault** | Long-term doc storage | `~/.gemini/antigravity/skills/knowledge_vault/scripts/vault_upload.py upload <vault> <path>` |

---

## "Do Not Re-Try" rules (carry-forward from prior sessions + this session)

(Comprehensive — every lesson the prior agents earned. Honor these.)

### From 2026-05-20 — ORS-first discipline

Open the ORS log as the **first artifact** of any deliverable. `claude_wrap_up.py` is gated on an ORS log dated today. `--skip-ors` is for sessions with no deliverable; otherwise the wrap-up refuses. Earned during Administrator's ORS discipline ratification.

### From 2026-05-30 — Auth/identity/entitlement gates require executable tests

Static red-team alone is insufficient for auth-related code. Always write executable tests with fixtures + assertions. Fleet lesson `fleet_lesson_executable_security_tests_over_static_redteam`.

### From 2026-06-02 — Cross-agent schema migrations need consumer-side executable tests first

When an upstream schema changes, run consumer-side test matrix BEFORE shipping. Type system + first failing test name the exact drift.

### From 2026-06-02 — Runtime JSON shape vs TypeScript type drift

`Array.isArray()`, `typeof === "string"` at use-site. Don't trust TS types match runtime JSON. Worker v2.1 had 3 bugs caught this way.

### From 2026-06-02 — Markdown rendering must escape HTML by default

`marked@^4` removed `sanitize` default. Override `renderer.html` or wrap with DOMPurify. Worker v2.1 had critical XSS via `marked@^12` raw-HTML passthrough.

### From 2026-06-02 — ORS Stage 3 demands real induction, not characterological reasoning

"We believe it handles X" doesn't count. Trigger the failure mode and observe. Re-induce with adversarial cold-read perspective.

### From 2026-06-04 — Strict JWT verifiers must check `nbf` and `exp`

Token with `nbf=now+3600s` was silently accepted pre-fix. `verifyAccessJwt` patched. Fleet lesson `jwt_strict_must_check_nbf`.

### From 2026-06-04 — "This command catches X" needs verifier-of-verifier

Positive AND negative fixtures. Heller F9 generalized. Fleet lesson `verify_the_verifier`.

### From 2026-06-04 — Runbook prep needs cold-read adversarial review

When a runbook is the verifier of a matrix, induce ≥5 failure modes against the runbook BEFORE shipping.

### From 2026-06-08 — Cross-agent spec alignment requires reading paired spec end-to-end

Lift contract-shape recommendations from the actual consumer code, not from prose summaries. Terminology drift (`customer.metadata` vs `subscription.metadata`) propagates through docs; only code is authoritative.

### From 2026-06-09 — L1 divergence allowed for forward-optionality stubs

When dispatch asks for X but spec says X belongs to a different agent, file the stub with a banner comment documenting the divergence; don't route it in v1.

### From 2026-06-14 — Voice messages use Brian cascade

Use `send_brian.py`, not `telegram_pager`. See `feedback_voice_messages_use_send_brian.md`.

### From 2026-06-16 — Cloudflare KV TTL minimum is 60 seconds

Hit during smoke test. Fixed at `src/idempotency.ts:8`. Don't trust spec design tables for runtime constraints.

### From 2026-06-16 — Stripe MCP OAuth is mode-locked at grant time

Doesn't honor dashboard mode toggle. Use bearer-token via dotenv pattern via named script. See `scripts/stripe_provision.py`.

### From 2026-06-16 — Stripe `subscription_data` is write-only on Session retrieve

To verify metadata propagation, follow `session.subscription` to the Subscription object after payment completes.

### From 2026-06-16 — Classifier blocks inline `python3 -c` reads of secrets

Use the named script + dotenv pattern (mirrors `send_brian.py`, `memory_router.py`). Classifier allows `python3 path/to/script.py`.

### From 2026-06-17 — Team Elevation doctrine: every active teammate has current-state P4D3 surface

Per `directives/CLAUDE_CODE.md`. Forbidden state: operating dispatch-to-dispatch without a P4D3 Project anchoring your work. Every active Project's `scope_text` references M.O.S.T. Use append-pattern for shared Projects.

### From 2026-06-17 — Telegram page is REQUIRED at substantial deliverable closures

Chat reply is NOT the page. ORS PASS / audit close / dispatch completion ALL trigger `send_notification.py "Website" "<message>"`. See `feedback_telegram_page_on_substantial_deliverable.md`.

---

## Auto-memories (TeamAgent should re-ingest these on restart)

Two auto-memories saved at `~/.claude/projects/-Users-jamesszmak-Antigravity-Website/memory/`:

1. **`feedback_voice_messages_use_send_brian.md`** — Brian (ElevenLabs) cascade for voice; `telegram_bot/send_brian.py --agent Website`.
2. **`feedback_telegram_page_on_substantial_deliverable.md`** — Telegram page mandatory at ORS PASS / audit close / wrap-up; never chat-only.

The new TeamAgent should check whether its restart environment loads these. If memory format differs, the lessons should be re-stated in the equivalent format.

---

## P4D3 Surface (current snapshot)

Per Team Elevation doctrine compliance:

```
Owner=Website Projects (4):
├── (a) In-flight Phase
│   └── Subscription_Revenue_Pipeline / P4_Entitlement_Worker_and_Gated_Routes
│       ├── P4_D1_Entitlement_Worker (mostly 🟢, task_b0d86b20 🟡 LIVE activation)
│       └── P4_D2_Gated_Route_Pages (mostly 🟢, task_d02e87e8 🟡 Eleventy UI)
├── (c) Between-phases / awaiting-trigger
│   └── Migrate_ElevationaryCom (Phase 1 substantively done; Phase 2 awaits cross-team)
├── DRIFT
│   └── Update_EOs (22/22 tasks 🟢, Project/Phases/Deliverables stuck 🔲; F1 surfaced)
└── Closed 🟢
    └── WebSiteFoundation

Tasks blocking us:
├── task_aeec81fc 🔲 — Owner: James — CEO browser-completes Test Mode validation Session
├── task_b0d86b20 🟡 — Owner: Website — Stripe LIVE activation (unblocks when task_aeec81fc → 🟢)
├── task_d02e87e8 🟡 — Owner: Website — Eleventy /subscribe/ UI (parallelizable)
└── task_1ec7983b 🔲 — Owner: James — Second Stripe account audit (low priority)
```

`scope_text` on both active Projects has M.O.S.T. attribution appended (verified via re-query 2026-06-17).

---

## Carry-over status: every prior interim handover section preserved at L4

Full prior session histories are searchable via L3 + retrievable via L4 vaults:
- L4 walkthroughs vault: includes `walkthrough_stripe_checkout_skeleton_2026_06_09-fbb339fd` (architecture tour), `walkthrough_website_team_elevation_self_audit_2026_06_17-75c667` (audit narrative).
- L4 ors-logs vault: `ORS_stripe_checkout_integration_spec_2026_06_08-d1c0288f` (spec, 670 lines), `ORS_website_stripe_checkout_skeleton_2026_06_09-c08f14f9`, `ORS_website_team_elevation_self_audit_2026_06_17-72e36ccf`.
- L4 agent-context vault: spec doc + Stage 2.6(b) runbook.

---

## Branch State

On `main`. Recent commits:
- `fda0fef` (timelog auto)
- `2854aa2` — 2026-06-17 interim Team Elevation audit complete
- `d8310ab` — 2026-06-16 substantive: Test Mode catalog + preview Worker deploy
- `28a66f9` — 2026-06-10 interim
- `d9e7d9e` — 2026-06-09 substantive: Worker skeleton

This wrap-up commit appends today's transition handover + backlog update + transition P4D3 task.

Untracked carried (NOT to be committed without explicit need):
- `.tmp/`, `.claude/` (internal state)
- `CLAUDE.md` modifications (likely external)
- `CLAUDE.md.bak.20260616`, `directives/CLAUDE_CODE.md.bak.*` (backups)
- `docs/SESSION_LOG.md` (auto-managed separately)
- `docs/build_handover.md.snapshot-*` (autosaves)

---

## Final Telegram dispatch summary template

When the TeamAgent restarts, after onboarding scan completes, page James:

```
Website TeamAgent online. Onboarding scan green. Standing by for CEO Test Mode validation gate (task_aeec81fc) to unblock LIVE activation. Production smoke 200. Memory stack healthy. No regressions detected. Ready for direction.
```

If task_aeec81fc is already 🟢 when you check:

```
Website TeamAgent online. Onboarding scan green. CEO validation gate task_aeec81fc CLOSED. Beginning LIVE activation sequence per task_b0d86b20. Will page on milestones.
```

---

## Conclusion (a note from the IDE-environment agent to the TeamAgent)

You're well-positioned. The work is well-anchored in P4D3, the next action is paint-by-numbers, the credentials structure is documented, the operational gotchas are captured. The CEO gate is the one externality you can't control — wait for it.

When the gate clears, **trust the encoder** (62/62 unit tests + Python replica verified the form-encoding matches Stripe's spec) and **trust the script pattern** (`stripe_provision.py` is proven). The LIVE activation should be the same flow as Test Mode, just with the right key + flag.

If anything seems off — read this document again. The "Do Not Re-Try" rules section captures everything that's bitten us. The Operational Knowledge section captures everything that took us hours to figure out.

Good luck. — Website Agent, IDE environment, 2026-06-20
