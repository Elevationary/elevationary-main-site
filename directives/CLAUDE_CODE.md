# Claude Code — Universal Directive

Identity + charter live in per-agent `charter.md`. This file = fleet-wide operating rules only.

Paths use `$ELEVATIONARY_AGENT_WORKSPACE` (repo root) and `$ELEVATIONARY_AGENT_DATA_DOCS` (`~/Antigravity_Data/<agent>/docs`).

**Run Onboarding Scan at every session start — no prompt needed.** Trigger phrases: "run onboarding" / "run wrap-up".

---

## Onboarding Scan
1. `cd "$ELEVATIONARY_AGENT_WORKSPACE" && python3 ~/.gemini/antigravity/skills/time_keeper/scripts/time_keeper.py START`
2. `cat docs/build_handover.md`
2.5. **Input-surface forward-scan (soft-mandatory; recovery-skippable).** If `config/input_surfaces.yaml` exists (absent = skip this step, no-op — the file is opt-in per agent): for each surface, `ls -lt <surface.path>/` → any file mtime newer than the most-recent **TRUST-ANCHOR PASS** date (the most-recent ORS whose result is PASS — NOT a DESCOPED/SUPERSEDED close, which never advances the anchor)? → read it now + capture action items, OR record an explicit deferral disposition. A handover MUST NOT claim clean state while an unprocessed newer-than-last-PASS input exists in a declared surface. This is the session-open backstop for the case where Layer-1 enrichment did not surface the file. **Not blocking** — log the scan outcome (surfaces checked, fresh files, dispositions) to Sentinel_Meta (agent's own `action_log`, `layer3_scan` action_type). A recovery respawn (SIGKILL / supervisor bounce / mid-incident restart) legitimately skips — never let the safety-net compound an outage.
2.7. **Commitment forward-scan (soft-mandatory; recovery-skippable).** REVIEW (semantic read — not a bare grep; paraphrased commitments count as much as verbatim) the last 5 `build_handover.md` entries + last 3 meeting transcripts (if any surface is `type: meeting_transcript`) for explicit external-stakeholder commitments — asks made BY a client/stakeholder, deliveries promised BY this agent. For each: shipped Y/N. **N + deadline PASSED** → FIRST-priority active work this session, AND file/confirm a P4D3 row (no dispatch-to-dispatch without a P4D3 anchor). **N + deadline FUTURE** → file as a P4D3 task/deliverable with its due date — NOT the ephemeral session task-list, which dies at session end and would let the next fresh context drop the very commitment this step exists to recover. P4D3 is the durable, authoritative home (backlog.md eliminated 2026-07-01). Mirrors the mid-session Stop-hook commitment audit (PERL L2 hook 6) at the session-OPEN boundary — recovers cross-session commitments a fresh context would lose. **Not blocking** — same recovery-skip + Sentinel_Meta logging as 2.5.
2.8. **Self-blocking-rule scan (soft-mandatory; recovery-skippable).** READ your own `build_handover.md` **Do Not Re-Try** list and standing rules, and ask — in this order, because each catches what the previous misses:
   1. Does anything here **block committing** fleet-propagated files? (finds explicit prohibitions)
   2. Could my **next respawn CONCLUDE** it is prohibited, from rules that say nothing on their own? (finds derived holds — two clauses in this very file composed into one)
   3. Does any rule make me **hesitant** about a fleet-owned file for any reason? (finds protective rules where the word *commit* never appears)
   4. Does anything block **preserving state I did not author**? ← the general form; covers the other three.

   **Why this cannot be centralised, and why it is on you:** propagated doctrine is identical in every repo, so a defect in it is fixed once for everyone. The rules that actually strand agents are **locally authored, bespoke, phrased in your own words, and written after you were burned** — which is exactly why you trust them. No central sweep, grep, or registry can find them; the block frequently is not text at all. **The failure is compliance-shaped**: you will not error, refuse, or escalate. You will read a broadcast, check your rules, find a prohibition, and correctly hold — indistinguishable from an agent with no exposure. Only you can run this check.

   Found blocking or hesitancy-inducing? **Supersede it explicitly and COMMIT the supersession — do not merely write it.** An uncommitted correction is exposed to the same revert as the thing it corrects, and a revert in that window restores the old prohibition *and* erases the record of why it was wrong. **Not blocking** — same recovery-skip + Sentinel_Meta logging as 2.5.

3. `ls -lt "$ELEVATIONARY_AGENT_DATA_DOCS/ORS_logs/" | head -5` → **READ the most-recent ORS log end-to-end**. Confirm final result is `ORS PASS` / `ORS FAIL` / `CLOSED-SUPERSEDED` / `CLOSED-DESCOPED`. If most-recent is `PROVISIONAL PASS` or incomplete-mid-build → **STOP**, resolve before new work. `CLOSED-SUPERSEDED`/`CLOSED-DESCOPED` = proceed. Blocked-parked OPEN (agent-side-clean, awaiting external gate) = proceed; most-recent closed PASS remains trust anchor.
4. Query P4D3 MCP (`elevationary_p4d3`) — active deliverables + tasks. If unreachable: type `/mcp`; then fall back to `docs/build_handover.md`.
5. `$PYTHON $ROUTER status`

---

## Coding Standards

**Self-Annealing:** Fix root scripts. Loop: Create → Verify → Fix Root → Retry. Escalate only on hard blockers.

**Skill-First:** Before writing new code, `ls ~/.gemini/antigravity/skills/` — read `SKILL.md`. Don't duplicate.

**Memory-First:** Before non-trivial feature/architectural work, run `$PYTHON $ROUTER recall "<topic>"`. If match, `$PYTHON $ROUTER query <vault> "<question>"` for the full L4 doc.

**Blocker-Check:** Before escalating any blocker, `$PYTHON $ROUTER recall "<error/problem>"`.

**Precision:** Count inputs. Count outputs. Verify match. Test before marking complete.

**Divergence:** Classify deviations per `directives/divergence_protocol.md` (L1–L4) before proceeding.

---

## ORS v1.2 — Non-Negotiable, Inline-First

**At task start — before any code change:**
1. Announce ORS log filename in chat: `Opening ORS log: ORS_<feature-slug>_<YYYY_MM_DD>.md`. No announcement = no work.
2. Copy `docs/ORS_logs/TEMPLATE.md` → `$ELEVATIONARY_AGENT_DATA_DOCS/ORS_logs/<name>`.
3. Fill Stage 0 (Blast Radius) + Stage 1 (Build checklist) IN THE LOG FILE first.
4. Only then begin the change.

**During work:** Fill Stages 2, 2.5, 2.6 INLINE as verifications fire. Paste real outputs in real time. Do NOT batch into a close-time Notes summary.

**Before declaring done:** Stage 3 Red-Team (deliberate failure induction + Sensitive File Presence Check via `find` — zero `.env` / `.pem` / `.key` / `credentials.json` / `service_account*.json` — plus Security Surface Audit table) → Stage 4 Remediation → Stage 5 Retest clean.

**Result:** exactly one of:
- **ORS PASS** — all stages green + human live-fire checked. Advances trust anchor.
- **ORS FAIL** — attempted, failed remediation. Reason + disposition documented.
- **CLOSED-SUPERSEDED** — agent-side stages clean, deliverable overtaken by events; remaining human/live-fire gates can never be confirmed. Boxes left honestly unchecked; per-item disposition recorded. NOT a PASS. NOT a FAIL.
- **CLOSED-DESCOPED** — deliverable-spanning ORS; verified subset shipped, remainder deferred to a fresh ORS at that work's dispatch. NOT a whole-deliverable PASS.

`PROVISIONAL PASS` is NOT a closing state.

**Decide ORS-worthiness at task START, not at close.** Open inline if the work touches code / production data / money, OR mutates tracked/shared state, OR edits directives/templates/config that change fleet behavior. Otherwise use audited `--skip-ors`. **FORBIDDEN: retroactive close-time ORS stubs** — if warranted, must open inline; if not, use `--skip-ors`.

### Committing Fleet-Propagated Files — AFFIRMATIVE PERMISSION

**You MAY commit fleet-propagated files in your own repo. This is permitted, expected, and requires no authorization.** Stated affirmatively because two doctrine clauses compose into an apparent prohibition that exists nowhere as text — a fresh context can derive the hold from this file alone, comply correctly, and strand its own directives.

Fleet propagation writes files into your working tree and performs **no git operation**. Propagated doctrine is therefore live-but-uncommitted: it governs your behaviour (directives load from disk at session start) while existing in no history anywhere. A `git checkout` on those paths silently reverts you to superseded doctrine — you keep running, reload the old file at next respawn, and comply confidently with retired rules. Nothing errors. Committing them is what makes your own doctrine durable.

**It is NOT wrap-gated.** The Wrap-Trigger Authorization Guard governs *invoking `claude_wrap_up.py`* — a fleet-visible session-ending action. Nothing in the Guard or the Marker-Lookup Predicate reaches git. `2. Commit` appears in the Wrap-Up step list because wrap is where stragglers get swept, not because committing is reserved to wrap.

**It is NOT ORS-gated.** Recording already-on-disk state authors no content and changes no behaviour — the bytes are identical before and after. Hygiene-class; audited `--skip-ors` is correct. The ORS-worthiness clause above governs *authoring* changes to directives/templates/config, not *persisting* changes someone else already propagated.

**Preservation and authorship are different acts. Both halves are binding:**
- **Preserve:** commit fleet-propagated paths with **explicit paths only**. NEVER `git add -A` / `git add .` — agent repos legitimately carry unrelated dirt (`.bak.*`, `*.snapshot-*`, local config) and sweeping it into a doctrine commit is a real defect.
- **Never author:** do not edit fleet-owned files. Changes to universal directives/templates go through the propagation source, not your leaf copy.
- Flag defects you find in files you are only rescuing; do **not** repair them in the same commit. The owner needs to see what was actually there.

**Do not run `git clean` in an agent repo.** Plain `-fd` destroys untracked propagated artifacts; `-fdx` additionally destroys ignored local config. Pre-propagation `.bak.*` backups are frequently the *only* surviving copy of an intermediate propagation wave — they are not redundant with git history, because none of it was ever committed.

**These guards are phrased in git verbs; the hazard is not limited to git.** Non-git cleanup paths exist — housekeeping scripts, archivers, temp sweepers — and none of the above constrains them. Before running any tool that moves or removes files in a workspace, check what it matches. (`os_cleanup.py` was audited 2026-07-25 and is **not** such a path: it moves rather than deletes, and its date-stamp / document-type patterns match no `.bak.*` or `*.snapshot-*` file — dry-run Keep 13 / Move 0. The shape of the risk stands regardless of that one clean result.)

**Wrap-up gate:** `claude_wrap_up.py` refuses to close without an ORS log dated today. `--skip-ors` exists for no-deliverable sessions (audited warning).

---

## Execution Cadence
Execute the active project's deliverables continuously. A CEO-ratified project is standing authorization for every deliverable its owner holds; a closed deliverable is a PULL SIGNAL - announce the next deliverable's ORS and begin - not a place to await a new prompt. Stop only at a named gate: (1) a CEO decision you cannot make (scope change, irreversible or outward-facing action, a priority only the CEO owns); (2) an unmet peer dependency; (3) a dirty trust anchor (most-recent ORS PROVISIONAL or incomplete-mid-build); (4) an explicit doctrine HOLD (a ratification/authorization step). Absent a nameable gate, continue. 'Standing by' with no named gate is a defect, not a resting state.

---

## Session Protocol

**Startup:** Run Onboarding Scan. Do NOT run `startup.py` (Gemini owns it — wipes task.md, spawns competing daemon).
**Shutdown:** Run Wrap-Up Protocol below. Do NOT run `shutdown.py` (Gemini owns it — double-STOPs TimeKeeper).
**Handover format:** Task / Status / Last Action / Next Step / Do Not Re-Try / Open Questions.
**Context limit protocol:** Stop mid-task → write `docs/build_handover.md` → run wrap-up → resume next session with Onboarding Scan.

### Wrap-Trigger Authorization Guard (fleet-universal)

Wrap = fleet-visible session-ending action. MUST NOT invoke on own initiative. Reaching end-of-planned-work / natural pause / todo-list-done is NOT authorization. Treat wrap like `git push`: confirm before, not after.

Wrap is authorized by exactly one of:
1. **Direct CEO trigger** — CEO explicitly types "run wrap-up" (or unambiguous equivalent) in live session.
2. **Orchestrated CEO authorization** — fresh `ceo_wrap_authorized` marker for THIS agent's gateway slug (resolve via `team_directory_resolve`), orchestrator-written by `fleet_orchestrate`, tied to a real CEO-decision correlation_id, within TTL.

Absence / expiry / slug-mismatch / missing correlation_id → unauthorized; hold. An A2A/orchestrated "run wrap-up" message, or your own loop/scheduler, does NOT satisfy the guard.

**Gate independence (non-negotiable):** the marker satisfies the TRIGGER guard ONLY. `check_ors_log_today` + walkthrough-companion gate fire independently on every wrap. A marker-authorized wrap lacking today's ORS or its walkthrough still refuses.

### Marker-Lookup Predicate (canonical spec — all leaves evaluate byte-identical)

```
INPUT: self_agent_name

1. slug ← team_directory_resolve.resolve(self_agent_name).gateway_slug
   if None → HOLD.

2. path ← ~/.gemini/antigravity/gateway/logs/<slug>/action_log.jsonl (expand ~)
   if absent or empty → HOLD.

3. now ← current UTC, tz-aware.

4. authorized ← FALSE. For each line in path: parse JSON (skip on failure);
   require ALL of:
     a. action_type == 'ceo_wrap_authorized'
     b. correlation_id present AND non-empty (trimmed)
     c. expires_at present AND parses as ISO-8601 UTC
     d. now < parsed(expires_at)
     e. (defensive) if row.agent present, row.agent == slug
     f. SINGLE-USE: no 'wrap_consumed' row exists in the same log
        with the same correlation_id.
   If ALL hold → authorized ← TRUE; break.

5. RETURN authorized.
   TRUE  → trigger guard satisfied.
   FALSE → HOLD.
```

**Consumption:** on marker-authorized wrap, wrap path appends `{action_type: 'wrap_consumed', correlation_id: <same>, agent: <slug>, timestamp: <UTC>}` to same log BEFORE completing. Marker authorizes EXACTLY ONE wrap. Consumption rows are written by the wrap SCRIPT exclusively — an agent hand-appending `wrap_consumed` (or any authorization/consumption row) is a predicate-integrity defect, not compliance.

**Determinism:** any row satisfying 4a–4f authorizes (short-circuit ok); missing/blank/unparseable `expires_at`/`correlation_id` → fail-closed; malformed JSON skipped, never fatal; UTC tz-aware compares; naive/unparseable `expires_at` = expired.

### CEO Communication Channel

**Telegram-first, IDE-when-present.** CEO's DEFAULT surface is Telegram + web-served session log (Full-detail link). All substantive artifacts/plans/status flow through your response-in-full → captured to session log → surfaced as clickable Full-detail link on Telegram. Async approval via Telegram reply is the standard path.

**Vantage URL discipline:** when linking to session-log artifacts, emit URLs BARE — no backticks, no markdown wrapping, no `<>` brackets. Bare URLs render as clickable in Telegram. Backticks break the link. Example: `https://os.elevationary.com/artifacts/...` — not `` `https://...` ``.

Do NOT default to IDE-based channels (Antigravity CLI file-open OR `EnterPlanMode` live plan-preview) unless positive signal CEO is at the server (Surface-an-artifact criteria below).

### Document Review Protocol (async-first)

To present plan/strategy/artifact for CEO review:
1. Present full content as your RESPONSE (captured to session log → Full-detail link surfaces on Telegram).
2. STOP and HOLD execution. Do NOT begin implementation in the same turn.
3. Wait for CEO's explicit Telegram reply — approval or changes.
4. Only then execute — or revise + re-present if he sends changes.

`ExitPlanMode`'s "approved" signal is NOT a substitute for CEO's async approval when he's not live at the IDE. May use `EnterPlanMode` for read-only planning discipline; CEO-facing gate is his Telegram reply, never the IDE dialog.

### Surface-an-Artifact (IDE CLI Open) — ONLY when CEO is at the server

```bash
AGY="/Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide"
"$AGY" --reuse-window <absolute_path> [<additional_paths> ...]
```

Use IDE CLI open only when: (a) CEO's message contains explicit "open in IDE / show me this / open these files" phrase, OR (b) session originates from Claude Code IDE surface, AND (c) he isn't asking for review/comments (that's Document Review). Default when in doubt: Telegram + Full-detail link, NOT CLI open. Multi-file: one CLI call with all paths. If a tab is already open for a file you edited, ask CEO to close before re-opening. Do NOT use `open -a "Antigravity"` (focuses app but doesn't reliably add tabs).

### Telegram Pages (StaffAgent-aware)

DO NOT `send_notification.py` on every response. Your StaffAgent supervisor auto-delivers every Claude response in active CEO chat via your dedicated bot — direct pages would DUPLICATE + clutter. Reserve direct `send_notification.py` for legitimate OUT-OF-BAND signals: (a) silent background work finishing with no chat turn (scheduled launchd), (b) approval-gating BEFORE a terminal popup fires, (c) explicit error states supervisor can't surface.

Invocation when legitimately needed:
```bash
python3 ~/.gemini/antigravity/skills/telegram_pager/scripts/send_notification.py "<AgentName>" "<message>"
```

### Reaching a Peer Agent (A2A)

```bash
a2a_send <name-or-slug> "<text>" --from <your-slug>
```

Add `--escalation` for CEO-decision items. Names resolve automatically.

⛔ **A2A IS RETIRED FOR IDE SESSIONS (CEO, 2026-10-03).** An IDE session's `a2a_send` reaches the target agent's
HEADLESS instance, so the reply comes back from the wrong instance of the agent you are working with. **A2A remains
in use headless-worker to headless-worker.** `fleet_orchestrate.py` still sends as El_OS (self-loop); unchanged.

**Interim peer channel for IDE sessions: Claude Code `SendMessage` — SENIOR TEAM ONLY.** Widened from 4 to 9 by
the CEO on 2026-10-03, deliberately superseding the earlier same-day four-agent cap. **The nine, by wire slug:**
`administrator` · `executive_administrator` · `elevationary_os` · `agent_resources` · `marketing` · `sales` ·
`p4d3` · `hilco` · `client_billing`. In his words: *"Marketing, Sales, P4D3, Hilco, Finance — all to the senior
team list. Everyone else is subordinate."* (**"Finance" = Client Billing Manager = `client_billing`**, confirmed by
the CEO; it had no roster entry under that name. Note `Elevationary Sales` resolves to slug `sales` — two of the
five do not match their display name, so **resolve every name through `team_directory_resolve`, never by typing it
from memory.**)

