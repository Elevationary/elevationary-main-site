# Website Backlog

> **Project Source of Truth:** Always verify the active project phases and deliverables within the P4D3 database before beginning a session.
> **Backlog tags:** `[CODE]` = Website code work | `[BRAND]` = needs Elevationary_Marketing approval | `[PROCESS]` = COO operational | `[JAMES]` = human action required. Website marks only its own items complete.

## Active

- [ ] **[COO] Subscription_Revenue_Pipeline — Website owns P3 + P4** — CEO-ratified 2026-05-30. P4D3 path: `Operations / Fleet_Governance / Subscription_Revenue_Pipeline` (phases `P3_Cloudflare_Access_Setup` + `P4_Entitlement_Worker_and_Gated_Routes`). Status as of 2026-05-30:
    - [X] **Phase A shipped** (2026-05-30, build `c8ce467`): P3 spec (`cloudflare/access/`), P4_D2 gated route templates + `/unlock/` sweep, P4_D1 deny-by-default Worker scaffold, P4D3 ownership reassigned. ORS PASS log: `~/Antigravity_Data/Website/docs/ORS_logs/ORS_subscriptions_phase_a_2026_05_30.md`.
    - [X] **Phase B shipped** (2026-05-30, build `90083a3`): full P4_D1 entitlement Worker (R2 + Stripe defense-in-depth + OR-join + serve/redirect), `/upgrade/` Eleventy template, `wrangler.toml` routes uncommented + R2 bindings + observability. ORS PASS log: `~/Antigravity_Data/Website/docs/ORS_logs/ORS_p4_d1_entitlement_worker_2026_05_30.md`.
    - [ ] **James close-out (single workflow):** (a) Configure Cloudflare Access "Subscriber Content" app per `cloudflare/access/subscriber_content_app.md` checklist. (b) Verify R2 buckets `elevationary-sales` + `elevationary-newsletter` exist (edit `wrangler.toml` if named differently). (c) `wrangler secret put STRIPE_SECRET_KEY` with a restricted key (`subscriptions:read` only). (d) `wrangler deploy`. (e) Append Worker-side `STRIPE_SECRET_KEY` row to Fleet Secret Consumer Registry. (f) Browser live-fire: `/editions/<date>/<topic>` → Access prompt → OTP → `/upgrade` 302 (no subs yet); `/account/` → `/upgrade` 302 (no subs yet); after Sales writes a test sub, repeat and confirm content serves; cancel test sub in Stripe → next request hits `/upgrade` (defense-in-depth validation); enterprise OR-join validation.

- [ ] **[COO] Extend the Fleet Secret Consumer Registry** — Canonical doc: `~/Antigravity_Data/Administrator/docs/secret_consumer_registry.md`. Website-owned rows to fill: **(a) Stripe checkout + webhook on elevationary.com** (`STRIPE_*` keys — which keys does the live site read?) + smoke test; **(b) Cloudflare DNS / API** (`CLOUDFLARE_API_TOKEN`, `CF_TOKEN_DNS`) if Website directly reads; **(c) DATABASE_URL** if Website uses D1 — disambiguate with El_OS; **(d) VERCEL_TOKEN** — whether Website deploys via the token or CLI-cached auth. Phase B adds **(e) Worker-side `STRIPE_SECRET_KEY`** (restricted, `subscriptions:read` only) — James appends as part of close-out hand-action above. Names + smoke tests only, never values.

### Optimization Backlog (filed against Sales — non-blocking for first live use)

- [ ] **[CODE — Sales-owned] Add `historical_access_from` to `_index_row`** in `~/Antigravity/Elevationary_Sales/scripts/sales_subscription.py`. Currently the index row projects `{sb_id, contact_id, company_id, stream, tier, status, current_period_end, streams_accessible, stripe_subscription_id}` — entitlement Worker takes one extra `GET sales/subscriptions/<sb_id>.json` per request just for that field. One-line change to `_index_row` + Sales `rebuild-index` run = ~30ms saved per entitled Worker request.
- [ ] **[CODE — Sales-owned] Ship `sales/index_contacts_by_email.json`** — flat JSON `{email: ct_id}` map maintained on every contact write. Worker currently does R2 `list({prefix: "sales/contacts/"})` + per-contact GET to resolve email → contact (O(N)). Index lookup = O(1). Important as subscriber count grows past ~100.

### Phase A / B Follow-ups Filed (Website-owned)

