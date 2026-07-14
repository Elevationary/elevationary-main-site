# Website Agent OS

See [directives/CLAUDE_CODE.md](directives/CLAUDE_CODE.md) for full operating directives.


---

## A2A Peer Collaboration (Phase 2, 2026-06-16)

You are part of a 15-agent Elevationary fleet linked by the A2A (Agent-to-Agent) messaging system. Other agents can send you `intent=request` envelopes via your inbox at `~/.gemini/antigravity/gateway/inboxes/<your-agent>/inbox.json`. You can dispatch requests to peers the same way.

### Reply discipline when YOU receive a peer request

When the `staff_agent` driver hands you an A2A `intent=request` envelope:

1. **Read** `text` + `reason` carefully — these are the peer's actual question.
2. **Reply terse and on-topic**. Respond ONLY to the requested content. No preamble, no self-narration, no "let me check the workspace first" — just the answer.
3. Do **NOT** initiate workspace introspection, file reads, `build_handover` priming, or any side-effect work UNLESS the envelope text explicitly asks for it.
4. The reply will be dispatched back automatically by the driver via `intent=reply`; your message IS the reply body.

### Your peers (commonly-invoked; see also A2A allowlist matrix)

**Fleet-wide direct-A2A default (CEO-ratified 2026-07-12, allowlist version `2026-07-12-consulting-agent-rule-matrix-001`):** Every non-consulting agent can direct-dispatch to every other non-consulting agent. The list below is Website's *commonly-invoked* peer set with domain trigger notes — NOT an exhaustive gate. Any non-consulting agent can be dispatched to as needed (e.g. `sales`, `visualizer`, `sentinel_intel`, `administrator`, `elevationary_os`, `executive_assistant`). Only the 6 consulting-client agents (`heller_sdp`, `maple_counseling`, `more_than_rehab`, `mtr_cio`, `arrival`, `szmakleap`) are gated — Website is non-consulting and can dispatch to any of them if a client-scoped domain question arises.

- **`newsletter`** — Newsletter content production, editorial schedule, content lifecycle decisions.
- **`marketing`** — Voice, brand tone, visual standards, messaging.
- **`client_billing`** — Stripe↔Zoho subscription revenue linkage (ad-hoc team, 2026-07-13 CEO-ratified). Spec handoffs, joint reviews, joint audit-trail format, live-fire test coordination.
- **`executive_assistant`** (Amanda) — CEO-decision routing + register-keeper. Ping on milestone landings, new CEO-decision surfaces, blockers warranting cross-agent visibility.
- **`administrator`** (COO) — Cross-domain escalation; universally reachable.

### How to dispatch a request to a peer (when YOU initiate)

If you decide to call a peer (e.g. a user request crosses your domain into one of your peers' domains), invoke the dispatch primitive directly:

```python
import sys
sys.path.insert(0, '/Users/jamesszmak/.gemini/antigravity/skills/staff_agent/lib')
from dispatch import dispatch_to
msg_id = dispatch_to(
    agent_name='<peer-name>',         # one of your defined peers above
    text='<your concise question>',
    reason='<why you are dispatching — for audit trail>',
    from_id='<your-agent-slug>',
    reply_to='<your-agent-slug>',
    correlation_id='<unique id for this conversation>',
    intent='request',
    turn_count=7,                     # leaves room for normal back-and-forth
    hop_count=5,                      # max hop budget
    originating_human='james',        # or whoever initiated the upstream user request
    originating_agent='<your-agent-slug>',
)
```

The peer's reply will land in YOUR inbox tagged with the same `correlation_id`, intent=`reply`. Your `staff_agent` driver auto-authorizes replies whose correlation_id matches a trace file in `gateway/traces/`.

### Allowlist

Peer-to-peer dispatch is gated by `gateway/config/a2a_allowlist.json`. Pairs not in `whitelisted_pairs` will be rejected at the receiver. The peer list above is aligned with the current allowlist; do not attempt to dispatch to peers outside it.

### Escalation

If a question exceeds your domain AND your defined peer set, escalate to `administrator` (the COO — universally reachable from any agent). Reply to the user via your normal Telegram channel that you've escalated.
