# Website Build Handover — 2026-06-02 (post-close-out)

## Agent
Website (Public-Facing Web Properties Code Specialist)

## Reports To
Administrator (Fleet COO + Code Pilot)

## Session Summary

**The Subscription_Revenue_Pipeline gate is LIVE on `elevationary.com`.** Between the 2026-05-30 wrap-up and this onboarding, James executed the close-out workflow: configured the Cloudflare Access "Subscriber Content" app, set the JWT strict-mode vars in `wrangler.toml`, consolidated R2 to a single bucket (`gemini-content-factory`) with prefix-based separation, and ran `wrangler deploy`. Production smoke confirms `/editions/*` and `/account/*` both 302 through Cloudflare Access (kid + aud match the wrangler.toml AUD).

Three Website ORS PASSes from last session (Phase A spec + templates, Phase B Worker, Detailed Red-Team) are the trust anchors. No new ORS opened this session — this is a state-refresh onboarding only.

## What's Live in Production

| Component | State |
|---|---|
| Cloudflare Access `Subscriber Content` app | LIVE — 302s `/editions/*` + `/account/*` to `elevationary.cloudflareaccess.com/cdn-cgi/access/login/...` |
| `CF_ACCESS_TEAM_DOMAIN = "elevationary.cloudflareaccess.com"` | LIVE in `wrangler.toml [vars]` |
| `CF_ACCESS_AUD = "3c0a5765…0bfa"` | LIVE — matches the AUD in the Access login redirect URL |
| Worker `subscriber-content` | DEPLOYED — routes `elevationary.com/editions/*` + `/account/*` claimed |
| R2 bindings | Consolidated: both `SALES_CRM` and `NEWSLETTER_CONTENT` point at `gemini-content-factory` (prefix-based separation: `sales/...` vs `newsletter/...`). Worker code unaffected. |
| Worker JWT strict-mode | ACTIVE — `resolveAuthenticatedEmail()` requires a valid `Cf-Access-Jwt-Assertion` since both env vars are set |
| Public routes (`/`, `/subscribe/`, `/upgrade/`, etc.) | HTTP/2 200 unchanged |
| Stripe `subscriptions.retrieve` defense-in-depth | Worker code live; awaits first subscriber to exercise |

James's commit in question: `360b740 chore(worker): wire CF Access JWT vars + repoint R2 bindings`.

## What Got Done (cumulative across sessions)

### Phase A — production-deployed (commits `65fe1a6` → `c8ce467`)
- P3 Cloudflare Access spec authored: `cloudflare/access/subscriber_content_app.md` + `subscriber_content_policy.json`.
- P4_D2 gated route Eleventy templates: `/subscribe/`, `/editions/`, `/account/`. `/subscribe/` hero corrected from "behind the paywall" → "Subscribers get access to in-depth research."
- `/unlock/` dead-link sweep across 7 files.
- P4_D1 deny-by-default Worker scaffold (later superseded).
- P4D3 ownership: `P3_D1`, `P4_D1`, `P4_D2` reassigned Owner → Website.
- ORS PASS: `ORS_subscriptions_phase_a_2026_05_30.md`.

### Phase B — production-deployed (commits `bf4dd01` → `90083a3`)
- Full P4_D1 Worker: R2 email→Contact resolution, OR-join sub lookup, per-sub historical/deep-access checks, Stripe DiD, marked-rendered HTML serve, /upgrade redirect, /account inline render, /editions archive placeholder.
- `wrangler.toml` — routes uncommented, R2 bindings, observability.
- `marked@^12` production dep added.
- `/upgrade/` Eleventy template.
- ORS PASS: `ORS_p4_d1_entitlement_worker_2026_05_30.md`.

### Detailed Red-Team — repo-only (commit `4973625`, Rigor: Detailed)
- vitest harness `workers/subscriber-content/test/worker.test.ts` — 55 tests across 12 describe-blocks.
- Full entitlement matrix walked.
- FINDING 1 (security, high) FIXED in same ORS: `Cf-Access-Jwt-Assertion` verification with JWKS caching, RS256-only enforcement (defeats HS256 algorithm-confusion), email-mismatch defense.
- 2 lower-severity findings documented.
- L4 vault uploads: walkthroughs (`-a2bb60f4`) + ors-logs (`-35310839`).
- ORS PASS (Rigor: Detailed): `ORS_p4_d1_detailed_redteam_2026_05_30.md`.