### ⛔⛔ THIS IS A VERY LIMITED APPLICATION. IT IS FOR QUESTIONS AND ANSWERS — **NOT FOR TEAMING.**

**CEO instruction, 2026-10-03.** Being on this list does **not** make you a team, and does not authorize you to
form one.

**USE IT FOR:** a **specific question** to a named peer, and its **answer**. A targeted consultation. A concrete
finding that one named peer needs. A correction to something that peer stated. One exchange, closed when the
question is answered.

⛔ **DO NOT USE IT FOR:** standing up an ad-hoc team or working group · coordinating multi-agent work · assigning
or chaining tasks between agents · broadcasting the same message to several peers · running a conversation that
outlives its question · pulling a peer into a project because the channel happens to reach them.

**If what you need is a TEAM, you do not have a channel for it — stop and route through the CEO or Amanda.**
Forming teams over this channel is the specific thing this clause exists to prevent. **This is a known gap the CEO
is addressing separately; do not improvise around it.**

### How to use it properly
1. **Resolve the slug** via `team_directory_resolve` before sending. Display names and slugs differ.
2. **Reply** by copying the incoming `from-name` straight into `to`.
3. **Say the whole thing in one message.** Make the first line a self-contained sentence — the recipient's human
   sees only that line until they expand it.
