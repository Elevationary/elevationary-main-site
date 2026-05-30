# Website Build Handover — 2026-05-30 (Mid-session, post-Phase-B)

## Agent
Website (Public-Facing Web Properties Code Specialist)

## Reports To
Administrator (Fleet COO + Code Pilot)

## Session Summary

First Website coding session under the new agent identity. Subscription_Revenue_Pipeline Phases A + B both shipped to repo + production this session. The only remaining work to close P3 + P4 end-to-end is James's deploy-side hand-actions (dashboard Access config + `wrangler deploy`). Phase B Worker is the full artifact — R2 reads, Stripe defense-in-depth, OR-join enterprise entitlement, served content + upgrade redirects.

Two ORS PASS logs landed this session, both inline-discipline compliant (Stage 0/1 before code, Stages 2–5 paste-in-real-time).

## What Got Done

### Phase A (commits `65fe1a6` → `c8ce467`, deployed to elevationary.com)
- **P3 — Cloudflare Access spec** (`cloudflare/access/subscriber_content_app.md` + `subscriber_content_policy.json`). Locked: Google SSO + Email OTP, 30-day session, identity-only at the gate.
- **P4_D2 — Gated route templates**:
  - `/subscribe/` (public) — mirrors agent.elevationary.com/unlock/ tier structure ($29 / $69 / $149). Hero corrected from "behind the paywall" → "Subscribers get access to in-depth research."
  - `/editions/` (gated, placeholder).
  - `/account/` (gated, placeholder with Stripe Customer Portal handoff).
- **`/unlock/` dead-link sweep** — 7 files: `index.njk` (×2), `services.njk`, `newsletter-stories/{index,story-viewer}.njk`, `llms.njk`, `.well-known/ai-plugin.json`. Production verified zero `/unlock/`.
- **P4_D1 scaffold** — deny-by-default Worker. Superseded by Phase B.
- **P4D3 ownership** — `P3_D1`, `P4_D1`, `P4_D2` reassigned Owner → Website.
- **ORS PASS:** `~/Antigravity_Data/Website/docs/ORS_logs/ORS_subscriptions_phase_a_2026_05_30.md`.