### James close-out — production state advance (commit `360b740`, 2026-05-30 → 2026-06-02)
- Cloudflare Access "Subscriber Content" app configured with Google SSO + Email OTP IdPs.
- `wrangler.toml [vars]` populated: `CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD`.
- R2 strategy decision: single `gemini-content-factory` bucket with `sales/` + `newsletter/` prefixes (supersedes the two-bucket assumption in the original spec).
- `STRIPE_SECRET_KEY` set as Worker secret (inferred — Worker is live and Stripe DiD path requires it).
- `wrangler deploy` executed; routes claimed.

## Verification snapshot (build `360b740`)

| Check | Result |
|---|---|
| `curl -sI https://elevationary.com/` | HTTP/2 200 (homepage unchanged) |
| `curl -sI https://elevationary.com/subscribe/` | HTTP/2 200 (public landing) |
| `curl -sI https://elevationary.com/editions/` | HTTP/2 302 → Cloudflare Access login |
| `curl -sI https://elevationary.com/account/` | HTTP/2 302 → Cloudflare Access login |
| Access redirect `kid` + `aud` in Location URL | Match `CF_ACCESS_AUD` in `wrangler.toml` |
| `www-authenticate` header | `Cloudflare-Access resource_metadata="…/editions/"` confirms Access enforcing |

## Remaining Work

### Stage 2.6(b) browser live-fire matrix (open — needs James)

Documented in both Phase B + Detailed ORS logs as the carved-out close-out item. Specific cells to walk:

1. Authenticate (Google SSO or Email OTP) with an email NOT in `sales/contacts/` → expect 302 to `/upgrade/`.
2. Authenticate with an email in `sales/contacts/` but no active subscription → expect 302 to `/upgrade/`.
3. Authenticate with an email tied to an active individual subscription → expect 200 with `x-elevationary-entitlement: sb=…;tier=individual` (requires at least one Sales-written subscription record + at least one Newsletter-published edition in R2).
4. Authenticate with a different email at the same `company_id` as an enterprise subscription → expect 200 with `tier=enterprise` (OR-join validation).
5. Authenticate as a subscriber whose Stripe subscription has been cancelled (but R2 lags) → expect 302 (Stripe defense-in-depth catch).
6. Authenticate, request a `commercial` edition while subscribed only to `nonprofit` → expect 302 `/upgrade?stream=commercial&edition=...`.
7. Authenticate, request an edition whose date predates `historical_access_from` → expect 302.

Items 3–7 require a Sales-written subscription record. Newsletter must also have written at least one `newsletter/drafts/<date>/<topic>.md` for the content-serve paths.

### Fleet Secret Consumer Registry — Stripe row append (open — needs James)

Append a row for the Worker-side `STRIPE_SECRET_KEY` consumer to `~/Antigravity_Data/Administrator/docs/secret_consumer_registry.md` (names + smoke test only; never the value).

### Sales-side optimizations (filed; non-blocking)

- Add `historical_access_from` + `deep_content_access` to `_index_row()` projection in `sales_subscription.py` → eliminates one R2 GET per entitled request.
- Ship `sales/index_contacts_by_email.json` → O(1) email lookup; closes the timing-oracle finding.

### Phase B+ candidates (Website-owned)

- Real `/editions/` archive listing — Worker currently returns a placeholder; full version lists `newsletter/drafts/` by date filtered by subscriber entitlement.
- Constant-time gating (timing-oracle hardening).
- Replace 4 Stripe Checkout placeholders in `src/_data/site.json` with real Payment Links / Sales-provided Checkout session URLs.

### Deferred

- Brand pass on `/subscribe/`, `/editions/`, `/account/`, `/upgrade/`, Worker-rendered surfaces — blocked on `~/Antigravity/Elevationary_Marketing/brand/` (still empty).
- `agent.elevationary.com` archival decision — 52 references in `_site/`.

## Open Questions

- **Service token (`task_f1d4e0a9` in P4D3)** — listed as a P3 task for "Worker-to-Access programmatic check." My current Worker design uses JWT verification at the request boundary, not service-token-based access from Worker → Access. This task may be moot or designed for a different purpose. Confirm whether it should be marked N/A or kept open.
- **Sales subscription record(s)** for live-fire item 3 — does Sales have a way to write a test subscription record in `gemini-content-factory` keyed `sales/subscriptions/sb_test...json` without disrupting real subscribers? (Probably yes via `sales_subscription.py create`.)
- **First Newsletter edition draft** — when does Newsletter plan to write `newsletter/drafts/<date>/<topic>.md` into `gemini-content-factory`? Worker content-serve path depends on it.

