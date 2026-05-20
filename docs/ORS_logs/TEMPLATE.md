# ORS Log: [Feature/Fix Name]
**Date:** YYYY-MM-DD | **Agent:** [Agent Name] | **Session:** [Session ID]

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
| [e.g. Sidebar checkboxes render and are clickable] | ElevatorLM UI | [ ] |
| [e.g. /folders returns numbered list in Telegram] | Telegram bot | [ ] |
| [e.g. Multi-select query returns correct answer] | ElevatorLM UI | [ ] |
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

### Sensitive File Presence Check
> Run regardless of whether an LLM interface exists. Sensitive files must not be present in any agent repo directory.

```
# Run from the agent repo root to check for sensitive files:
find . -name ".env" -o -name "*.env" -o -name "*.pem" -o -name "*.key" \
  -o -name "*.p12" -o -name "*.pfx" -o -name "credentials.json" \
  -o -name "service_account*.json" -o -name "secrets.*" \
  | grep -v ".git"
```

- [ ] Command run and output reviewed?
- [ ] Zero sensitive files found in the repo directory? (If any found → remove or relocate before proceeding)

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

**Success signal:** [describe — e.g., "Elevator responds to /start AgentName within 5s", "heartbeat monitor shows green on next scheduled run", "first cron execution produces expected log output with zero errors"]

- [ ] Observability signal defined?
- [ ] Signal confirmed in production (or first-run verification scheduled)?

---

## Result
- [ ] **ORS PASS** — all stages complete, clean retest, observability signal defined
- [ ] **ORS FAIL** — requires additional remediation

## Notes
> Optional: anything surprising, decisions made, or context future agents should know.