- [ ] **[CODE] Real Stripe Checkout URLs** — replace 4 placeholders in `src/_data/site.json` (`stripeCheckoutIndividualUrl`, `stripeCheckoutBundleUrl`, `stripeCheckoutAllAccessUrl`, `stripeCustomerPortalUrl`). Lands when Sales P2 (Stripe webhook + Checkout session creation) ships, OR use Stripe Payment Links as an intermediate.
- [ ] **[JAMES] Final agent.elevationary.com archival decision** — 52 references remain in `_site/`: consulting redirects in `_redirects` (5 rules), nav "Agent Catalog →" + footer link in `base.njk`, consulting CTAs in `services.njk`, consulting URLs in `llms.txt`/`ai-plugin.json`. If retired, second sweep pass needed; if it stays as the consulting subdomain, leave alone.
- [ ] **[CODE] `/editions/` archive — real implementation** — Worker currently returns a placeholder. Full version lists entitled dates from `newsletter/drafts/` + filters by subscriber's `streams_accessible` + `historical_access_from`. Awaits Newsletter publishing a date-manifest convention.

### Brand Foundation (still blocking visible-content redesign)
- [ ] **[BRAND] Read `~/Antigravity/Elevationary_Marketing/brand/` cover-to-cover** — directory empty as of 2026-05-30; blocker on Elevationary_Marketing.
- [ ] **[BRAND] Audit current site vs brand standard** — extends to the 4 new routes shipped 2026-05-30 (`/subscribe/`, `/editions/`, `/account/`, `/upgrade/`) plus the Worker-rendered `/account/` and `/editions/*` surfaces. All currently use `base.njk` chrome + minimal Worker HTML; await brand pass.
- [ ] **[BRAND] Brand-aligned design pass** — typography, imagery, layout, color, motion. Joint with Elevationary_Marketing.

### Production Checklist
- [ ] **[JAMES]/[CODE] Custom domain on Cloudflare Pages** — confirm `elevationary.com` is configured as Pages custom domain.
- [ ] **[JAMES] Deployment protection for Preview environments** — verify whether Cloudflare Pages preview environments need Cloudflare Access.

## Operational Rules
- [ ] **Operational Rule:** Do NOT populate this backlog with granular tasks. All granular work must be filed in the P4D3 system.
- [ ] **Operational Rule:** Execute ORS inline during implementation. Do NOT backfill retroactively.
- [ ] **Operational Rule:** Brand-first. No visible-content change ships without Elevationary_Marketing sign-off. *(Subscription_Revenue_Pipeline infrastructure exception accepted with documented compensating controls; do not generalize.)*
- [ ] **Operational Rule:** Stripe in Test Mode first, every time. Production code requires a Test Mode green pass. *(Worker `subscriptions.retrieve` defense-in-depth uses LIVE restricted key in read-only `subscriptions:read` scope per ratified plan; this is read-only verification, not a charge path.)*

## Icebox

- [ ] **[CODE] Lighthouse audit + optimization pass** — defer until brand pass complete; otherwise re-work.
- [ ] **[CODE] /llms.txt (`llms.njk`)** — review current content; ensure LLM crawler hints align with brand messaging.
- [ ] **[CODE] Eleventy version audit** — currently 3.1.5; track upstream changes.
- [ ] **[CODE] Worker bundle size monitoring** — `marked` adds ~30KB. Watch as Phase B+ features land (e.g. real archive listing, richer HTML rendering). 1MB compressed limit.

## Completed (this session — full history at `~/Antigravity_Data/Website/docs/session_log.md`)

- [X] **Phase A — Subscription_Revenue_Pipeline** shipped 2026-05-30. Commits `65fe1a6` (P3 spec), `c486fec` (P4_D2 + sweep), `32382de` (P4_D1 scaffold), `c8ce467` (backlog dispatch surface). Production verified.
- [X] **Phase B — Subscription_Revenue_Pipeline P4_D1 entitlement Worker + /upgrade/ template** shipped 2026-05-30. Commits `bf4dd01` (docs interim), `90083a3` (Worker + /upgrade/). Typecheck clean, audit clean, build clean, production smoke green. Deploy is James close-out.

## Dropped

- ~~**[CODE] middleware.ts → proxy.ts rename**~~ — N/A for Eleventy; dropped 2026-05-30.
- ~~**[CODE] Cloudflare Pages build cache hygiene**~~ — `_site/` correctly gitignored; dropped 2026-05-30.
- ~~**[CODE] Design Stripe + Newsletter handoff** (old direct-channel item)~~ — superseded by ratified Sales R2 CRM design. Dropped 2026-05-30.
- ~~**[CODE] Stripe webhook endpoint on Website**~~ — moved to Sales agent per ratified plan §2. Sales owns the receiver at `webhooks.elevationary.com/stripe`.
- ~~**[CODE] Subscription state → Newsletter agent** (direct handoff)~~ — superseded. Newsletter reads Sales R2 CRM at send time.
- ~~**[CODE] Mailchimp deprecation plan**~~ — supersedes-by: deprecation lands as a side-effect of P4 + Newsletter rewire to Sales R2 CRM.