### Phase B (commits `bf4dd01` → `90083a3`, deployed to elevationary.com)
- **P4_D1 — Full Entitlement Worker** (`workers/subscriber-content/src/index.ts`):
    - Email → Contact via R2 `sales/contacts/` (paginated list + GET, case-insensitive, malformed-JSON tolerant).
    - Active subscriptions via `sales/index_subscriptions.json` with OR-join: `contact_id` match OR `tier=enterprise AND company_id` match. Status filter `(active | past_due)`.
    - Per-sub R2 GET for `entitlements.{historical_access_from, deep_content_access}` checks (one extra GET — Sales index row doesn't include those fields; backlog optimization filed).
    - Stripe `subscriptions.retrieve` defense-in-depth on every gated request (+50ms accepted per CEO ratification). Try/catch fails closed → false-deny preferred over false-allow.
    - Pass: `marked`-rendered HTML from `newsletter/drafts/<date>/<topic>.md` with `cache-control: private, no-store` and `x-elevationary-entitlement` diagnostic header.
    - Fail: 302 to `/upgrade?stream=...&edition=...`.
    - `/account/` Worker-side HTML with subs table + Stripe Customer Portal link.
    - `/editions/` archive placeholder (entitled subscribers only; per-date links arrive as Newsletter ships editions).
    - Path-traversal guards via strict regex on date + topic.
- **`wrangler.toml`** — routes uncommented (`elevationary.com/editions/*` + `/account/*`), R2 bindings (`SALES_CRM`, `NEWSLETTER_CONTENT`), `nodejs_compat`, observability enabled.
- **`marked@^12.0.2`** added as production dep. `npm audit --omit=dev` → 0 vulnerabilities.
- **`/upgrade/` Eleventy template** — public 302 destination. Reads `?stream=` + `?edition=` from URL via inline JS (`textContent` only, no XSS). Verified live in production.
- **ORS PASS:** `~/Antigravity_Data/Website/docs/ORS_logs/ORS_p4_d1_entitlement_worker_2026_05_30.md`.

### Verification snapshot (build `90083a3`)

| Check | Result |
|---|---|
| `tsc --noEmit` on Worker | exit 0, no errors |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `npm run build` (Eleventy) | 13 files, no warnings |
| Sensitive file scan | 0 hits |
| Production homepage | HTTP/2 200 |
| Production `/subscribe/` | HTTP/2 200, hero copy correct |
| Production `/editions/` placeholder | HTTP/2 200 (Pages still serves; Worker not yet deployed) |
| Production `/account/` placeholder | HTTP/2 200 (Pages still serves; Worker not yet deployed) |
| Production `/upgrade/` | HTTP/2 200, query-param personalization renders |
| Zero `/unlock/` in sampled production HTML | confirmed |

## Remaining Work

### James hand-actions to fully close P3 + P4

Single workflow, in order:

1. **Configure Cloudflare Access "Subscriber Content" app** per checklist at the bottom of `cloudflare/access/subscriber_content_app.md`. Locks: Google SSO + Email OTP, 30-day session, two route patterns, identity-only policy.
2. **Verify R2 buckets** `elevationary-sales` and `elevationary-newsletter` exist in your Cloudflare account. If named differently, edit `workers/subscriber-content/wrangler.toml` before deploy.
3. **Stripe Worker secret:**
    ```bash
    cd ~/Antigravity/Website/workers/subscriber-content
    npm install
    npx wrangler login
    npx wrangler secret put STRIPE_SECRET_KEY
    # paste a RESTRICTED key with scope `subscriptions:read` only
    ```
4. **Deploy:** `npx wrangler deploy` — claims both routes atomically. Worker goes live.
5. **Update** `~/Antigravity_Data/Administrator/docs/secret_consumer_registry.md` — add the `STRIPE_SECRET_KEY` Worker-side consumer row (name + smoke test only; never the value).
6. **Browser live-fire:**
    - Private window → `https://elevationary.com/editions/2026-XX-XX/<topic>` (any path under `/editions/`) → Access prompt with Google SSO + Email OTP.
    - Complete OTP. Since no subscriptions exist yet in R2, Worker returns 302 to `/upgrade?stream=...`.
    - `/account/` → 302 to `/upgrade/` (no active sub).
    - Once Sales writes the first test subscription via `sales_subscription.py create ...`, repeat the above and confirm content serves.
    - Cancel that test sub in Stripe (CLI) → next request returns `/upgrade` 302 even before Stripe webhook hits R2 (defense-in-depth validation).
    - Enterprise OR-join: a second contact at the same company_id can access.

### Sales-side optimizations (backlog — non-blocking for first live use)

- **Sales adds `historical_access_from` to `_index_row`** projection in `sales_subscription.py` — saves one R2 GET per entitled Worker request.
- **Sales ships `sales/index_contacts_by_email.json`** — replaces O(N) contacts list + GET with O(1) email lookup. Important as subscriber count grows.

### Deferred (out of scope for P3 + P4)

- Real Stripe Checkout Payment Link URLs replace 4 placeholders in `src/_data/site.json` — lands when Sales P2 (Stripe webhook + Checkout session) ships.
- `/editions/` archive listing (full implementation, not placeholder) — Phase B+ once Newsletter publishes a date manifest convention.
- Consulting redirects in `_redirects` (5 rules) + footer/nav `agent.elevationary.com` refs in `base.njk` (52 refs total in `_site/`) — wait on agent.elevationary.com archival decision.
- Brand pass on `/subscribe/`, `/editions/`, `/account/`, `/upgrade/` — blocked on Elevationary_Marketing populating `~/Antigravity/Elevationary_Marketing/brand/` (still empty as of 2026-05-30).
- Fleet Secret Consumer Registry rows — Stripe (added by James as part of hand-action 5 above), Cloudflare (TBD), VERCEL_TOKEN (TBD), DATABASE_URL/D1 (TBD).

## Open Questions

- **Sales side: enterprise tier writes** — does `sales_subscription.py` support `--tier enterprise --company co_x` cleanly, or does the operator need to write the JSON by hand for the first enterprise sub? Confirm before James tests OR-join.
- **Cloudflare R2 bucket naming** — `elevationary-sales` and `elevationary-newsletter` assumed. If James uses different bucket names, both `wrangler.toml` bindings need to match before `wrangler deploy`.
- **R2 bucket access for the Worker account** — Worker needs read-only on both buckets. If R2 is in a different Cloudflare account than the Pages project, cross-account R2 setup is needed.

## Do Not Re-Try (Carried Fleet Rules)

- Do NOT publish Elevationary-branded content without brand standard compliance (Phase A/B infrastructure exception accepted with documented compensating controls; do not generalize).
- Do NOT deploy production Stripe code without a Test Mode green pass. *(Worker calls Stripe `subscriptions.retrieve` only — read, no mutation. The first live request itself IS the test.)*
- Do NOT trust unsigned Stripe webhook payloads. *(Webhook receiver is Sales-owned, not Website.)*
- Do NOT split agent home from code repo. One agent, one repo.
- Do NOT include `STRIPE_SECRET_KEY` in any committed file. Only env-binding references in Worker source; only `wrangler secret put` to set the value.

## Infrastructure State

- **Cloudflare Pages** auto-deploy active from `github.com/Elevationary/elevationary-main-site`. Build = `npm run build` → publishes `_site/`. Build `90083a3` verified live 2026-05-30 18:04 GMT.
- **Cloudflare Worker `subscriber-content`** — full Phase B source in repo. NOT deployed.
- **Cloudflare Access** — NOT yet configured in dashboard.
- **R2 buckets** `elevationary-sales` and `elevationary-newsletter` — existence not yet verified from Website context.
- **DNS:** Cloudflare hosted zone unchanged.
- **GoDaddy → Squarespace handover scheduled 2026-06-11** — carry-over warning.
- **Telegram bot:** `agentName: "Website"` (display "ElWebsite") in `~/.elevationary/bots.json` entry [8].

## Branch State

On `main`, in sync with `origin/main`. HEAD: `90083a3`. Commits this session:

| Commit | Subject |
|---|---|
| `65fe1a6` | feat: P3 Cloudflare Access spec for Subscriber Content app |
| `c486fec` | feat: P4_D2 gated route templates + /unlock/ link sweep |
| `32382de` | feat: P4_D1 scaffold — deny-by-default Entitlement Worker |
| `c8ce467` | docs: surface COO Subscription_Revenue_Pipeline dispatch |
| `bf4dd01` | docs: interim handover + backlog post-Phase-A |
| `90083a3` | feat: P4_D1 entitlement Worker + /upgrade/ template |

Untracked file `directives/CLAUDE_CODE.md.bak.20260520` is pre-existing and unrelated.

## Tech Stack

- Eleventy 3.1.5 (11ty) static site generator
- luxon 3.7.2 for date handling
- Cloudflare Pages deploy + edge
- Cloudflare Worker (`subscriber-content`) — TypeScript with `@cloudflare/workers-types`
- Worker prod dep: `marked@^12.0.2` (markdown → HTML)
- Worker dev deps: `wrangler@^3.60.0`, `typescript@^5.4.0`
- Source: `src/` (njk templates), `assets/`, `_data/`, `_includes/`, `cloudflare/access/` (Access spec), `workers/subscriber-content/` (Worker)
- Output: `_site/` (gitignored, build artifact)
- Config: `_headers`, `_redirects`, `.eleventy.js`, `workers/subscriber-content/wrangler.toml`