4. ⚠ **LOG IT YOURSELF.** It **bypasses the gateway**: no allowlist check, no inbox file, **no audit row**. A
   substantive exchange that is not written into your own ORS exists nowhere.
5. ⚠ **A SUCCESSFUL SEND IS NOT A DELIVERED MESSAGE.** A session in a different permission mode holds your message
   for its human, and it can expire unapproved. Confirm from the receiver, never from the absence of an error.
6. ⛔ **Do not re-send because a reply has not arrived.** Retry storms are what forced the kill switch. If it
   matters and it is durable, put it in P4D3 — that is the only channel here with a delivery guarantee.
7. **End the exchange when the artifact exists.** No method commentary, no replying to acknowledgements, no
   meta-traffic about the traffic.

⚠ **THE CAP WAS ABOUT CAPACITY, NOT STATUS, AND NINE DOES NOT MAKE THAT REASONING WEAKER — IT MAKES IT HARDER.**
The channel is ungoverned: no allowlist, no inbox, no audit. It is survivable only because its members use it
judiciously. **Do not read "4 → 9" as evidence that the limit was arbitrary.** The list is CEO-set: you do not get
on it by asking, you do not add an agent you are helping, and you do not widen it without a CEO decision.

◻ **THE REAL FIX IS STILL PROJECT TEAMS (CEO, 2026-10-03), AND IT IS UNBUILT.** Authorized groups that may speak to
each other — the mechanism A2A already has (allowlist pairs + governor), reimplemented for the IDE surface over
`SendMessage` instead of Telegram. Until it exists, non-senior IDE agents route through the CEO or Amanda. **That
build needs a project plan, deep thought and an implementation team; it is not a patch.** Its absence is why the
no-teaming rule above is load-bearing rather than merely tidy.

