# Website Backlog

> **Project Source of Truth:** Always verify the active project phases and deliverables within the P4D3 database before beginning a session.
> **Backlog tags:** `[CODE]` = Website code work | `[BRAND]` = needs Elevationary_Marketing approval | `[PROCESS]` = COO operational | `[JAMES]` = human action required. Website marks only its own items complete.

## Active

- [ ] **[COO] Subscription_Revenue_Pipeline — Website owns P3 + P4** — CEO-ratified 2026-05-30. P4D3 path: `Operations / Fleet_Governance / Subscription_Revenue_Pipeline` (phases `P3_Cloudflare_Access_Setup` + `P4_Entitlement_Worker_and_Gated_Routes`). Status as of 2026-05-30:
    - [X] **Phase A shipped** (2026-05-30): P3 spec (`cloudflare/access/`), P4_D2 gated route templates + `/unlock/` sweep, P4_D1 deny-by-default Worker scaffold, P4D3 ownership reassigned. Build `c8ce467` live. ORS PASS log: `~/Antigravity_Data/Website/docs/ORS_logs/ORS_subscriptions_phase_a_2026_05_30.md`.
    - [ ] **Phase A close-out (James hand-actions):** (a) Configure Cloudflare Access app per `cloudflare/access/subscriber_content_app.md` checklist. (b) `wrangler deploy` the Worker. (c) Browser live-fire `/editions/` after Access is enabled.
    - [ ] **Phase B claimed 2026-05-30 — P4_D1 entitlement logic.** Sales shipped `~/Antigravity/Elevationary_Sales/schemas/subscription.schema.json` with the ratified `entitlements` shape. Worker: R2 contact-by-email + subscription lookup (individual + enterprise OR-join), Stripe `subscriptions.retrieve` defense-in-depth, entitlement decision, R2 content serve from `newsletter/drafts/<date>/<topic>.md`, `/upgrade?stream=...&edition=...` on fail. Uncomment routes in `wrangler.toml`. Locks: IdP = Google SSO + Email OTP; +50ms Stripe latency accepted; enterprise OR-join on `company_id`. Plan: `~/.claude/plans/i-need-to-clarify-agile-snail.md`. ORS for Phase B opens at task start.

- [ ] **[COO] Extend the Fleet Secret Consumer Registry** — Canonical doc: `~/Antigravity_Data/Administrator/docs/secret_consumer_registry.md`. Website-owned rows to fill: **(a) Stripe checkout + webhook on elevationary.com** (`STRIPE_*` — which keys does the live site read?) + smoke test; **(b) Cloudflare DNS / API** (`CLOUDFLARE_API_TOKEN`, `CF_TOKEN_DNS`) if Website directly reads (vs Administrator-owned tunnel); **(c) DATABASE_URL** if Website uses D1 — disambiguate with El_OS; **(d) VERCEL_TOKEN** — whether Website deploys via the token or CLI-cached auth. Read the registry's "What NOT to store" section before extending — names + smoke tests only, NEVER values. Append rows in place. Phase B will add `STRIPE_SECRET_KEY` Worker-side as a new consumer.

### Follow-ups Surfaced by Phase A

- [ ] **[CODE] Build `/upgrade/` Eleventy template** — Phase B Worker 302s to `/upgrade?stream=<requested>&edition=<date>` on entitlement-fail. Page needs to exist before Phase B deploy.
- [ ] **[CODE] Replace 4 Stripe Checkout placeholders in `src/_data/site.json`** with real URLs — `stripeCheckoutIndividualUrl`, `stripeCheckoutBundleUrl`, `stripeCheckoutAllAccessUrl`, `stripeCustomerPortalUrl`. Lands when Sales P2 ships Checkout session creation (or use Stripe Payment Links if simpler).
- [ ] **[JAMES] Final agent.elevationary.com archival decision** — 52 references remain in `_site/` (consulting redirects in `_redirects`, footer/nav in `base.njk`, services.njk consulting CTAs, llms.txt/ai-plugin.json consulting URLs). Awaiting decision on whether agent.elevationary.com stays as the consulting/agent-catalog subdomain or is fully retired. If retired, second sweep pass needed.
- [ ] **[CODE] Worker → R2 read pattern (list-prefix vs sidecar index)** — Plan §4(c) names `sales/index_subscriptions.json` as the fast-read source maintained by Sales. Verify Sales actually maintains the index before Phase B Worker assumes its presence. Fallback: list-prefix on `sales/subscriptions/`.

