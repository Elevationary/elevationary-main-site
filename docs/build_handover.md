# Website Build Handover — 2026-06-04 (interim, post-Stage-2.6(b)-runbook-prep)

## Agent
Website (Public-Facing Web Properties Code Specialist)

## Reports To
Administrator (Fleet COO + Code Pilot)

## Session Summary

**Doc-only session.** Authored the Stage 2.6(b) live-fire 11-cell runbook as the canonical paint-by-numbers reference so the next CEO + Sales + Website coordinated live-fire is deterministic, not invent-as-we-go. Production Worker untouched (v2.2 `459d1ab9…` from 2026-06-03 still live). ORS PASS (Standard rigor). Runbook uploaded to L4 `agent-context` vault (doc `…-9d9d699c`) as the canonical reference for ANY future entitlement matrix work, per CEO directive.

The runbook + ORS live in `~/Antigravity_Data/Website/docs/` (non-git data dir); only the handover + backlog + P4D3 task update land in the code-repo commit today.

## What's Live in Production (unchanged from 2026-06-03 build `19199b5` + Worker v2.2)

No code changed. State identical to prior handover.

| Component | State |
|---|---|
| Cloudflare Worker `subscriber-content` **v2.2** | DEPLOYED — version `459d1ab9-e767-4c83-b73c-3a7ba2b41c63`. Routes `elevationary.com/editions/*` + `/account/*`. JWT strict mode incl. `nbf` claim check. |
| Cloudflare Access "Subscriber Content" app | LIVE. AUD `3c0a5765…0bfa`. |
| R2 binding strategy | Single `gemini-content-factory` bucket; `sales/` + `newsletter/` prefixes. |
| Worker secret `STRIPE_SECRET_KEY` | Set, LIVE-mode restricted `subscriptions:read`. (Runbook Step 0.2 cycles this to TEST mode for the live-fire window; cleanup cycles back.) |
| Public routes | HTTP/2 200 unchanged. Production smoke trio at wrap-up: clean. |
| Live-fire fixture | `newsletter/drafts/2026-06-01/p9d3-live-fire.md` (1777 bytes) remains seeded from pass-2 session. Three additional fixtures will be seeded by the runbook at Step 0.3 (and torn down at Step 12). |

## What Got Done This Session (2026-06-04 — interim post-runbook-prep)

### Stage 2.6(b) live-fire runbook v2 — paint-by-numbers 11-cell matrix

CEO directive: P9_D3 Detailed PASS landed 2026-06-03; Stage 2.6(b) is the final integration gate but requires CEO + Sales coordination — do NOT proceed with Stage 2.6(b) directly. Instead, deliver an exec-ready runbook so when CEO fires the live-fire it's deterministic.

**Deliverable:** `~/Antigravity_Data/Website/docs/stage_2_6b_live_fire_runbook_2026_06_04.md` — 992 lines, 58.2 KB.

**11 cells in execution order** (cheapest setup first, terminal states last):

