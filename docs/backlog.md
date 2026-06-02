# Website Backlog

> **Project Source of Truth:** Always verify the active project phases and deliverables within the P4D3 database before beginning a session.
> **Backlog tags:** `[CODE]` = Website code work | `[BRAND]` = needs Elevationary_Marketing approval | `[PROCESS]` = COO operational | `[JAMES]` = human action required. Website marks only its own items complete.

## Active

- [ ] **[COO] Subscription_Revenue_Pipeline — Website owns P3 + P4 + P9_D3** — CEO-ratified 2026-05-30 (P3 + P4) and 2026-06-01 (P9). P4D3 path: `Operations / Fleet_Governance / Subscription_Revenue_Pipeline`. Status as of 2026-06-02:
    - [X] **Phase A shipped** (2026-05-30, build `c8ce467`): P3 spec, P4_D2 templates, `/unlock/` sweep, P4_D1 scaffold. ORS PASS.
    - [X] **Phase B shipped** (2026-05-30, build `90083a3`): full P4_D1 Worker, `/upgrade/` template, wrangler.toml routes. ORS PASS.
    - [X] **Detailed Red-Team ORS** (2026-05-30, build `4973625`, Rigor: Detailed): 55-test vitest harness + JWT verification fix + walkthrough + L4 uploads. ORS PASS.
    - [X] **James close-out — deploy chain** (2026-06-02, build `360b740`): Cloudflare Access app live; JWT strict-mode vars set; R2 consolidated to `gemini-content-factory`; STRIPE_SECRET_KEY secret set; `wrangler deploy` executed. Subscriber gate live.
    - [X] **P9_D3 Worker swimlane schema v2 migration** (2026-06-02, build `1579ce5`, Rigor: Detailed): Worker source migrated across 10 v1→v2 surfaces (Tier 3-value, Swimlane 20-value, shared_contact_ids OR-join replacing enterprise/company_id, frontmatter swimlane-driven entitlement); vitest harness rewrite to v2 (56/56 pass) with explicit retired-enterprise regression assertion; `/upgrade/` `?swimlane=` URL param; wrangler deploy version `18746577-3dfd-4b4d-9803-717a9f62b71e`; live-fire fixture seeded; ORS PASS; walkthrough + L4 uploads complete.
    - [ ] **Stage 2.6(b) coordinated live-fire (`task_e5d72ed6` in P4D3) — happy path:** Sales creates `ct_test_p9d3` contact + test subscription via `sales_subscription.py create` (real Stripe test-mode IDs required for Worker DiD pass); James browser-auths via Email OTP at OTP-able test email; `GET /editions/2026-06-01/p9d3-live-fire` expecting HTTP 200 with `x-elevationary-entitlement: sb=*;tier=individual;swimlane=nonprofit_marketing_outreach`. Cleanup: Sales cancels sub + Website R2 MCP deletes fixture edition + Sales removes test contact. Telegram-paged James 2026-06-02 20:30 UTC. After this passes: flip `P3_D1`, `P4_D1`, `P4_D2`, `P9_D3` deliverable statuses to 🟢.
    - [ ] **Full Stage 2.6(b) matrix — NEXT deliverable per CEO directive:** 11 cells covering no-sub / individual / functional_bundle / all_access purchaser / all_access shared seat / cancelled / past_due / suppressed / Stripe-DiD catch / wrong-swimlane / before-historical. Opens after the happy-path live-fire above passes.

- [ ] **[COO/JAMES] Fleet Secret Consumer Registry — Worker-side STRIPE_SECRET_KEY row** — append a row to `~/Antigravity_Data/Administrator/docs/secret_consumer_registry.md` for the Worker-side `STRIPE_SECRET_KEY` consumer (restricted, `subscriptions:read` only). Names + smoke test only; never the value. Not yet observed in registry.

### Optimization Backlog — Sales-owned (non-blocking)

- [ ] **[CODE — Sales-owned] Add `historical_access_from` + `deep_content_access` to `_index_row`** in `sales_subscription.py`. ~30 ms saved per entitled Worker request. Sales' P9_D1 added `swimlanes_accessible` + `shared_contact_ids` to the projection but skipped these two — Worker still does one per-sub R2 GET to read them. Open since 2026-05-30.
- [ ] **[CODE — Sales-owned] Ship `sales/index_contacts_by_email.json`** — O(1) email lookup; **also closes the timing-oracle finding** from the Detailed RT ORS. Open since 2026-05-30.

### Phase B+ Follow-ups (Website-owned)

- [ ] **[CODE] Real `/editions/` archive listing** — Worker currently returns placeholder. Full version: list R2 `newsletter/drafts/` by date, filter by subscriber's `swimlanes_accessible` + `historical_access_from`, render. Awaits Newsletter date-manifest convention.
- [ ] **[CODE] Constant-time gating** (Phase B+) — minimum wall-clock latency on gated responses to harden against timing-based email enumeration. Closeable by Sales `index_contacts_by_email.json`.
- [ ] **[CODE] Real Stripe Checkout URLs** — replace 4 placeholders in `src/_data/site.json` (`stripeCheckoutIndividualUrl`, `stripeCheckoutBundleUrl`, `stripeCheckoutAllAccessUrl`, `stripeCustomerPortalUrl`) when Sales P2 ships Checkout session creation, or use Stripe Payment Links sooner.
- [ ] **[JAMES] Final `agent.elevationary.com` archival decision** — 52 references remain in `_site/`. If retire, second sweep pass needed.
- [ ] **[CODE] Confirm `task_f1d4e0a9` (P3 Access service token) is moot or relevant** — current Worker design uses JWT verification, not service token. Confirm whether to mark N/A in P4D3 or keep as future hardening item.
- [ ] **[CODE] Cleanup test fixture + test contact + test sub post-Stage 2.6(b) live-fire** — `newsletter/drafts/2026-06-01/p9d3-live-fire.md` (R2 MCP delete), `ct_test_p9d3` contact (Sales-side), test subscription (`sales_subscription.py cancel`). Commands in P9_D3 ORS Notes.

