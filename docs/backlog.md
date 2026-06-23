# Website Backlog

> **Project Source of Truth:** Always verify the active project phases and deliverables within the P4D3 database before beginning a session.
> **Backlog tags:** `[CODE]` = Website code work | `[BRAND]` = needs Elevationary_Marketing approval | `[PROCESS]` = COO operational | `[JAMES]` = human action required | `[WEB]` = current BVP / Day 3 Website work. Website marks only its own items complete.

> **⚡ 2026-06-22 BVP DAY 3 EOD STATE:** Fleet-wide Claude restart triggered by CEO for clean PTY clear. Welcome-flow Day-2-shippable surface = PASS in preview. Marketing dispatch queue cleared (#1/#3/#4 verdicted PASS; #2 D1.7 partial impl awaiting tier-enum mapping reply). LIVE activation gated on `task_b0d86b20`.

## Restart Priority Order (post-restart)

1. Onboarding Scan + read `docs/build_handover.md` end-to-end.
2. Check inbox for Marketing's pending verdicts:
   - D1.7 tier-enum mapping (3 options A/B/C dispatched, msg `cef45339-...`)
   - knowsAbout replacement mapping (incoming on `d_ceo_4_knowsabout_followup_2026_06_22`)
3. If Marketing tier-mapping reply present → wire per-tier copy, regenerate welcome PNG, reply with verdict-ready surface.
4. If knowsAbout mapping present → apply find-and-replace in `organization.njk`, rebuild, verify; PNG re-render skippable (JSON-LD-only change).
5. Standing-by for COO Day 3 active-drive signal (production deploy gated on `task_b0d86b20`).

## Active

- [ ] **[CODE / WEB] LIVE activation sequence (`task_b0d86b20` in P4D3)** — paint-by-numbers per `~/Antigravity_Data/Website/docs/plans/welcome_flow_day3_runbook_2026_06_22.md`. STRIPE_READ_KEY + CF Access service token already pushed to both envs; production Worker `subscribe-checkout` exists as empty shell. Needs: LIVE Founding Coupon + ELEVATE50 promo creation, deactivate 100 stale PREVIEW codes, LIVE write-scope restricted API key, configure_worker_secrets.py --env production, uncomment production routes block, add production `[[services]]` mirror of ENTITLEMENT_WORKER, `wrangler deploy`, e2e smoke against real cs_live_ session, append Secret Consumer Registry rows × 3, flip `task_1c9bc273` 🟢 + `task_b0d86b20` 🟢, detailed-rigor ORS.

- [ ] **[WEB / BRAND] D1.7 welcome page per-tier copy implementation** — code prep + tier-agnostic items shipped 2026-06-22 (Q-WP1, Q-WP2, Q-WP3 default-no-Clay, Q-WP5.a, Q-WP6, Q-WP-MO, Q-WP-FT). Blocked on Marketing tier-mapping decision: Stripe enum `{individual, functional_bundle, all_access}` vs spec enum `{Free, Newsletter, All-Access}`. Three options dispatched (A: drop Free, map individual+functional_bundle→Newsletter; B: 1:1 Stripe rows; C: 4-row matrix). After reply: ~15 min for Worker logic + Q-WP4.a copy + Q-WP5.b/c failure branches + Q-WP3 tier-badge for All-Access + welcome PNG regen + Marketing brand-gate review request.

- [ ] **[WEB / BRAND] knowsAbout array replacement** — Marketing reviewing 7 entries row-by-row. Replacements arrive on corr `d_ceo_4_knowsabout_followup_2026_06_22`. Apply find-and-replace in `src/_includes/structured-data/organization.njk`, rebuild, grep-verify in `_site/`. PNG re-render likely skippable (JSON-LD-only).

- [ ] **[WEB / BRAND] D-CEO-4 P2 AEO/GEO authoring** — clean slate confirmed (zero AEO/GEO content in workspace). Marketing drafts scope from scratch; when scope lands, Website authors `src/_includes/structured-data/faq.njk` (or `qa.njk`) with FAQPage type, includes from `/aeo/` + `/geo/` surfaces.

- [ ] **[COO] Subscription_Revenue_Pipeline — Website owns P3 + P4 + P9_D3** — CEO-ratified 2026-05-30 (P3 + P4) and 2026-06-01 (P9). P4D3 path: `Operations / Fleet_Governance / Subscription_Revenue_Pipeline`. Status as of 2026-06-22:
    - [X] All P3 + P4_D1 + P4_D2 + P9_D3 tasks 🟢 from prior sessions (see git history).
    - [X] `task_aeec81fc` 🟢 2026-06-21 — CEO Stripe live-fire validation PASSED.
    - [X] `task_1c9bc273` 🟡 2026-06-22 — ENTITLEMENT_WORKER service binding wired in preview; staying 🟡 until production deploy + e2e smoke 200/200 with real cs_live_ session.
    - [ ] `task_b0d86b20` 🟡 — LIVE activation (sequence above).
    - [ ] `task_d02e87e8` 🟢 (shipped Day 2; Eleventy `/subscribe/` lane-picker + welcome page).

- [ ] **[COO/JAMES] Fleet Secret Consumer Registry rows** — append rows to `~/Antigravity_Data/Administrator/docs/secret_consumer_registry.md` at LIVE activation for: (a) Worker-side `STRIPE_SECRET_KEY` (subscriber-content, scope `subscriptions:read`); (b) subscribe-checkout production `STRIPE_SECRET_KEY` (scope `write:checkout.sessions`); (c) subscribe-checkout `STRIPE_READ_KEY` (scope `checkout.sessions:read` + `subscriptions:read`, pushed both envs 2026-06-22); (d) subscribe-checkout `CF_ACCESS_CLIENT_ID` + `CF_ACCESS_CLIENT_SECRET` pair (service token `subscribe_checkout_to_subscriber_content`, pushed both envs 2026-06-22). Names + smoke test only; never values.

- [X] **2026-06-22 — [WEB / CODE] Welcome-flow Day-2-shippable surface PASS** — Stripe scope widening + dual-env secret push, ENTITLEMENT_WORKER service binding live preview (Worker `508cd6b3-...`), CF Access service token Option II wired both envs, subscriber-content `/api/entitlement` endpoint shipped (86/86 vitest), welcome handler progressive-enhancement via `liveFlowReady()`, preview smoke controlled-PASS (rk_live_ + cs_test_ separation), runbook at `~/Antigravity_Data/Website/docs/plans/welcome_flow_day3_runbook_2026_06_22.md`.

- [X] **2026-06-22 — [WEB / BRAND] Marketing remediation cycle PASS** — D-CEO-1 fleet→team scrub (5 hits) + D-CEO-4 P1 JSON-LD description swap (byte-verified by Marketing) + AEO/GEO clean-slate confirmation + D1.7 welcome-page partial implementation (tier-agnostic items). 16 v2 PNGs at `~/Antigravity_Data/Website/visual_references/bvp_d_ceo_1_2026_06_22_v2/`.

- [X] **2026-06-22 — [WEB / CODE] D1.4 brand-gate self-review submitted + Marketing PASS** — 35/37 rows self-PASS, 5 inline remediations (C6 contrast / T1 Roboto load / T5 letter-spacing / S3 tap targets / I1 Lucide SVG), Marketing GREEN on D1.1 visual fidelity + D-CEO-1 + D-CEO-4 P1.

- [X] **2026-06-21 — [WEB / BRAND] BVP Triad Day 2 sprint shipped** — 4 contemporary surfaces (/, /subscribe/, /subscribe/welcome/, /editions/), D1.5 R2 schema joint-locked with Newsletter, D2.1 hook contract locked with Marketing, D2.4 Website-half welcome handler pre-stage, Stripe CTA hook pre-stage (feature-flagged JS).

- [X] **2026-06-09 — [CODE] Stripe Checkout Worker SKELETON shipped** — per prior backlog.

- [X] **2026-06-17 — [PROCESS] Team Elevation Self-Audit COMPLETE** — per prior backlog.

- [X] **2026-06-16 — [CODE] Stripe Checkout Test Mode catalog provisioned + preview Worker DEPLOYED** — per prior backlog.

- [ ] **[COO disposition needed] 3 Team Elevation drift findings** — (F1) Cross-owner status-flip doctrine; (F2) CLAUDE_CODE.md amendment propagation; (F3) Fleet-wide Probation horizon convention. Other 4 findings carry forward.

### Optimization Backlog — Sales-owned (non-blocking)

- [ ] **[CODE — Sales-owned]** `historical_access_from` + `deep_content_access` projection into `_index_row`.
- [ ] **[CODE — Sales-owned]** `sales/index_contacts_by_email.json` for O(1) email lookup (closes timing-oracle finding).
- [ ] **[CODE — Sales-owned]** Sales contact-by-email uniqueness invariant (write-time conflict detection).

### Phase B+ Follow-ups (Website-owned)

- [ ] **[CODE] Real `/editions/` archive listing** — Worker currently signed-out fallback. Full version: list R2 `newsletter/drafts/` by date per D1.5 schema, filter by subscriber's swimlanes + historical_access_from, render `issue_card.archive` grid. Awaits Newsletter Q3 #1 publish + D1.5 schema instances in R2.
- [ ] **[CODE] Constant-time gating** — minimum wall-clock latency on gated responses to harden against timing-based email enumeration. Closeable by Sales `index_contacts_by_email.json`.
- [ ] **[CODE] Real Stripe Checkout URLs** — replace 4 placeholders in `src/_data/site.json` once tier CTAs use the live `/api/checkout` POST path (JS hook is in `assets/bvp-checkout.js`, feature-flagged off; flip to true at LIVE activation).
- [ ] **[CODE] Replace `/subscribe/welcome/` portalUrl placeholder with real Stripe Billing Portal session URL** — currently the subscriber-content `/api/entitlement` returns `https://elevationary.com/account/` for `portalUrl`. Real Billing Portal session creation needs `billing_portal:write` scope on a Stripe key (not yet provisioned) OR move the session creation to subscribe-checkout Worker which has Stripe write scope.
- [ ] **[CODE] subscriber-content production deploy** — code uploaded 2026-06-22 (route-claim auth error non-blocking; v2.2 routes still serve). Validate `/api/entitlement` endpoint via service-binding smoke once production subscribe-checkout deploys.
- [ ] **[JAMES] Final `agent.elevationary.com` archival decision** — 52 references remain in `_site/`. If retire, second sweep pass needed.
- [ ] **[CODE] Confirm `task_f1d4e0a9` (P3 Access service token)** — RESOLVED by Option II ratification 2026-06-22; service token `subscribe_checkout_to_subscriber_content` is the canonical solution. Close `task_f1d4e0a9` in P4D3 at LIVE activation.
- [ ] **[CODE] Cleanup test fixture + test contact + test sub post-Stage 2.6(b) live-fire** — `newsletter/drafts/2026-06-01/p9d3-live-fire.md` (R2 MCP delete), `ct_test_p9d3` contact (Sales-side), test subscription (`sales_subscription.py cancel`).
- [ ] **[WEB] Welcome handler Q-WP5.b/c failure-mode Worker logic** — currently the welcome handler maps every Stripe-or-Entitlement failure to a single failure UX (Q-WP5.a copy). Q-WP5.b (Stripe unreachable) + Q-WP5.c (mismatched account) require Worker error-code disambiguation + per-case copy selection at render time. Gated on Marketing tier-mapping reply (combines with that build pass).
- [ ] **[WEB] Tier-badge render for All-Access path on welcome page (Q-WP3)** — Clay reservation requires Worker to set `data-tier` on `entitlement-shell` root when tier is All-Access; CSS already exists. Gated on Marketing tier-mapping reply.

### Brand Foundation (BVP work continues this thread)

- [X] **2026-06-21 — [BRAND] Read brand/ cover-to-cover** — d_ceo_1, d_ceo_2, d_ceo_4 dispatches all consumed; spec authority confirmed.
- [X] **2026-06-21 — [BRAND] Audit current site vs brand standard** — D1.4 self-review submitted; Marketing PASS on visual fidelity.
- [X] **2026-06-21 — [BRAND] Brand-aligned design pass v1** — 4 BVP surfaces shipped + brand-token CSS at `:root` of `assets/bvp.css`.

### Production Checklist

- [X] ~~Custom domain on Cloudflare Pages~~ — confirmed; dropped 2026-06-02.
- [ ] **[JAMES] Deployment protection for Preview environments** — Cloudflare Pages preview environments — confirm whether CF Access policy needed.

### Carry-over Warning
- (none active)

## Operational Rules

(Carried forward from prior backlog. New 2026-06-22 rules captured in `build_handover.md` "Do Not Re-Try" section.)

- [ ] Do NOT populate this backlog with granular tasks — file in P4D3.
- [ ] Execute ORS inline during implementation. No retroactive backfill.
- [ ] Brand-first. No visible-content change ships without Elevationary_Marketing sign-off. (Subscription_Revenue_Pipeline infrastructure exception accepted with documented compensating controls.)
- [ ] Stripe Test Mode first, every time.
- [ ] Auth/identity/entitlement gates → executable tests, not just static red-team. (`fleet_lesson_executable_security_tests_over_static_redteam`)
- [ ] Cross-agent upstream schema migration → consumer-side executable test matrix BEFORE shipping.
- [ ] Runtime JSON shapes vs TypeScript types → validate at use-site with `Array.isArray` / `typeof === 'string'`.
- [ ] Markdown renderer defaults → override `renderer.html` to escape OR DOMPurify wrap. (`marked@^12` raw-HTML default)
- [ ] ORS Stage 3 demands real induction, not characterological reasoning.
- [ ] Strict JWT verifiers → check both `exp` AND `nbf` when present. (`fleet_lesson_jwt_strict_must_check_nbf`)
- [ ] "This catches X" security check → ship with positive AND negative fixture verifier-of-verifier. (`fleet_lesson_verify_the_verifier`)
- [ ] **NEW 2026-06-22:** STRIPE_READ_KEY needs BOTH `checkout.sessions:read` AND `subscriptions:read` scopes for the welcome flow chain.
- [ ] **NEW 2026-06-22:** Service-binding fetches bypass CF Access edge; auth via `CF-Access-Client-*` headers checked by destination Worker.
- [ ] **NEW 2026-06-22:** Wrangler auto-creates Workers on first `secret put` (no error if name doesn't exist). Empty shell with secret only — don't confuse for deployed Worker.

## Icebox

- [ ] Lighthouse audit + optimization pass (defer until brand pass complete).
- [ ] `/llms.txt` review against brand messaging.
- [ ] Eleventy version audit (3.1.5 currently).
- [ ] Worker bundle size monitoring.
- [ ] Drop `company_id` from Worker types (metadata-only post-v2).
- [ ] Replace `window.prompt()` email collection in `assets/bvp-checkout.js` with Marketing-blessed inline form once D1.2 promotes a form component.

## Completed (last 8 — full history in session_log.md)

- [X] **2026-06-22 — Welcome-flow Day-2-shippable surface PASS** — see Active section above.
- [X] **2026-06-22 — Marketing remediation cycle (D-CEO-1 + D-CEO-4 P1 + AEO/GEO clean-slate + D1.7 partial)** — Marketing byte-verified PASS on D-CEO-4 P1; PASS on D-CEO-1 + D1.1 fidelity.
- [X] **2026-06-22 — D1.4 brand-gate self-review submitted + Marketing PASS** — 35/37 self-PASS, 5 inline remediations.
- [X] **2026-06-21 — BVP Triad Day 2 sprint shipped** — 4 contemporary surfaces, D1.5 schema lock, D2.1 hooks lock, D2.4 Website-half pre-stage, Stripe CTA hook pre-stage.
- [X] **2026-06-04 — Stage 2.6(b) live-fire runbook prep — paint-by-numbers 11-cell.** ORS PASS Standard.
- [X] **2026-06-04 — P9_D3 Detailed Red-Team Pass 2.** Worker v2.2 deployed; F-Q-1 nbf JWT fix; 77/77 vitest pass. ORS PASS Detailed.
- [X] **2026-06-02 evening — P9_D3 Stage 3 induction + Stage 4 remediation.** 3 bugs (1 critical XSS); ORS PASS Detailed post-remediation.
- [X] **2026-06-02 — P9_D3 Worker swimlane schema v2 migration.** ORS PASS Detailed.
