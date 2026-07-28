# NOTIFY — workflows-ux-phase4

Append-only UTC log. Checkpoint events, blockers, and scope decisions only.

- 2026-07-28T09:00Z — Run started. Scope: Phase 4a of the workflows UX redesign, on branch feat/workflows-ux-phase4 off feat/agent-orchestrator-mvp @1f4ec94a6.
- 2026-07-28T09:05Z — Research briefing found NINE pre-existing defects. Two (A2 cross-tenant claim write, A3 complete-anyone) were fixed and merged separately as #4573 before this run began.
- 2026-07-28T09:30Z — SCOPE DECISION: six items deliberately excluded from this run because each needs a maintainer decision rather than an implementer's judgment — the §6.4 permission flip (spec requires a dedicated security review; BC has no rule for changing a shipped route's auth semantics; "entity access" is not a platform primitive), portal task API (portal RBAC is Ask-First), any new UserTaskStatus (state machines are Ask-First), the auto-approve/USER_TASK boundary (Ask-First), a shared LocalizedString type (new STABLE surface), and the C3 Task entity. Recorded in PLAN.md Non-goals.
- 2026-07-28T09:30Z — SEQUENCING: A1 (userTaskConfigSchema strips assignedToRoles, so Studio role assignment is silently discarded on save) is a hard prerequisite and lands as step 0.1. Every claim/role-queue story depends on it.