### Brand Foundation (blocking visible-content redesign only)
- [ ] **[BRAND] Read `~/Antigravity/Elevationary_Marketing/brand/` cover-to-cover** — directory empty as of 2026-06-02; blocker on Elevationary_Marketing.
- [ ] **[BRAND] Audit current site vs brand standard** — extends to all new routes (`/subscribe/`, `/editions/`, `/account/`, `/upgrade/`) + Worker-rendered surfaces (Worker `/account/` HTML, edition render).
- [ ] **[BRAND] Brand-aligned design pass** — joint with Elevationary_Marketing.

### Production Checklist
- [X] ~~Custom domain on Cloudflare Pages~~ — `elevationary.com` confirmed routing through Cloudflare. Dropped 2026-06-02.
- [ ] **[JAMES] Deployment protection for Preview environments** — verify whether Cloudflare Pages preview environments need Cloudflare Access.

### Carry-over Warning
- **2026-06-11 (9 days)** — GoDaddy → Squarespace handover. Suspect this first if DNS surfaces break that day.

## Operational Rules
- [ ] **Operational Rule:** Do NOT populate this backlog with granular tasks. All granular work must be filed in the P4D3 system.
- [ ] **Operational Rule:** Execute ORS inline during implementation. Do NOT backfill retroactively.
- [ ] **Operational Rule:** Brand-first. No visible-content change ships without Elevationary_Marketing sign-off. *(Subscription_Revenue_Pipeline infrastructure exception accepted with documented compensating controls; do not generalize.)*
- [ ] **Operational Rule:** Stripe in Test Mode first, every time. *(Worker `subscriptions.retrieve` defense-in-depth uses LIVE restricted key in `subscriptions:read` scope; read-only verification, not a charge path.)*
- [ ] **Operational Rule (2026-05-30):** Any code path that gates on auth/identity/entitlement requires **executable tests**, not just static red-team. Fleet lesson `fleet_lesson_executable_security_tests_over_static_redteam` (L3).
- [ ] **Operational Rule (2026-06-02):** When a cross-agent upstream schema migration ships, run the consumer-side executable test matrix against the new shape BEFORE shipping. The type system + first failing test name the exact field that drifted. (P9_D3 was 56/56 green on first matrix run because tsc errors during edit forced every drift to be fixed before tests fired.)

## Icebox

- [ ] **[CODE] Lighthouse audit + optimization pass** — defer until brand pass complete.
- [ ] **[CODE] /llms.txt (`llms.njk`)** — review against brand messaging when brand lands.
- [ ] **[CODE] Eleventy version audit** — currently 3.1.5.
- [ ] **[CODE] Worker bundle size monitoring** — `marked` adds ~30 KB; `jose` is devDep only. Bundle now 102.72 KiB / 24.07 KiB gzip post-P9_D3; 1 MB compressed limit.
- [ ] **[CODE] Drop `company_id` from Worker `Contact` + `SubscriptionIndexRow` interfaces** — field is now metadata-only per v2 schema. Worker reads it for nothing. Future cleanup if/when Sales drops it from the schema entirely.

## Completed (recent — full history at `~/Antigravity_Data/Website/docs/session_log.md`)

- [X] **2026-05-30 — Phase A Subscription_Revenue_Pipeline** shipped. Commits `65fe1a6` … `c8ce467`. ORS PASS.
- [X] **2026-05-30 — Phase B P4_D1 entitlement Worker + /upgrade/ template** shipped. Commits `bf4dd01` … `90083a3`. ORS PASS.
- [X] **2026-05-30 — Detailed Red-Team ORS for P4_D1**. Commit `4973625`. Rigor: Detailed. 55/55 tests. JWT verification fix. Walkthrough + L4 vault uploads. ORS PASS.
- [X] **2026-06-02 — James close-out deploy chain executed.** Commit `360b740`. Cloudflare Access live; JWT strict-mode active; Worker deployed; R2 consolidated. Subscriber gate live.
- [X] **2026-06-02 — Refresh handover + backlog + P4D3 to live state.** Commit `6e98842`. 4 P4D3 task statuses flipped.
- [X] **2026-06-02 — P9_D3 Worker swimlane schema v2 migration.** Commit `1579ce5`. Rigor: Detailed. 56/56 tests. Worker deployed (version `18746577-3dfd-4b4d-9803-717a9f62b71e`). Walkthrough + L4 vault uploads. ORS PASS on agent-shippable scope.

## Dropped

- ~~**[CODE] middleware.ts → proxy.ts rename**~~ — N/A for Eleventy; dropped 2026-05-30.
- ~~**[CODE] Cloudflare Pages build cache hygiene**~~ — `_site/` correctly gitignored; dropped 2026-05-30.
- ~~**[CODE] Design Stripe + Newsletter handoff** (old direct-channel item)~~ — superseded by Sales R2 CRM. Dropped 2026-05-30.
- ~~**[CODE] Stripe webhook endpoint on Website**~~ — moved to Sales agent. Dropped 2026-05-30.
- ~~**[CODE] Subscription state → Newsletter agent** (direct handoff)~~ — superseded. Dropped 2026-05-30.
- ~~**[CODE] Mailchimp deprecation plan**~~ — superseded by Phase B + Newsletter rewire. Dropped 2026-05-30.
