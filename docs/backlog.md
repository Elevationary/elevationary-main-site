# Website Backlog

> **Project Source of Truth:** Always verify the active project phases and deliverables within the P4D3 database before beginning a session.
> **Backlog tags:** `[CODE]` = Website code work | `[BRAND]` = needs Elevationary_Marketing approval | `[PROCESS]` = COO operational | `[JAMES]` = human action required. Website marks only its own items complete.

## Active

- [ ] **[COO] Subscription_Revenue_Pipeline — Website owns P3 + P4** — CEO-ratified 2026-05-30. P4D3 path: `Operations / Fleet_Governance / Subscription_Revenue_Pipeline`. Status as of 2026-06-02:
    - [X] **Phase A shipped** (2026-05-30, build `c8ce467`): P3 spec + P4_D2 templates + `/unlock/` sweep + P4_D1 scaffold. ORS PASS.
    - [X] **Phase B shipped** (2026-05-30, build `90083a3`): full P4_D1 Worker + `/upgrade/` template. ORS PASS.
    - [X] **Detailed Red-Team ORS** (2026-05-30, build `4973625`, Rigor: Detailed): 55-test vitest harness + JWT verification fix + walkthrough + L4 uploads. ORS PASS.
    - [X] **James close-out — deploy chain done** (2026-06-02, build `360b740`): Cloudflare Access app configured (Google SSO + Email OTP); `CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD` set in `wrangler.toml [vars]`; R2 consolidated to single `gemini-content-factory` bucket with prefix-based separation; `STRIPE_SECRET_KEY` Worker secret set; `wrangler deploy` executed. Production smoke confirms `/editions/*` + `/account/*` route through Access (302 to login). **Subscriber gate is LIVE.**
    - [ ] **Stage 2.6(b) browser live-fire matrix (open — needs James + Sales test data):** authenticate as (a) no-contact email → /upgrade, (b) no-sub contact → /upgrade, (c) individual active → content served, (d) enterprise OR-join different contact → content served, (e) Stripe-cancelled / R2-active → /upgrade (DiD catch), (f) wrong-stream → /upgrade, (g) before historical_access_from → /upgrade. Items (c)–(g) need at least one Sales-written subscription record + one Newsletter-published edition in R2. After live-fire matrix passes: flip `P3_D1` + `P4_D1` + `P4_D2` deliverable statuses to 🟢.
    - [ ] **Brand sign-off on gated route designs** (`task_83b15ed9` in P4D3) — blocked on Elevationary_Marketing populating `~/Antigravity/Elevationary_Marketing/brand/`. Not blocking the live gate; blocks the eventual visible-content redesign.

- [ ] **[COO/JAMES] Fleet Secret Consumer Registry — Worker-side STRIPE_SECRET_KEY row** — append a row to `~/Antigravity_Data/Administrator/docs/secret_consumer_registry.md` for the Worker-side `STRIPE_SECRET_KEY` consumer (restricted, `subscriptions:read` only). Names + smoke test only; never the value. James close-out step (f); not yet observed in registry.

### Optimization Backlog — Sales-owned (non-blocking)

- [ ] **[CODE — Sales-owned] Add `historical_access_from` + `deep_content_access` to `_index_row`** in `sales_subscription.py`. One-line addition + `rebuild-index` run = ~30 ms saved per entitled Worker request.
- [ ] **[CODE — Sales-owned] Ship `sales/index_contacts_by_email.json`** — replaces O(N) contacts list with O(1) email lookup. **Also closes the timing-oracle finding** from the Detailed Red-Team ORS.

### Phase B+ Follow-ups (Website-owned)

- [ ] **[CODE] Real `/editions/` archive listing** — Worker currently returns placeholder. Full version: list R2 `newsletter/drafts/` by date, filter by subscriber's `streams_accessible` + `historical_access_from`, render. Awaits Newsletter publishing a date-manifest convention.
- [ ] **[CODE] Constant-time gating** (Phase B+) — minimum wall-clock latency on gated responses to harden against timing-based email enumeration. Closeable by the Sales contacts-by-email index above; this is the backup plan.
- [ ] **[CODE] Real Stripe Checkout URLs** — replace 4 placeholders in `src/_data/site.json` (`stripeCheckoutIndividualUrl`, `stripeCheckoutBundleUrl`, `stripeCheckoutAllAccessUrl`, `stripeCustomerPortalUrl`) when Sales P2 ships Checkout session creation, or use Stripe Payment Links sooner.
- [ ] **[JAMES] Final `agent.elevationary.com` archival decision** — 52 references remain in `_site/`. If retire, second sweep pass needed.
- [ ] **[CODE] Confirm `task_f1d4e0a9` (Access service token) is moot or relevant** — the original P3 plan called for a service token "for Worker-to-Access programmatic check." Current Worker design uses JWT verification, not service token. Confirm whether the task should be marked N/A in P4D3 or whether it represents a future hardening item.

