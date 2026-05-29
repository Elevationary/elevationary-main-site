# Website Backlog

> **Project Source of Truth:** Always verify the active project phases and deliverables within the P4D3 database before beginning a session.
> **Backlog tags:** `[CODE]` = Website code work | `[BRAND]` = needs Elevationary_Marketing approval | `[PROCESS]` = COO operational | `[JAMES]` = human action required. Website marks only its own items complete.

## First-Session Priorities (Locked Order — Brand Before Build)

- [ ] **[COO] Extend the Fleet Secret Consumer Registry** — Canonical doc: `~/Antigravity_Data/Administrator/docs/secret_consumer_registry.md` (created 2026-05-28 after Newsletter's Vercel R2 rotation drift incident). Website-owned rows to fill: **(a) Stripe checkout + webhook on elevationary.com** (`STRIPE_*` — which keys does the live site read?) + smoke test; **(b) Cloudflare DNS / API** (`CLOUDFLARE_API_TOKEN`, `CF_TOKEN_DNS`) if Website directly reads (vs Administrator-owned tunnel); **(c) DATABASE_URL** if Website uses D1 — disambiguate with El_OS; **(d) VERCEL_TOKEN** — whether Website deploys via the token or CLI-cached auth. Read the registry's "What NOT to store" section before extending — names + smoke tests only, NEVER values. Append rows in place. Mark this item complete once your rows are filled.

### 1. Brand Foundation (FIRST ACTION — blocks all visible-content work)
- [ ] **[BRAND] Read `~/Antigravity/Elevationary_Marketing/brand/` cover-to-cover** — voice, tone, visual standards, messaging. No skim.
- [ ] **[BRAND] Audit current site vs brand standard** — inventory of `src/index.njk`, `about.njk`, `services.njk`, `newsletter-stories/`, `contact.njk`, `legal.njk`, `llms.njk`. Score each against brand. File gaps in `docs/brand_audit_2026_05_XX.md`.
- [ ] **[BRAND] Brand-aligned design pass** — typography, imagery, layout, color, motion. Implementation joint with Elevationary_Marketing. No public-facing change ships before brand sign-off.

### 2. Stripe Subscription Infrastructure (replaces Mailchimp)
- [ ] **[CODE] Design Stripe + Newsletter handoff** — propagation channel (entities.db? R2? Sentinel_Intelligence?). Document in `docs/stripe_handoff_design.md` before code.
- [ ] **[CODE] Stripe Checkout integration on Website** — subscription product, Test Mode first.
- [ ] **[CODE] Stripe webhook endpoint** — Cloudflare Pages Function or Worker. Signature verification mandatory.
- [ ] **[CODE] Subscription state → Newsletter agent** — mechanism per design doc.
- [ ] **[CODE] Mailchimp deprecation plan** — only after Stripe is green in prod.

### 3. Production Checklist
- [ ] **[JAMES]/[CODE] Custom domain on Cloudflare Pages** — confirm `elevationary.com` is configured as Pages custom domain (likely already done; verify in Cloudflare dashboard).
- [ ] **[JAMES] Deployment protection for Preview environments** — discussed 2026-05-03 in Elevationary_OS context; verify whether Cloudflare Pages preview environments need equivalent protection (e.g., Cloudflare Access).

## Carry-Over (Operational)
- [ ] **[CODE] middleware.ts → proxy.ts rename** — not applicable to Eleventy; carried for reference only. Mark N/A and drop at first wrap-up.
- [ ] **[CODE] Cloudflare Pages build cache hygiene** — verify `_site/` is correctly gitignored (already is, per `.gitignore` line). Confirm no cache pollution in deploys.

## Operational Rules
- [ ] **Operational Rule:** Do NOT populate this backlog with granular tasks. All granular work must be filed in the P4D3 system.
- [ ] **Operational Rule:** Execute ORS inline during implementation. Do NOT backfill retroactively.
- [ ] **Operational Rule:** Brand-first. No visible-content change ships without Elevationary_Marketing sign-off.
- [ ] **Operational Rule:** Stripe in Test Mode first, every time. Production code requires a Test Mode green pass.

## Icebox

- [ ] **[CODE] Lighthouse audit + optimization pass** — defer until brand pass complete; otherwise re-work.
- [ ] **[CODE] /llms.txt (`llms.njk`)** — review current content; ensure LLM crawler hints align with brand messaging.
- [ ] **[CODE] Eleventy 3.x migration audit** — currently 3.1.2; track upstream changes.

## Completed
*(populated by Website at each wrap-up; full history at `~/Antigravity_Data/Website/docs/session_log.md`)*
