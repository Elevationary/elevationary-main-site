# Website Build Handover — 2026-05-20 (Initial Provisioning)

## Agent
Website (Public-Facing Web Properties Code Specialist)

## Reports To
Administrator (Fleet COO + Code Pilot)

## Session Summary

This file is initialized empty during COO Transition Phase 1.2 (P4D3 `task_c00a0005`).
No Website coding sessions have run yet under this agent identity.

The repo was relocated 2026-05-20 from `~/Antigravity/micro-site/elevationary-main-site/` →
`~/Antigravity/Website/` (P4D3 `task_c00a0002`). Git history, GitHub remote
(`github.com/Elevationary/elevationary-main-site`), and Cloudflare Pages deploy chain
all preserved. Production verified post-move: `curl -sI https://elevationary.com/`
returned HTTP 200 with `server: cloudflare` and `cf-ray` present.

Prior work on the site lived under the legacy `micro-site` agent (Web-Presence
Software Developer) — see `~/Antigravity_Data/Archive/micro-site_2026-05-19/`
for the archived parent repo state if historical context is needed.

## What Got Done

Provisioning only — no site changes this session.

## Remaining Work

First-session priorities per COO Plan v3 §8.2 — execution order:

1. **[BRAND] Brand standards alignment** (FIRST ACTION) — read `~/Antigravity/Elevationary_Marketing/brand/` cover-to-cover. Inventory current site copy + design vs brand standard. Identify gaps before any other work. No public-facing change ships until brand-aligned.
2. **[CODE] Visual beautification** — current site is mostly text shell (`about.njk`, `services.njk`, etc.). Move to brand-consistent design: typography, imagery, layout, color, motion. Joint with Elevationary_Marketing.
3. **[CODE] Stripe subscription infrastructure** — replace Mailchimp for Newsletter. Stripe is source of truth. Webhook signature verification mandatory. Test Mode green pass before any production deploy. Subscription state propagation mechanism to Newsletter agent TBD.
4. **[JAMES] Production checklist completion** — items 2/5 outstanding: Vercel custom domain (or confirm Cloudflare Pages-only path), deployment protection on Preview environments.

## Open Questions for First Session

- **Cloudflare Pages vs Vercel** — the existing site deploys via Cloudflare Pages (`_headers`, `_site/` output, GitHub remote-driven). The COO plan and backlog references "Vercel custom domain" as a James task — that's likely stale (Elevationary_OS uses Vercel, Website uses Cloudflare Pages). Confirm at first session.
- **Newsletter ↔ Website Stripe handoff** — what's the propagation channel? Shared SQLite (`entities.db`)? R2 file drop? Sentinel_Intelligence ingest? Needs design before Stripe code.

## Do Not Re-Try (Carried Fleet Rules)

- Do NOT publish Elevationary-branded content without brand standard compliance (`~/Antigravity/Elevationary_Marketing/brand/`).
- Do NOT deploy production Stripe code without a Test Mode green pass.
- Do NOT trust unsigned Stripe webhook payloads. Signature verification or reject.
- Do NOT split agent home from code repo. One agent, one repo.

## Infrastructure State (Snapshot at Provisioning)

- **Cloudflare Pages** auto-deploy active from `github.com/Elevationary/elevationary-main-site`. Build = `npm run build` (Eleventy) → publishes `_site/`. Verified live 2026-05-20.
- **HTTPS reachable:** `curl -sI https://elevationary.com/` → HTTP 200, `server: cloudflare`, `cf-ray: 9febe3e3dc7c2a88-LAX`.
- **DNS:** Cloudflare hosted zone (per COO transition prep memory). NS = `henry.ns.cloudflare.com / clarissa.ns.cloudflare.com`.
- **GoDaddy → Squarespace handover scheduled 2026-06-11** — suspect first if DNS/tunnel surfaces break that day.
- **Telegram bot:** Display name "ElWebsite" (canonical `@username` remains `EleSentinelIntelBot` per accepted L1 divergence — Telegram doesn't allow username rename without delete+recreate). `agentName: "Website"` in `~/.elevationary/bots.json` (entry [8]).

## Branch State

On `main`, in sync with `origin/main`. HEAD: `b06b34d` (D1.2 content population, Apr 22).
No uncommitted changes pre-provisioning. About to commit agent files as first commit
under the Website agent identity.

## Tech Stack

- **Eleventy 3.1.2** (11ty) static site generator
- **luxon 3.7.2** for date handling
- **Node.js** via `npm`
- **Cloudflare Pages** deploy + edge
- **Source:** `src/` (njk templates), `assets/`, `_data/`, `_includes/`
- **Output:** `_site/` (gitignored, build artifact)
- **Config:** `_headers` (HTTP headers), `_redirects` (URL rewrites), `.eleventy.js`