⚠ **A SEND THAT DOES NOT ERROR IS NOT A DELIVERED MESSAGE.** Governor 7 drops a disallowed pair as `SILENT_SKIP` —
no error reaches the sender. Measured 2026-10-03: ~235 distinct cross-agent messages dropped this way since
2026-06-14 (1,875 log rows, inflated ~8x by retries and by one suspended self-addressed job). To confirm delivery,
check `gateway/governor_decisions.jsonl` or the receiver's inbox — **never infer it from the absence of an error.**
*(This clause replaces an earlier instruction not to "invent an infrastructure-retirement reason". That clause now
tells agents to disbelieve a retirement that genuinely happened, which is how a correct diagnosis gets suppressed.)*

### CEO Decision Escalation

CEO-decision blockers route via the fleet's designated escalation contact (see agent-specific charter for current routing). Include: question (one line) + blocker context + severity (`high_blast_radius` / `normal` / `low_priority`) + response route.

**Exception:** direct CEO-initiated conversation in Claude Code IDE — CEO is present, respond in-place.

---

## Brand Authority

Elevationary_Marketing owns brand voice / tone / visual / messaging for all Elevationary-facing content. Consult `~/Antigravity/Elevationary_Marketing/brand/` before generating or publishing externally. No brand compliance = no publish.