### Brand Foundation (still blocking visible-content redesign)
- [ ] **[BRAND] Read `~/Antigravity/Elevationary_Marketing/brand/` cover-to-cover** — directory empty as of 2026-05-30; blocker on Elevationary_Marketing.
- [ ] **[BRAND] Audit current site vs brand standard** — extends to the 3 new routes shipped 2026-05-30 (`/subscribe/`, `/editions/`, `/account/`). Currently use `base.njk` chrome only; awaits brand pass.
- [ ] **[BRAND] Brand-aligned design pass** — typography, imagery, layout, color, motion. Joint with Elevationary_Marketing.

### Production Checklist
- [ ] **[JAMES]/[CODE] Custom domain on Cloudflare Pages** — confirm `elevationary.com` is configured as Pages custom domain. Carry-over; likely already done.
- [ ] **[JAMES] Deployment protection for Preview environments** — verify whether Cloudflare Pages preview environments need Cloudflare Access.

## Operational Rules
- [ ] **Operational Rule:** Do NOT populate this backlog with granular tasks. All granular work must be filed in the P4D3 system.
- [ ] **Operational Rule:** Execute ORS inline during implementation. Do NOT backfill retroactively.
- [ ] **Operational Rule:** Brand-first. No visible-content change ships without Elevationary_Marketing sign-off. *(Phase A infrastructure exception accepted with documented compensating controls; do not generalize.)*
- [ ] **Operational Rule:** Stripe in Test Mode first, every time. Production code requires a Test Mode green pass. *(Worker `subscriptions.retrieve` defense-in-depth uses LIVE key in read-only scope per ratified plan; this is read-only verification, not a charge path.)*

## Icebox

- [ ] **[CODE] Lighthouse audit + optimization pass** — defer until brand pass complete; otherwise re-work.
- [ ] **[CODE] /llms.txt (`llms.njk`)** — review current content; ensure LLM crawler hints align with brand messaging.
- [ ] **[CODE] Eleventy version audit** — currently 3.1.5; track upstream changes.

## Completed (this session — full history at `~/Antigravity_Data/Website/docs/session_log.md`)

- [X] **Phase A — Subscription_Revenue_Pipeline** shipped 2026-05-30. Commits `65fe1a6` (P3 spec), `c486fec` (P4_D2 + sweep), `32382de` (P4_D1 scaffold), `c8ce467` (backlog dispatch surface). Production verified.

## Dropped

- ~~**[CODE] middleware.ts → proxy.ts rename**~~ — N/A for Eleventy; was a stale carry-over from `micro-site` agent. Dropped 2026-05-30.
- ~~**[CODE] Cloudflare Pages build cache hygiene**~~ — `_site/` is correctly gitignored; verified by absence from `git status` after build. Dropped 2026-05-30.
- ~~**[CODE] Design Stripe + Newsletter handoff** (old "propagation channel" item)~~ — superseded by the CEO-ratified Sales R2 CRM design (plan dated 2026-05-30). Handoff is now Sales-owned via `sales/subscriptions/` R2 layout, not direct Website → Newsletter.
- ~~**[CODE] Stripe webhook endpoint on Website**~~ — moved to Sales agent per ratified plan §2. Sales owns the webhook receiver at `webhooks.elevationary.com/stripe`.
- ~~**[CODE] Subscription state → Newsletter agent** (direct handoff)~~ — superseded. Newsletter reads Sales R2 CRM at send time; no direct Website → Newsletter channel.
- ~~**[CODE] Mailchimp deprecation plan**~~ — supersedes-by: deprecation lands as a side-effect of Phase B + Newsletter rewire to Sales R2 CRM. No separate planning item needed.
