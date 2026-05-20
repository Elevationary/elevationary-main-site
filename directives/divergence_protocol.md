# Divergence Protocol

## Definition
A **divergence** is any intentional deviation from a fleet standard, directive, or established pattern. This includes but is not limited to:
- Using a non-standard file structure or naming convention
- Skipping a mandatory step in a workflow (e.g., ORS stages)
- Implementing a pattern that contradicts an existing directive
- Operating with a different tool/dependency than fleet standard

## Classification

| Level | Scope | Example | Approval |
|-------|-------|---------|----------|
| **L1 — Trivial** | Single task, no downstream impact | Agent uses a scratch script instead of the standard skill | Self-documented, no approval needed |
| **L2 — Tactical** | Session-scoped, reversible | Skipping ORS Red-Team for a hotfix | Agent logs reason in SESSION_LOG, notifies user |
| **L3 — Strategic** | Persistent change to agent behavior | Client agent uses non-standard invoice format | Requires user approval before implementation |
| **L4 — Architectural** | Fleet-wide implications | Changing the memory stack protocol | Requires Administrator + Business Leader approval |

## Workflow

1. **Identify** — Agent detects that planned action deviates from a standard.
2. **Classify** — Agent assigns a divergence level (L1–L4).
3. **Document** — Agent records: what, why, scope, and expected duration.
4. **Approve** — L1: self-approve. L2: log + notify. L3-L4: halt and request approval.
5. **Execute** — Proceed with divergence after approval.
6. **Review** — On session close, check if divergence should become a fleet standard or be reverted.

## Documentation Requirements
All L2+ divergences must be recorded in the agent's `docs/SESSION_LOG.md` with:
- Divergence level
- Reason for deviation
- Expected duration (temporary vs permanent)
- Impact assessment

## Escalation
If a divergence causes a downstream failure in another agent or system:
1. Immediately revert to standard behavior
2. Log a Fleet Lesson via `ingest_memory.py --agent FLEET`
3. Notify the Administrator via Telegram