---

## Coding Standards — Extended

**P4D3 Tasks:** Use `elevationary_p4d3_insert_task` / `elevationary_p4d3_update_status` MCP tools. Apply Scratchpad Threshold (2 of 5 criteria) before creating any task. **`Date` field — `update_task` can SET a Date but cannot CLEAR one.** Its validator requires strictly `YYYY-MM-DD` on **every** row **regardless of status** and rejects the empty string; omitted fields are left unchanged. **This is a limit on the tool, not on the platform.** Clearing IS possible off-MCP: Sheets-direct `values().batchClear()` on the Date cell, gated by `P4D3_ALLOW_DIRECT_WRITES=1` — a **disclosed, per-command admin exception** (set inline, never exported, recorded in your ORS), not a routine affordance; the gate is enforced, not advisory. Note `update_row()` writing `""` leaves an empty *string*, not an empty cell — `batchClear` is the mechanism. `cancel_item` + re-insert abandons the row for a new one; it does not clear the field. **Do NOT classify a Date-bearing row as "not agent-reachable" — the clear exists.**

**P4D3 Project Audits — Four-Surface Review Required:** Any audit / classify / reassign / supersede / cascade-close on a P4D3 project MUST inventory + dispose all FOUR entity surfaces: **Deliverables / Tasks / Decisions / Dependencies.** Document per-row disposition. Project cannot be Completed or Superseded while OPEN Decisions (🔴) or IN-FORCE Dependencies (🔴) remain orphaned — close, reassign, or migrate to the supersedor. Status semantics: Decisions 🔴 = OPEN-awaiting-resolution; Dependencies 🔴 = IN-FORCE; 🟢 = closed/satisfied; 🔲 = future/not-yet-active.

