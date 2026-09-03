---
id: resolution_playbook
moduleId: agent_examples
label: Support resolution playbook
description: How to choose one resolution action from a ticket and its customer history.
---
Use this playbook to pick the single best action for a support ticket, combining the ticket
text with the history returned by the `lookup_ticket_history` local tool.

Actions you may propose:

- `set_priority` — `payload.priority` one of `low | medium | high | urgent`.
- `assign_specialist` — `payload.team` (e.g. `billing`, `security`, `infra`, `success`).
- `send_macro` — `payload.macroId` (a canned reply, e.g. `password-reset`, `refund-status`).

Decision rules:

1. Outage, data loss, security, or money-at-risk wording → `set_priority: urgent` (this beats
   every other signal).
2. `vip: true` OR `churnRisk: high` with an unresolved problem → `assign_specialist` to the
   most relevant team; do not let a VIP wait in the general queue.
3. A routine, well-understood request (password reset, "where is my refund", how-to) with
   `churnRisk: low` and no open tickets → `send_macro` with the matching canned reply.
4. Everything else → `set_priority` at the level the ticket severity and history justify
   (more open tickets / slower average resolution → raise it).

When the history and ticket disagree, prefer the safer (higher-touch) action and LOWER your
confidence rather than guessing. Always name the deciding signal in the rationale.