### Brand Foundation (blocking visible-content redesign only)
- [ ] **[BRAND] Read `~/Antigravity/Elevationary_Marketing/brand/` cover-to-cover** — directory empty as of 2026-06-02; blocker on Elevationary_Marketing.
- [ ] **[BRAND] Audit current site vs brand standard** — extends to all new routes shipped (`/subscribe/`, `/editions/`, `/account/`, `/upgrade/`) + Worker-rendered surfaces.
- [ ] **[BRAND] Brand-aligned design pass** — joint with Elevationary_Marketing.

### Production Checklist
- [X] ~~Custom domain on Cloudflare Pages~~ — `elevationary.com` confirmed routing through Cloudflare. Drop next cycle.
- [ ] **[JAMES] Deployment protection for Preview environments** — verify whether Cloudflare Pages preview environments need Cloudflare Access.

### Carry-over Warning
- **2026-06-11 (9 days)** — GoDaddy → Squarespace handover. If DNS/tunnel surfaces break on that date, suspect this handover first.

## Operational Rules
- [ ] **Operational Rule:** Do NOT populate this backlog with granular tasks. All granular work must be filed in the P4D3 system.
- [ ] **Operational Rule:** Execute ORS inline during implementation. Do NOT backfill retroactively.
- [ ] **Operational Rule:** Brand-first. No visible-content change ships without Elevationary_Marketing sign-off. *(Subscription_Revenue_Pipeline infrastructure exception accepted with documented compensating controls; do not generalize.)*
- [ ] **Operational Rule:** Stripe in Test Mode first, every time. *(Worker `subscriptions.retrieve` defense-in-depth uses LIVE restricted key in `subscriptions:read` scope; read-only verification, not a charge path.)*
- [ ] **Operational Rule (2026-05-30):** Any code path that gates on auth/identity/entitlement requires **executable tests**, not just static red-team. Fleet lesson `fleet_lesson_executable_security_tests_over_static_redteam` (L3, 7 chunks, recall verified).

## Icebox

- [ ] **[CODE] Lighthouse audit + optimization pass** — defer until brand pass complete.
- [ ] **[CODE] /llms.txt (`llms.njk`)** — review against brand messaging when brand lands.
- [ ] **[CODE] Eleventy version audit** — currently 3.1.5.
- [ ] **[CODE] Worker bundle size monitoring** — `marked` adds ~30 KB; `jose` is devDep only. 1 MB compressed limit.

## Completed (recent — full history at `~/Antigravity_Data/Website/docs/session_log.md`)

- [X] **2026-05-30 — Phase A Subscription_Revenue_Pipeline** shipped. Commits `65fe1a6` … `c8ce467`. ORS PASS.
- [X] **2026-05-30 — Phase B P4_D1 entitlement Worker + /upgrade/ template** shipped. Commits `bf4dd01` … `90083a3`. ORS PASS.
- [X] **2026-05-30 — Detailed Red-Team ORS for P4_D1**. Commit `4973625`. Rigor: Detailed. 55/55 tests. JWT verification fix. Walkthrough + L4 vault uploads. ORS PASS.
- [X] **2026-06-02 — James close-out deploy chain executed.** Commit `360b740`. Cloudflare Access live; JWT strict-mode active; Worker deployed; R2 consolidated. Subscriber gate live on production.

## Dropped

- ~~**[CODE] middleware.ts → proxy.ts rename**~~ — N/A for Eleventy; dropped 2026-05-30.
- ~~**[CODE] Cloudflare Pages build cache hygiene**~~ — `_site/` correctly gitignored; dropped 2026-05-30.
- ~~**[CODE] Design Stripe + Newsletter handoff** (old direct-channel item)~~ — superseded by Sales R2 CRM. Dropped 2026-05-30.
- ~~**[CODE] Stripe webhook endpoint on Website**~~ — moved to Sales agent. Dropped 2026-05-30.
- ~~**[CODE] Subscription state → Newsletter agent** (direct handoff)~~ — superseded. Dropped 2026-05-30.
- ~~**[CODE] Mailchimp deprecation plan**~~ — superseded by Phase B + Newsletter rewire. Dropped 2026-05-30.