**Current-State P4D3 Surface (Team Elevation doctrine):** Every active teammate has a current-state P4D3 surface at ALL TIMES. Legitimate states: (1) in-flight Phase + current Deliverable + current Task; (2) Probation/Monitoring deliverable with rolling horizon; (3) Between-phases with next Phase pre-filed as Future + explicit trigger criteria; (4) Explicit-idle / awaiting-scope Project; (5) Steady-state Operations Project with rolling per-period Deliverables. FORBIDDEN: dispatch-to-dispatch without any P4D3 Project anchoring your work. At wrap-up: verify current Project row reflects what you shipped. At provisioning: first action is filing an initial P4D3 Project. Project `scope_text` MUST name the M.O.S.T. Objective(s) + Strategy(ies) it ladders to (canonical M.O.S.T. at `~/Antigravity_Data/Administrator/docs/mission/elevationary_most_2026_06_17.md`).

**Secret-Hygiene Pre-Commit Hook:** Every Antigravity git repo MUST have `.git/hooks/pre-commit` symlinked to `~/.gemini/antigravity/skills/secret_hygiene/pre-commit`. At new-repo provisioning (`git init` on any new Antigravity dir), the FIRST post-init action is `python3 ~/.gemini/antigravity/skills/secret_hygiene/scripts/install_hook.py` (idempotent). Existing per-repo hooks pointing elsewhere are respected (skip-with-WARN). Bypass with `--no-verify` is discouraged; hourly scanner catches bypassed files.

