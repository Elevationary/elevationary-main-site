# Website Backlog

> **Project Source of Truth:** Always verify the active project phases and deliverables within the P4D3 database before beginning a session.
> **Backlog tags:** `[CODE]` = Website code work | `[BRAND]` = needs Elevationary_Marketing approval | `[PROCESS]` = COO operational | `[JAMES]` = human action required. Website marks only its own items complete.

## Active

- [ ] **[COO] Subscription_Revenue_Pipeline — Website owns P3 + P4** — CEO-ratified 2026-05-30. P4D3 path: `Operations / Fleet_Governance / Subscription_Revenue_Pipeline`. Status as of 2026-05-30:
    - [X] **Phase A shipped** (build `c8ce467`): P3 spec, P4_D2 gated route templates + `/unlock/` sweep, P4_D1 deny-by-default Worker scaffold, P4D3 ownership reassigned. ORS PASS.
    - [X] **Phase B shipped** (build `90083a3`): full P4_D1 entitlement Worker (R2 + Stripe DiD + OR-join + serve/redirect), `/upgrade/` Eleventy template, wrangler.toml routes uncommented + R2 bindings + observability. ORS PASS.
    - [X] **Detailed Red-Team ORS shipped** (build `4973625`, Rigor: Detailed): 55-test vitest harness against live Worker logic; surfaced + FIXED FINDING 1 (Cf-Access-Jwt-Assertion verification missing — implemented end-to-end with JWKS caching, RS256-only, email mismatch defense); 2 lower-severity findings documented; walkthrough + L4 vault uploads complete. ORS PASS.
    - [ ] **James close-out (single workflow):** (a) Configure Cloudflare Access "Subscriber Content" app per `cloudflare/access/subscriber_content_app.md`. (b) Verify R2 buckets `elevationary-sales` + `elevationary-newsletter` exist; edit `wrangler.toml` bindings if needed. (c) Set strict-mode JWT vars: `CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD` in `wrangler.toml [vars]`. (d) `wrangler secret put STRIPE_SECRET_KEY` (restricted: `subscriptions:read`). (e) `wrangler deploy`. (f) Append `STRIPE_SECRET_KEY` Worker-side row to Fleet Secret Consumer Registry. (g) Browser live-fire matrix (no-sub / individual / enterprise OR-join / cancelled / stripe-canceled-r2-active DiD catch). After this: flip `P3_D1`, `P4_D1`, `P4_D2` deliverable statuses to 🟢.

- [ ] **[COO] Extend the Fleet Secret Consumer Registry** — Canonical doc: `~/Antigravity_Data/Administrator/docs/secret_consumer_registry.md`. Website-owned rows: (a) Stripe checkout + webhook on elevationary.com; (b) Cloudflare DNS / API; (c) DATABASE_URL if Website uses D1; (d) VERCEL_TOKEN. Phase B adds (e) **Worker-side `STRIPE_SECRET_KEY`** (restricted, `subscriptions:read` only) — James appends as part of deploy close-out. Names + smoke tests only, never values.

### Optimization Backlog — Sales-owned (non-blocking)

- [ ] **[CODE — Sales-owned] Add `historical_access_from` + `deep_content_access` to `_index_row`** in `sales_subscription.py`. One-line addition + `rebuild-index` run = ~30ms saved per entitled Worker request. Eliminates one R2 GET per candidate.
- [ ] **[CODE — Sales-owned] Ship `sales/index_contacts_by_email.json`** — replaces O(N) contacts list with O(1) email lookup. Important as subscriber count grows. **Also closes the timing-oracle finding** from the Detailed Red-Team ORS (both lookup paths become equivalent O(1)).

### Phase A / B / Detailed Follow-ups (Website-owned)

- [ ] **[CODE] Real `/editions/` archive listing** — Worker currently returns placeholder. Full version: list R2 `newsletter/drafts/`, filter by subscriber's `streams_accessible` + `historical_access_from`, render. Awaits Newsletter publishing a date-manifest convention.
- [ ] **[CODE] Constant-time gating** (Phase B+) — minimum wall-clock latency on all gated responses to harden against timing-based email enumeration. Only needed if Sales `index_contacts_by_email.json` optimization doesn't ship in same horizon as subscriber-count growth.
- [ ] **[CODE] Real Stripe Checkout URLs** — replace 4 placeholders in `src/_data/site.json` when Sales P2 ships Checkout session creation (or use Stripe Payment Links sooner).
- [ ] **[JAMES] Final agent.elevationary.com archival decision** — 52 references remain in `_site/` (consulting redirects, footer/nav, services CTAs, llms.txt/ai-plugin.json). Decide stay vs retire; if retire, second sweep pass needed.

