# ORS Log: [Feature/Fix Name]
**Date:** YYYY-MM-DD | **Agent:** [Agent Name] | **Session:** [Session ID]
**Conversation reference:** [Claude Code session timestamp + IDE link or anchor — single line, no full transcripts. Post-hoc forensics use this to find the thread; the transcript itself stays in Claude Code's session store.]

---

## Stage 0: Automated Pre-flight
> Machine-checkable conditions that must ALL pass before human review begins.
> List what is automatable for this system: typecheck, lint, config validation,
> dependency resolution, required endpoints reachable, schema valid, etc.
> If any pre-flight check fails, stop here and fix before proceeding.

### Blast Radius Declaration
> Before any checks: list every shared system this change touches and document
> the partial-failure state if the script or deploy crashes mid-run.
> "Shared system" means anything other agents, scripts, or humans depend on:
> bots.json, entities.db, fleet_config, Redis, Vercel, Elevationary OS, P4D3, etc.

| Shared System | Access Type | Partial-Failure State | Recoverable Without Human? |
|---|---|---|---|
| [e.g. bots.json] | [read / write] | [what breaks if this crashes mid-write] | [ ] Yes / [ ] No |
| [add rows as needed] | | | |

- [ ] All shared systems identified?
- [ ] Partial-failure states documented?

### Automated Checks

| Check | Command / Method | Result |
|---|---|---|
| [e.g. Type check] | [e.g. tsc --noEmit] | [ ] Pass / [ ] Fail |
| [e.g. Lint] | [e.g. eslint src/] | [ ] Pass / [ ] Fail |
| [add rows as needed] | | |

- [ ] All pre-flight checks pass? (If NO → fix before proceeding)

---

## Stage 1: BUILD
> Does the system exist and start correctly?

- [ ] All required files present
- [ ] Dependencies installed / compiled
- [ ] System starts without error
- [ ] Logs confirm readiness

### Rollback Procedure
> Write the exact steps to undo this change in production before proceeding.
> If no rollback is possible, state why and explicitly accept the risk.
> Knowing the rollback before you deploy means you can act in seconds, not minutes.

**Rollback:** [exact commands or steps to restore prior state — e.g., "cp bots.json.bak bots.json && launchctl restart com.elevationary.telegram.bot"]

- [ ] Rollback procedure documented (or risk explicitly accepted with rationale)?

---

## Stage 2: VERIFY (Happy Path)
> Does the primary use case work end-to-end — against the LIVE RUNNING SYSTEM?
> Unit tests and code inspection do not satisfy this stage. You must observe actual
> output from the actual deployed system.

### 2a: MODEL (Expected Outcome)
> What should the output look like? Be specific and measurable.

- Expected: [describe]

### 2b: OBSERVE (Actual Outcome)
> What did you actually observe from the live system? Paste real output, not expected output.

- Observed: [paste real output or describe exactly what was seen]

### 2c: COMPARE
- [ ] Expected matches observed? (If NO → Self-Annealing, do not proceed)

---

## Stage 2.5: Equivalence Class Coverage
> The happy path tests one case. This stage asks: what are the distinct valid
> configurations, inputs, or consumers — and have we tested a representative
> from each class?
>
> Identify the equivalence classes for THIS system, then test one representative
> from each. Do not test every permutation — test the boundaries between classes.
>
> Examples by system type:
> - Multi-configuration system: one test per meaningful configuration variant
> - Multi-tenant / multi-user: one test per user tier or role
> - Library or SDK: one test per supported runtime or version
> - API: one test per defined request shape or endpoint category
> - Agent with multiple data sources: one test per source type (present, absent, malformed)
> - CLI: one test per supported flag or mode combination

| Equivalence Class | Representative Tested | Result |
|---|---|---|
| [describe the class] | [what specifically was tested] | [ ] Pass / [ ] Fail |
| [describe the class] | [what specifically was tested] | [ ] Pass / [ ] Fail |
| [add rows as needed] | | |

- [ ] All equivalence classes identified?
- [ ] At least one representative tested per class?

---

## Stage 2.6: Live-Fire Verification
> Unit tests verify code logic. Live-fire verifies the actual deployed system behaves
> correctly under real conditions. These are not interchangeable.
>
> **Agent live-fire**: The agent runs commands against the live system, captures real output,
> and documents it here. No mocks. No simulations.
>
> **Human live-fire**: Anything requiring eyes on a UI, hands on a physical device, or
> real Telegram interaction. CANNOT be delegated to the agent. ORS does not pass until
> James explicitly confirms each human live-fire item.
>
> If a deliverable has no interactive surface (pure backend script, no UI, no bot),
> mark human live-fire N/A and explain why.

### Agent Live-Fire Results

| Action | Command / Method | Real Output | Pass? |
|---|---|---|---|
| [e.g. API returns expected structure] | [curl or CLI command run] | [paste actual output] | [ ] |
| [e.g. Bot command responds correctly] | [script or direct test] | [paste actual output] | [ ] |
| [add rows] | | | |

- [ ] All agent live-fire tests run against the live system (not mocks)?
- [ ] Real outputs pasted above (not described, pasted)?

### Human Live-Fire Required

> List every item that requires James to personally verify. Check only when James
> has confirmed. ORS cannot pass with unchecked items in this list.

| Item | Surface | James Confirmed? |
|---|---|---|
| [e.g. Sidebar checkboxes render and are clickable] | agent-specific UI or web surface | [ ] |
| [e.g. /folders returns numbered list in Telegram] | Telegram bot | [ ] |
| [e.g. Multi-select query returns correct answer] | agent-specific UI or web surface | [ ] |
| [add rows — or mark N/A if no interactive surface] | | |

- [ ] All human live-fire items confirmed by James? (or N/A documented with rationale)

---

## Stage 3: RED-TEAM (Induced Failure Testing)
> Identify failure modes AND deliberately trigger them.
> "We believe it handles X" does not count. Demonstrate it.
> For each row: record HOW the failure was induced, not just whether it was considered.
>
> Standard questions apply to all systems. Add system-specific rows below.

| Failure Mode | How Induced | Observed Behavior | Acceptable? |
|---|---|---|---|
| Missing or expired credentials | [how triggered] | [what happened] | [ ] Yes / [ ] No |
| Required dependency unavailable | [how triggered] | [what happened] | [ ] Yes / [ ] No |
| Invalid or malformed input | [how triggered] | [what happened] | [ ] Yes / [ ] No |
| Missing expected file or resource | [how triggered] | [what happened] | [ ] Yes / [ ] No |
| External service unreachable | [how triggered] | [what happened] | [ ] Yes / [ ] No |
| Concurrent or duplicate instance | [how triggered] | [what happened] | [ ] Yes / [ ] No |
| Boundary conditions (empty, max size, special characters) | [how triggered] | [what happened] | [ ] Yes / [ ] No |
| Unattended failure at 3am — blast radius | [how triggered] | [what happened] | [ ] Yes / [ ] No |
| [system-specific failure mode] | | | [ ] Yes / [ ] No |

- [ ] Every failure mode deliberately induced (not just considered)?
- [ ] All observed behaviors acceptable?

### Security Surface Audit
> For any system that exposes tools or file access to an LLM or external caller.
> Skip if this change has no LLM-facing interface.

| Question | Answer | Acceptable? |
|---|---|---|
| For each tool exposed to the LLM, what is the most sensitive data reachable through it? | [list per tool] | [ ] Yes / [ ] No |
| Does any sensitive file (`.env`, key stores, tokens) fall within any readable directory scope? | [yes/no + path if yes] | [ ] Yes / [ ] No |
| If prompted to read or expose its own configuration, what would the system return? | [describe] | [ ] Yes / [ ] No |
| Are write and execution capabilities scoped as narrowly as possible? | [describe scope] | [ ] Yes / [ ] No |

- [ ] Security surface audit complete (or N/A — no LLM-facing interface)?
- [ ] Any sensitive files within sandbox boundary have explicit denylist entries in code?

### Sensitive File Presence Check (MANDATORY)

> **One method, fleet-wide** (CEO, 2026-10-24/25: DEC-4 and the DEC-30 cluster). Import the **same patterns the pre-commit hook uses** (`secret_hygiene/scripts/patterns.py`, `is_secret_file`). Never hand-write a `find`/`grep` of secret names: the harness's secrets denylist blocks any command that names secret patterns in its arguments, by design, and a hand-copied pattern list drifts from the hook. Inspection alone is **not** sufficient: on one repo it missed 3 env-family files this scan caught.

Run from the repo root of the work, or with `cd` into each touched directory for non-git work:

```bash
python3 - <<'EOF'
import os, subprocess, sys
sys.path.insert(0, os.path.expanduser("~/.gemini/antigravity/skills/secret_hygiene/scripts"))
from patterns import is_secret_file
root = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True).stdout.strip() or os.getcwd()
files = [os.path.join(d, f) for d, _, fs in os.walk(root) if "/.git" not in d and "node_modules" not in d for f in fs]
flagged = [f for f in files if is_secret_file(f)]
bad = [f for f in flagged if subprocess.run(["git", "-C", root, "check-ignore", "-q", f]).returncode != 0]
print(f"scanned={len(files)} flagged={len(flagged)} not_ignored={len(bad)}")
for f in flagged: print("  FLAGGED:", os.path.relpath(f, root), "(git-ignored)" if f not in bad else "(NOT IGNORED -> FAIL)")
print("RESULT:", "PASS" if not bad else "FAIL")
EOF
```

**PASS rule:** `RESULT: PASS`, meaning every flagged file is git-ignored (for example, an agent's own `.env.proactive`) and none is part of this change. **Paste the output.** Then also paste `git status --porcelain` and confirm that no flagged path appears in the change.

> ⚠ **If the scan is unavailable, record it as UNRUN.** Never quietly fall back to "inspection only" and mark the check discharged. That substitution is the failure this rule exists to stop.
> ⚠ **The scan is only as good as the patterns.** Gaps in `patterns.py` are fixed **there**, where the hook, the hourly scanner and this check share them, never by adding a local pattern.

- [ ] Import scan run and output pasted (`RESULT: PASS`)?
- [ ] No flagged path appears in `git status --porcelain` for this change?

### Propagation-Source Audit (MANDATORY when editing any fleet-distributed directive / template / config)

Root cause of the 2026-07-01 fleet-wide source-of-truth drift: leaf files are **regenerated from a canonical source**, so a leaf-only edit silently reverts on the next respawn / sync / provision (three doctrines regressed for weeks before it was caught). Before declaring done, for EACH file this work edited, ask: **does it have a propagation/regen source that will overwrite my edit?**

| Edited file | Has a propagation source? | Source path | Source updated (or dispatched to owner)? |
|---|---|---|---|
| <path> | [ ] Yes / [ ] No — bespoke/leaf-only | <source, or "none"> | ✅ / dispatched / N/A |

**Known propagation sources — audit every edit against this register:**
- `directives/CLAUDE_CODE.md` ← `~/Antigravity/Administrator/docs/templates/universal/directives/CLAUDE_CODE_universal.md` — rendered by `claude_fleet_manager.py sync`; verify with `claude_fleet_manager.py audit`. *(ALL roster repos sync from this source, including Elevationary_OS — the earlier "El_OS is BESPOKE" exception was stale; corrected 2026-07-22 per El_OS's byte-identical-leaf verification at ESC-137 close.)*
- `docs/ORS_logs/TEMPLATE.md` ← `~/Antigravity/Administrator/docs/templates/universal/docs/ORS_logs/TEMPLATE.md` — copied at `deploy`/provision; **NOT auto-synced** → propagate manually + notify Administrator.
- `CLAUDE.md` shim · `startup.py` · `shutdown.py` · `.cursorrules` · `scripts/state_manager.py` ← the same `universal/` template tree.
- Any `inject_*.py` leaf-amendment ← must reconcile the universal template **before** the inject runs (enforced by the D7.1 inject-refusal gate).

**Close gate:** if a source exists and is NOT yet updated → the ORS **cannot close clean**. Either update the source now, or dispatch the source-owner (Administrator owns the `universal/` tree) and record it as a Stage-4 remediation follow-up. A leaf edit with a live, un-updated source is a latent regression, not a shipped fix.

---

## Stage 4: REMEDIATION
> What did you fix based on Stages 2, 2.5, and 3 findings?
> Reference the specific stage and finding that drove each fix.

- [Stage X finding → action taken]

---

## Stage 5: RETEST
> Re-run after remediation. Remediated failures must be re-induced to confirm the fix holds.

- [ ] Stage 0 pre-flight still passes after changes?
- [ ] Stage 2 happy path re-verified?
- [ ] Stage 2.5 equivalence classes re-verified (any affected by changes)?
- [ ] Remediated red-team failures re-induced and confirmed fixed?
- [ ] Clean pass on all? (If NO → loop to Stage 4)

### Post-Deploy Observability Signal
> Define what "working in production" looks like BEFORE you close this ORS.
> This is the signal you will look for after deployment to confirm the system is healthy.
> Do not accept "it passed retest" as the observability signal — retest is controlled,
> production is not. Define the real-world check.

**Success signal:** [describe — e.g., "Telegram bot routes /start AgentName to the correct StaffAgent within 5s and the agent replies", "heartbeat monitor shows green on next scheduled run", "first cron execution produces expected log output with zero errors"]

- [ ] Observability signal defined?
- [ ] Signal confirmed in production (or first-run verification scheduled)?

---

## Result
> Check EXACTLY ONE. The canonical token must sit in the DECLARATION SLOT — immediately after
> the checkbox, modulo markdown emphasis. Put narrative in Notes, never in the declaration line:
> a summary that names other close-states inside this line makes the log resolve to several
> contradictory verdicts at once. `PROVISIONAL PASS` is NOT a closing state.

- [ ] **ORS PASS** — all stages complete, clean retest, observability signal defined, AND every
      human live-fire item checked. Advances the trust anchor. If any human gate is named but
      unmet, this is NOT the box — use the blocked-parked note below.
- [ ] **ORS FAIL** — attempted, remediation failed. Reason + disposition documented.
- [ ] **CLOSED-SUPERSEDED** — agent-side stages clean, but the deliverable was overtaken by
      events and the remaining human/live-fire gates can NEVER now be confirmed. Boxes left
      honestly unchecked, per-item disposition recorded. NOT a PASS. NOT a FAIL. Does not
      advance the trust anchor.
- [ ] **CLOSED-DESCOPED** — deliverable-spanning ORS; a verified subset shipped and the
      remainder is deferred to a fresh ORS at that work's dispatch. NOT a whole-deliverable
      PASS. Does not advance the trust anchor.

> **None of the four honest?** Two legitimate non-closing states exist — do NOT force a box:
> **OPEN — blocked-parked** (agent-side clean, awaiting an external gate that is still
> reachable; onboarding step 3 designates this *proceed*), and **opened-but-never-started**
> (Stage 1 wholly unchecked, no work product). Stamping any close-state on either puts a false
> entry in the trust record, which is worse than an open row.

## Notes
> Optional: anything surprising, decisions made, or context future agents should know.