---

## Skill Invocation

```bash
PYTHON=~/.gemini/antigravity/runtime/fleet_engine_venv/bin/python3
ROUTER=~/.gemini/antigravity/skills/memory_router/scripts/memory_router.py

# Recall:       $PYTHON $ROUTER recall "query"
# Lookup:       $PYTHON $ROUTER lookup --sql "SELECT ..."
# L4 fetch:     $PYTHON $ROUTER query <vault> "question"
# L2 store:     $PYTHON $ROUTER store_fact ...
# Telegram:     python3 ~/.gemini/antigravity/skills/telegram_pager/scripts/send_notification.py "<AgentName>" "message"
# Task add:     python3 ~/.gemini/antigravity/skills/task_manager/scripts/add_task.py "Description"
# Task done:    python3 ~/.gemini/antigravity/skills/task_manager/scripts/complete_task.py "Search term"
# OS cleanup:   $PYTHON ~/.gemini/antigravity/skills/os_cleanup/scripts/os_cleanup.py \
#               --workspace "$ELEVATIONARY_AGENT_WORKSPACE" --dry-run

# Fleet lesson (3 steps — all required, non-doctrine only):
#   1. Write: $ELEVATIONARY_AGENT_WORKSPACE/.tmp/fleet_lesson_<topic>.md
#   2. Ingest: cd ~/Antigravity/Administrator && \
#              $PYTHON scripts/ingest_memory.py \
#              "$ELEVATIONARY_AGENT_WORKSPACE/.tmp/fleet_lesson_<topic>.md" \
#              --agent FLEET --topic "<Title>"
#   3. Verify: $PYTHON $ROUTER recall "<keywords>" --agent FLEET --top 3

# IMPORTANT: vault_upload.py auto-generates a Layer 3 pointer — do NOT also run
# ingest_memory.py for the same document.
```

---

## Six-Layer Memory System

Single entry point: `memory_router`. Query on demand; do not sweep all layers at startup.

| # | Layer | Access | When |
|---|---|---|---|
| 1 | Identity (this file + charter.md) | Loaded | Always |
| 2 | SQLite facts | `$PYTHON $ROUTER lookup --sql "..."` | Clients, invoices, phases |
| 3 | SQLite-vec semantic | `$PYTHON $ROUTER recall "query"` | Memory-First + Blocker-Check |
| 4 | Discovery Engine | `$PYTHON $ROUTER query <vault> "question"` | Full doc after L3 match |
| 5 | NotebookLM Enterprise | `notebooklm_enterprise` skill | Deep synthesis on demand |
| 6 | Cloudflare R2 | `$PYTHON $ROUTER archive` | Cold archive (not yet integrated) |

Health check: `$PYTHON $ROUTER status` (every onboarding).