| # | Cell | Worker branch (src/index.ts) | Expected |
|---|---|---|---|
| 1 | no-sub | findActiveSubscriptions → [] → upgradeRedirect | 302 → /upgrade/?swimlane=&edition= |
| 2 | individual happy-path | all gates pass | 200 + `x-elevationary-entitlement: sb=...;tier=individual;swimlane=...` |
| 10 | wrong-swimlane | `swimlanes_accessible.includes(swimlane)` false | 302 (carries REQUESTED swimlane, not entitled) |
| 11 | before-historical | `editionDate < historical_access_from` | 302 |
| 7 | past_due | both ENTITLED_STATUSES + STRIPE_ACTIVE_STATUSES include past_due — **dunning grace, expects 200** | 200 (Cell 7 gotcha flagged explicitly in runbook) |
| 8 | suppressed | filtered at ENTITLED_STATUSES | 302 |
| 6 | cancelled | same | 302 |
| 9 | Stripe DiD catch | stripeVerifyActive returns false → continue | 302 (R2 active, Stripe canceled) |
| 3 | functional_bundle | tier=functional_bundle, multi-swimlane | 200 |
| 4 | all_access purchaser | contact_id === ct.ct_id branch | 200 |
| 5 | all_access shared seat | shared_contact_ids.includes(contactId) branch | 200 (sb_id = purchaser's) |

**Coordination summary at top (read-cold-once):** 3 system invariants (R2 strong consistency, Sales↔Stripe state independence, Worker reads R2's current Stripe sub_id) + roles + 2-inbox / 5-Stripe-test-sub / 4-fixture pre-staged inputs + FAIL vs SKIP rubric + Sales-script-unavailable direct-R2 fallback + cell-by-cell time budget (107 min, 150 budgeted) + Step 0.7 CF Access OTP screen walkthrough + Step 0.8 explicit no-auto-redirect-between-cells rule.

### Stage 3 — induce ≥5 failure modes against the runbook itself

Per CEO directive (Heller F9 generalized: the runbook IS the verifier of the production matrix, so verify it before shipping). Adversarial cold-CEO reading produced **10 distinct ambiguity modes (R-1 through R-10)** — twice the directive minimum:

| Mode | Gap |
|---|---|
| R-1 | R2 consistency / Worker cache unspecified |
| R-2 | CF Access OTP UI screens unspecified |
| R-3 | Navigation after 302 redirect unspecified (auto-redirect vs manual typing) |
| R-4 | Cell 5 private-mode cookie fallback missing |
| R-5 | `sub_TEST_STRIPE_DID` cancel timing contradiction (Step 0 vs Cell 9) |
| R-6 | Step 12.4 cleanup wording confused end-state vs origin-state |
| R-7 | Cell 8 lifecycle (suppress on past_due may reject) unhandled |
| R-8 | Sales/Stripe state independence not stated explicitly |
| R-9 | URL query param ordering not guaranteed in `?swimlane=&edition=` |
| R-10 | Sales-script-unavailable global fallback missing |

### Stage 4 — surgical edits closing all 10 modes

8 unique `Edit` calls landed v1 → v2:

- New "Three system-level invariants" header section closes R-1 + R-8
- New Step 0.7 (CF Access OTP screen walkthrough) closes R-2
- New Step 0.8 (navigation rule) closes R-3 globally without per-cell edits
- Cell 5 (b) expanded with first-try → fallback → second-fallback paths closes R-4
- Step 0.3 + Cell 9 (a) both rewritten closes R-5
- Step 12.4 replaced bullet list with end-state table closes R-6
- Cell 8 (a) appended "Lifecycle fallback" block closes R-7
- FAIL/SKIP table row rewritten closes R-9
- New "Sales-script-unavailable fallback" section closes R-10

### Stage 5 — retest

Re-read v2 against the same 10 questions. Every one now has a deterministic answer cited at a specific v2 section. Sensitive file scan: 0 hits across repo + data dir.

### L4 + L3 indexing

`vault_upload.py upload agent-context <path>` succeeded. Doc ID `stage_2_6b_live_fire_runbook_2026_06_04-9d9d699c`, 58.2 KB. L3 pointer auto-injected via `vault_upload.py`. Recall on "Stage 2.6b live-fire runbook 11-cell entitlement matrix" returns runbook at rank #2 (L2=0.5428).

### P4D3

`task_05d28394` inserted under `P9_D3_Website_Phase_B_Swimlane_Adaptation`, status `Completed`, Owner `Website`, Date `2026-06-04`. Deliverable status remains 🔲 until Stage 2.6(b) browser live-fire passes — runbook prep does not flip the deliverable.

## Remaining Work

### Stage 2.6(b) browser live-fire — open, blocks deliverable status flip

**No longer "invent-as-we-go" — the runbook is canonical.** CEO + Sales + Website coordinate per the runbook. Pre-flight gates CEO must confirm before Step 0:

1. Two OTP-able email inboxes (`OTP_A` for cells 1–4, 6–11; `OTP_B` for cell 5).
2. One Stripe Test Mode restricted key, scope `subscriptions:read`.
3. Five test-mode Stripe subscription objects created per the runbook's Step 0.3 inventory.
4. `sales_subscription.py` operational, OR Sales agent on standby for direct-R2 fallback if it errors.
5. Cycle Worker `STRIPE_SECRET_KEY` to TEST mode per Step 0.2 (5-min window; pre-launch so blast radius zero).

After matrix passes: flip P3_D1 + P4_D1 + P4_D2 + P9_D3 deliverable statuses 🔲 → 🟢. Post-live-fire ORS (separate deliverable) cites this runbook by cell number with real observed HTTP responses + headers per cell.

### Path-canonicalization note (deferred)

CEO directive named `~/Antigravity_Data/Elevationary_Website/docs/...`; canonical Website data dir per CLAUDE.md is `~/Antigravity_Data/Website/docs/`. `Elevationary_Website` does not exist on disk. Runbook + ORS landed at the canonical path. If CEO intended a new hierarchy (rename / repurpose), flag and Website moves both files.

### Sales-side optimizations (filed; non-blocking)

- Add `historical_access_from` + `deep_content_access` to `_index_row()` projection in `sales_subscription.py` — closes one R2 GET per entitled request. Open since 2026-05-30.
- Ship `sales/index_contacts_by_email.json` — O(1) email lookup; closes timing-oracle finding. Open since 2026-05-30.
- Sales contact-by-email uniqueness invariant (from pass-2 F-U-1). Open since 2026-06-04.

### Phase B+ candidates (Website-owned)

- Real `/editions/` archive listing — Worker still returns placeholder.
- Constant-time gating (timing-oracle hardening).
- Replace 4 Stripe Checkout placeholders in `src/_data/site.json`.
- Future Cell 12 (`!entitlements.deep_content_access` branch) — noted in runbook reference section; not in scope today's matrix.

### Deferred

- Brand pass on `/subscribe/`, `/editions/`, `/account/`, `/upgrade/`, Worker-rendered surfaces — `~/Antigravity/Elevationary_Marketing/brand/` still empty.
- `agent.elevationary.com` archival decision — 52 references in `_site/`.
- `task_f1d4e0a9` (P3 Access service token) — confirm moot vs future hardening.

## Open Questions (forwarded from runbook section 5)

1. **`sales_contact.py`** — does it exist? Runbook documents both Sales-script and direct-R2 fallback paths for contact creation; resolve at first execution.
2. **`sales_subscription.py update --field` JSON parsing** — confirm Cell 5's `--field 'shared_contact_ids=[...]'` syntax works.
3. **Stripe Test Mode restricted key scope confirmation** — `subscriptions:read` ONLY.
4. **OTP_A and OTP_B inbox confirmation** — both accessible from the mobile browser used for the live-fire.
5. **Cell 5 cookie isolation** — incognito vs second browser app — pick at run time.

## Do Not Re-Try (Carried Fleet Rules)

(Unchanged from 2026-06-03 handover. Replicated for self-contained reference.)

- Do NOT publish Elevationary-branded content without brand standard compliance.
- Do NOT deploy production Stripe code without a Test Mode green pass.
- Do NOT trust unsigned Stripe webhook payloads.
- Do NOT include `STRIPE_SECRET_KEY` in any committed file.
- Do NOT trust `cf-access-authenticated-user-email` without `Cf-Access-Jwt-Assertion` verification in production.
- **From 2026-05-30:** Auth/identity/entitlement gates require executable tests, not just static red-team. (Fleet lesson `fleet_lesson_executable_security_tests_over_static_redteam` — L3.)
- **From 2026-06-02:** When a cross-agent upstream schema migration ships, run consumer-side executable test matrix against the new shape BEFORE shipping.
- **From 2026-06-02:** Do NOT trust runtime JSON shapes against TS types. Validate at use-site (`Array.isArray`, `typeof === "string"`).
- **From 2026-06-02:** Do NOT trust markdown renderer defaults to escape HTML — `marked@^4` removed `sanitize`; override `renderer.html` or wrap with DOMPurify.
- **From 2026-06-02:** ORS Stage 3 demands real induction, not characterological reasoning.
- **From 2026-06-04 (pass-2):** Strict JWT verifiers must check every relevant time-window claim (`exp` AND `nbf`).
- **From 2026-06-04 (pass-2):** Any "this command catches X / Y / Z" security check must ship with a positive-and-negative fixture verifier-of-the-verifier.
- **From 2026-06-04 (this session):** When a runbook is the verifier of a production matrix, induce ≥5 failure modes against the runbook BEFORE shipping. Adversarial cold-read by a perspective that has not seen the supporting ORS / context — the gaps that surface are the gaps a real first-time executor will hit. (Captured in runbook itself; no separate L3 lesson needed because the canonical reference IS the lesson.)

## Infrastructure State

- **Cloudflare Pages** auto-deploy active from `github.com/Elevationary/elevationary-main-site`. Build `4aa8369` (post-2026-06-03-wrap-up timelog) live.
- **Cloudflare Worker `subscriber-content` v2.2** — version `459d1ab9-e767-4c83-b73c-3a7ba2b41c63` DEPLOYED.
- **Cloudflare Access "Subscriber Content"** — CONFIGURED + ACTIVE. AUD `3c0a5765…0bfa`. JWT strict-mode enforces both `exp` and `nbf`.
- **R2 bucket `gemini-content-factory`** — single bucket; `sales/` + `newsletter/` prefixes.
- **Worker secret `STRIPE_SECRET_KEY`** — set, LIVE-mode restricted `subscriptions:read`. Runbook Step 0.2 cycles to TEST mode for live-fire; Step 12.5 cycles back.
- **DNS:** Cloudflare hosted zone unchanged.
- **GoDaddy → Squarespace handover scheduled 2026-06-11** — **7 days from now**.
- **Telegram bot:** `agentName: "Website"` in `~/.elevationary/bots.json` entry [8].

## Branch State

On `main`, in sync with `origin/main`. HEAD pre-this-commit: `4aa8369`. This wrap-up commit appends doc-only changes (handover + backlog + this session's timelog). Untracked: `.tmp/`, `directives/CLAUDE_CODE.md.bak.20260520`, `docs/SESSION_LOG.md` (carried; pre-existing).

## Tech Stack

(Unchanged.)

- Eleventy 3.1.5 · luxon 3.7.2 · Cloudflare Pages · Cloudflare Worker `subscriber-content` v2.2 (TypeScript, `@cloudflare/workers-types`)
- Worker prod deps: `marked@^12.0.2` (renderer.html overridden to escape)
- Worker dev deps: `jose@^5.9`, `vitest@^2.1`, `wrangler@^3.60`, `typescript@^5.4`

## ORS + Walkthrough + L4 Cross-References

- **This session ORS:** `~/Antigravity_Data/Website/docs/ORS_logs/ORS_stage_2_6b_runbook_prep_2026_06_04.md` — ORS PASS (Standard rigor). 10-mode Stage 3 induction against runbook v1; 8 surgical edits closed all 10 in v2; Stage 5 re-induction confirms bulletproof.
- **This session deliverable:** `~/Antigravity_Data/Website/docs/stage_2_6b_live_fire_runbook_2026_06_04.md` — runbook v2. L4 `agent-context` doc `stage_2_6b_live_fire_runbook_2026_06_04-9d9d699c` (58.2 KB).
- **Pass 2 substantive ORS (trust anchor for the Worker v2.2 the runbook targets):** `ORS_p9_d3_detailed_redteam_pass2_2026_06_03.md` — ORS PASS (Rigor: Detailed).
- **Pass 2 walkthrough:** `walkthrough_p9_d3_detailed_redteam_pass2_2026_06_03.md`.
- **Pass 2 wrap-up hygiene ORS:** `ORS_pass2_wrapup_2026_06_04.md` — ORS PASS (Standard).
- **2026-06-02 substantive ORS:** `ORS_p9_d3_swimlane_migration_2026_06_02.md` — ORS PASS (Detailed) post-Stage-4-remediation.