## Do Not Re-Try (Carried Fleet Rules)

- Do NOT publish Elevationary-branded content without brand standard compliance (infrastructure exception accepted; do not generalize).
- Do NOT deploy production Stripe code without a Test Mode green pass. *(Worker calls `subscriptions.retrieve` read-only; first live request IS the test.)*
- Do NOT trust unsigned Stripe webhook payloads. *(Webhook receiver is Sales-owned.)*
- Do NOT include `STRIPE_SECRET_KEY` in any committed file. Only env-binding references; only `wrangler secret put` for the value.
- Do NOT trust `cf-access-authenticated-user-email` without `Cf-Access-Jwt-Assertion` verification in production. *(Worker enforces this in strict mode now that both env vars are set; this is the current production posture.)*
- **NEW operational rule from 2026-05-30:** Any code path that gates on auth/identity/entitlement requires **executable tests**, not just static red-team. Filed as fleet lesson `fleet_lesson_executable_security_tests_over_static_redteam` (ingested to L3 2026-05-30, 7 chunks, L2 0.43).

## Infrastructure State

- **Cloudflare Pages** auto-deploy active from `github.com/Elevationary/elevationary-main-site`.
- **Cloudflare Worker `subscriber-content`** — DEPLOYED. Routes claimed: `elevationary.com/editions/*` + `/account/*`.
- **Cloudflare Access "Subscriber Content"** — CONFIGURED + ACTIVE. AUD `3c0a5765…0bfa`.
- **R2 bucket `gemini-content-factory`** — single bucket, prefix-based separation: `sales/...` (Sales-canonical CRM) + `newsletter/...` (Newsletter drafts). Both Worker R2 bindings (`SALES_CRM`, `NEWSLETTER_CONTENT`) point at the same bucket.
- **Worker secret `STRIPE_SECRET_KEY`** — set (restricted: `subscriptions:read`).
- **DNS:** Cloudflare hosted zone unchanged.
- **GoDaddy → Squarespace handover scheduled 2026-06-11** — carry-over warning. **9 days from now.**
- **Telegram bot:** `agentName: "Website"` in `~/.elevationary/bots.json` entry [8].

## Branch State

On `main`, in sync with `origin/main`. HEAD: `17b540a` (timelog) → previous `360b740` (James's wire). Full session-cumulative commit chain:

| Commit | Subject | Origin |
|---|---|---|
| `65fe1a6` | feat: P3 Cloudflare Access spec | Website |
| `c486fec` | feat: P4_D2 gated route templates + /unlock/ link sweep | Website |
| `32382de` | feat: P4_D1 scaffold — deny-by-default Worker | Website |
| `c8ce467` | docs: surface COO Subscription_Revenue_Pipeline dispatch | Website |
| `bf4dd01` | docs: interim handover + backlog post-Phase-A | Website |
| `90083a3` | feat: P4_D1 entitlement Worker + /upgrade/ template | Website |
| `5b80805` | docs: interim handover + backlog post-Phase-B | Website |
| `4973625` | feat: P4_D1 Detailed Red-Team ORS — vitest harness + JWT verification fix | Website |
| `d13bb8b` | docs: wrap-up handover + backlog post-Detailed-Red-Team | Website |
| `360b740` | chore(worker): wire CF Access JWT vars + repoint R2 bindings | James |

Untracked at scan: `.tmp/fleet_lesson_*.md` (last session's fleet-lesson source), `docs/SESSION_LOG.md` (wrap-up artifact), `directives/CLAUDE_CODE.md.bak.20260520` (pre-existing).

## Tech Stack

- Eleventy 3.1.5 — static site generator
- luxon 3.7.2 — date handling
- Cloudflare Pages — public site deploy
- Cloudflare Worker `subscriber-content` — TypeScript on `@cloudflare/workers-types`
- Worker prod deps: `marked@^12.0.2`
- Worker dev deps: `jose@^5.9`, `vitest@^2.1`, `wrangler@^3.60`, `typescript@^5.4`
