# Walkthrough — [Feature/Fix Name]

**Date:** YYYY-MM-DD | **Agent:** [Agent Name] | **Session:** [Session ID]
**ORS:** [link to companion ORS log]
**Plan (if any):** [link to plan file or "ad-hoc"]
**Conversation reference:** [same anchor as ORS — Claude Code session timestamp]

> Walkthroughs capture the *why* and *what changed*, not the *what* (code lives in git, output lives in ORS). Required at every ORS PASS per `directives/CLAUDE_CODE.md`.

---

## What was built

> One to three paragraphs. The feature/fix in plain language. Who consumes it. What it replaces (if anything). Mention every file path of consequence so a future agent can trace the change without re-reading the ORS.

## Decision rationale

> Tabular form forces honest tradeoff capture — free prose lets the author hide alternatives they dismissed quickly.

| Decision point | Options considered | Chosen | Reason |
|---|---|---|---|
| [e.g. State file location] | [A: gateway/state/, B: ~/Antigravity_Data/<Agent>/staff_agent_runtime/, C: agent repo .hidden] | [B] | [Per-agent state follows the agent; scales to other StaffAgents; CEO-directed 2026-05-29] |
| [add rows for every meaningful fork in the road] | | | |

## Surprises

> What didn't go as expected during build or live-fire. Include fleet-impact column — a surprise that only affects this agent stays here; one that would bite other agents needs a Layer 3 fleet lesson.

| Surprise | What you expected | What happened | Fleet impact? |
|---|---|---|---|
| [e.g. wait_startup 15s timeout flaked on respawn] | [Clean spawn after rollover] | [Claude Code didn't reach Bypass dialog in 15s — twice — supervisor's 60s tick respawned successfully] | [None — supervisor self-heal absorbs] |
| [add rows] | | | |

## Fleet lessons surfaced

> Items going to Layer 3 via `scripts/ingest_memory.py --agent FLEET`. Each lesson is a behavioral change for *any* agent, not just this one. Include the slug used for ingestion.

| Lesson slug (L3) | One-line rule | Why it matters |
|---|---|---|
| [e.g. `fleet_lesson_doctrine_needs_code_enforcement`] | [Doctrine memories must land with a code path that enforces them — otherwise they decay silently.] | [bot_is_pager doctrine was violated by Telegram bot's auto-session for weeks; only discovered when StaffAgent went live.] |
| [add rows or "none surfaced this session"] | | |

## Updated docs

> Every artifact this session produced or modified — makes the L4 vault chain explicit. Include vault destination so future-recall via `memory_router` can trace authorship.

| Document | Path | Vault destination | Status |
|---|---|---|---|
| ORS log | docs/ORS_logs/ORS_<feature>_<YYYY_MM_DD>.md | ors-logs | [ ] Committed [ ] Vaulted |
| Walkthrough (this file) | docs/walkthrough_<YYYY_MM_DD>_<feature>.md | walkthroughs | [ ] Committed [ ] Vaulted |
| Plan (if any) | docs/plan_<feature>_<YYYY_MM_DD>.md OR ~/.claude/plans/<slug>.md | directives | [ ] Committed [ ] Vaulted |
| Spec amendment (if any) | docs/<spec>.md | directives | [ ] Committed [ ] Vaulted |
| Fleet lesson 1 | .tmp/fleet_lesson_<slug>.md | Layer 3 only (no vault) | [ ] Ingested |
| [add more rows] | | | |

## Metrics

> Light-touch operational signal. Tokens deferred until cost-probe (task 20d) gives a measurement mechanism.

| Metric | Value |
|---|---|
| TimeKeeper duration (this session) | [HH:MM — read from `time_keeper.py` log] |
| Build iterations | [count of meaningful build-test-rebuild cycles] |
| Bugs surfaced + fixed inline (Stage 4) | [count] |
| Bugs filed as follow-ups | [count + brief list] |
| Real-PTY / live-fire spawns consumed | [count if applicable — Anthropic plan accounting] |

## Verification chain at close

> Concrete artifacts proving the work landed end-to-end. Cite logs, file checksums, recall verification, CEO-confirmed live-fire items. Avoid prose — bullets are enough.

- [e.g. `staff_agent_supervisor.py` written + py_compile clean]
- [e.g. Mock-PTY regression `--mock-pty --max-iterations 3` clean]
- [e.g. CEO live-fire 8/8 PASS — Telegram screenshots in conversation reference]
- [add bullets — one per verification anchor]

ORS PASS declared. [Project/phase] at [N of M tasks] complete. [Optional: what's next.]