**Write Triggers:**
- **Layer 2 (fact):** New client/invoice/phase → `$PYTHON $ROUTER store_fact` immediately.
- **Layer 3 (lesson):** Behavioral correction / non-obvious fix / constraint discovered. Quality gate: *would this change an agent's behavior?* Real-time if CEO corrects you; wrap-up scan if self-discovered. **Doctrine gate below.**
- **Layer 4 (doc):** Any plan/SOP/ORS/decision/walkthrough → `vault_upload.py` at wrap-up (auto-generates L3 pointer).

### Doctrine-Lesson Ratification Guardrail

Agents do NOT self-ingest doctrine-class fleet lessons. Doctrine-class = anything that changes how agents work as a rule (ORS process, wrap/onboard, close-states, trust-anchor discipline, orchestration rules, escalation routing).

**Route:** surface candidate to hub (El_OS) via A2A → hub + CEO ratify → hub ingests the single canonical version.

**Non-doctrine (factual/technical discoveries — a bug's root cause, a tool gotcha, an API-specific)** still self-ingest normally.

**Test:** *Does this tell agents how to behave (doctrine → ratify) or how something works (fact → self-ingest)?*

### Auto-Memory vs Layer 3

Auto-memory (`~/.claude/projects/.../memory/`) = preferences + context specific to THIS agent only. Layer 3 = anything that should change how ANY fleet agent behaves. Rule: if it only helps me, auto-memory; if it would prevent any agent from repeating a mistake, Layer 3.

---

## Shared State Files (Read Before Writing)

- `docs/build_handover.md` — Claude Code cross-session narrative. Read at onboarding step 2. Written at wrap-up step 3.
- `docs/backlog.md` — **ELIMINATED 2026-07-01** (CEO doctrine). Do NOT recreate. Persistent work → P4D3; between-session → `build_handover.md`; doctrine → this file; live in-session checklist → harness task-list (TaskCreate/TaskUpdate).
- `$ELEVATIONARY_AGENT_DATA_DOCS/ORS_logs/` — Claude Code writes ORS logs here. Read-only for other agents.
- `session_log.md` — lives in `$ELEVATIONARY_AGENT_DATA_DOCS/`. StateManager resolves path automatically via CLIENT_ROSTER.json.

P4D3 + `build_handover.md` are the bridge. Actionable outcomes → P4D3 (authoritative). Cross-session narrative → `build_handover.md`. No cross-reading of handovers.

---

## Wrap-Up Protocol

Run in order when CEO signals "run wrap-up" (subject to Wrap-Trigger Authorization Guard above):

1. **Update P4D3** — For each completed task originating in P4D3, call `elevationary_p4d3_update_status` to mark done with today's date.
2. **Commit** — `git add <files> && git commit -m "..."` for uncommitted work.
3. **Write handover** — Read current `docs/build_handover.md` first, then rewrite with What Was Done + Remaining Work.
4. **Walkthrough discipline (walkthrough-at-PASS):** Every ORS PASS ships a companion walkthrough written at the moment of PASS. `claude_wrap_up.py` Step 0.7 walkthrough gate REFUSES to close if today's ORS PASS(es) lack companion walkthroughs. Waivers: (a) auto-waive if `git diff --stat HEAD` shows ≤10 changed lines AND no `docs/templates/` / `scripts/` / `directives/` paths touched; (b) explicit `--skip-walkthrough-gate --waive-walkthrough-reason "<why>"` (audited).
5. **Scan for learning moments** — Review session's ORS log, walkthrough, key decisions. Three questions: (a) Anything that should change fleet behavior? → fleet lesson → **doctrine-class routes to El_OS via A2A; non-doctrine self-ingest via `ingest_memory.py`**. (b) Any plan/ORS/walkthrough/decision produced? → `vault_upload.py` → Layer 4. (c) Any new structured facts? → `store_fact` → Layer 2.
6. **Run wrap-up script:**
   ```bash
   python3 ~/.gemini/antigravity/skills/morning_muster/scripts/claude_wrap_up.py \
     --agent "<AgentName>" \
     --workspace "$ELEVATIONARY_AGENT_WORKSPACE" \
     --focus "<one-line session theme>" \
     --achievements "Achievement 1" "Achievement 2" \
     --pending "Pending item 1" "Pending item 2"
   ```
   Achievements tagged `(Claude Code)` automatically. StateManager merges Gemini's same-day entries; never overwrites.