### Brand Foundation (still blocking visible-content redesign)
- [ ] **[BRAND] Read `~/Antigravity/Elevationary_Marketing/brand/` cover-to-cover** — directory empty as of 2026-05-30; blocker on Elevationary_Marketing.
- [ ] **[BRAND] Audit current site vs brand standard** — extends to the 4 new Eleventy routes (`/subscribe/`, `/editions/`, `/account/`, `/upgrade/`) + the Worker-rendered surfaces (`/editions/<date>/<topic>`, `/account/`, `/editions/` archive). All use `base.njk` chrome or minimal Worker HTML; await brand pass.
- [ ] **[BRAND] Brand-aligned design pass** — joint with Elevationary_Marketing.

### Production Checklist
- [ ] **[JAMES]/[CODE] Custom domain on Cloudflare Pages** — confirm `elevationary.com` is configured as Pages custom domain.
- [ ] **[JAMES] Deployment protection for Preview environments** — verify whether Cloudflare Pages preview environments need Cloudflare Access.

## Operational Rules
- [ ] **Operational Rule:** Do NOT populate this backlog with granular tasks. All granular work must be filed in the P4D3 system.
- [ ] **Operational Rule:** Execute ORS inline during implementation. Do NOT backfill retroactively.
- [ ] **Operational Rule:** Brand-first. No visible-content change ships without Elevationary_Marketing sign-off. *(Subscription_Revenue_Pipeline infrastructure exception accepted with documented compensating controls; do not generalize.)*
- [ ] **Operational Rule:** Stripe in Test Mode first, every time. *(Worker `subscriptions.retrieve` defense-in-depth uses LIVE restricted key in read-only `subscriptions:read` scope; read-only verification, not a charge path.)*
- [ ] **Operational Rule (NEW 2026-05-30):** Any code path that gates on auth/identity/entitlement requires **executable tests**, not just static red-team. Static review catches what the code does — it misses what the code is NOT doing. The Phase B JWT-verification gap was invisible to static review and surfaced on the first executable matrix run.

## Icebox

- [ ] **[CODE] Lighthouse audit + optimization pass** — defer until brand pass complete.
- [ ] **[CODE] /llms.txt (`llms.njk`)** — review against brand messaging.
- [ ] **[CODE] Eleventy version audit** — currently 3.1.5.
- [ ] **[CODE] Worker bundle size monitoring** — `marked` adds ~30 KB; `jose` is devDep only (test-time JWT fixtures). 1 MB compressed limit.

## Completed (this session — full history at `~/Antigravity_Data/Website/docs/session_log.md`)

- [X] **Phase A — Subscription_Revenue_Pipeline** shipped 2026-05-30. Commits `65fe1a6`, `c486fec`, `32382de`, `c8ce467`. ORS PASS.
- [X] **Phase B — Subscription_Revenue_Pipeline P4_D1 entitlement Worker + /upgrade/ template** shipped 2026-05-30. Commits `bf4dd01`, `90083a3`. ORS PASS.
- [X] **Detailed Red-Team ORS for P4_D1** shipped 2026-05-30. Commit `4973625`. Rigor: Detailed. 55/55 tests pass. JWT verification gap fixed. Walkthrough + L4 vault uploads complete. ORS PASS.

## Dropped

- ~~**[CODE] middleware.ts → proxy.ts rename**~~ — N/A for Eleventy; dropped 2026-05-30.
- ~~**[CODE] Cloudflare Pages build cache hygiene**~~ — `_site/` correctly gitignored; dropped 2026-05-30.
- ~~**[CODE] Design Stripe + Newsletter handoff** (old direct-channel item)~~ — superseded by ratified Sales R2 CRM design. Dropped 2026-05-30.
- ~~**[CODE] Stripe webhook endpoint on Website**~~ — moved to Sales agent per ratified plan §2.
- ~~**[CODE] Subscription state → Newsletter agent** (direct handoff)~~ — superseded; Newsletter reads Sales R2 CRM at send time.
- ~~**[CODE] Mailchimp deprecation plan**~~ — superseded; deprecation lands as side-effect of Phase B + Newsletter rewire.
