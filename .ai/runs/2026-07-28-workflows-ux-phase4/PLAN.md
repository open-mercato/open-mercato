# Run: workflows-ux-phase4

- Date: 2026-07-28
- Branch: `feat/workflows-ux-phase4`
- Base: `feat/agent-orchestrator-mvp` @ `1f4ec94a6` (Phases 0–3b merged + the task tenant-scoping fix #4573)
- Source spec: `.ai/specs/2026-07-26-workflows-ux-redesign.md` §6 + roadmap Phase 4
- Research: `BRIEFING-phase4.md` (412 lines — read §A and §0 before any step)
- Mode: Spec-implementation run (om-auto-create-pr-loop)

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill `Commit` with the **pre-amend lineage** short SHA (the recorded SHA documents which commit introduced the step; it differs from pushed HEAD by construction because amending rewrites the hash). Never leave a `PENDING` placeholder. The first row that is not `done` is the resume point.

| Phase | Step | Title | Status | Commit |
|-------|------|-------|--------|--------|
| 0 | 0.1 | A1: userTaskConfigSchema accepts assignedToRoles/formKey/allowedActions (roles stop being stripped on save) | done | 6d5f1ef7a |
| 0 | 0.2 | A9: replace the naive duration parser with the shared duration util | done | addd6fb4b |
| 0 | 0.3 | A4+A5: declare and emit task events; fix notification recipients for role-assigned tasks; fix deep links | done | a35eb5416 |
| 0 | 0.4 | A6: inbox actually sends the myTasks filter it defaults to | done | 74c515f22 |
| 0 | 0.5 | A8: task list serializer (proposalId/kind/priority to top level, response superset) | done | 9b39f0a68 |
| 0 | 0.6 | taskHandler DI registration + route migration off direct lib imports (module MUST #1) | done | f63c88a01 |
| 1 | 1.1 | Additive userTaskConfig fields: instructions, entityBindings, priority, deadline, reminders, onBreach, decisions, editablePrefilled | done | 25ea54521 |
| 1 | 1.2 | user_tasks additive columns + migration (entity_bindings, priority, reassignment audit) | done | 597bf97ad |
| 1 | 1.3 | Task creation resolves interpolation, dynamic assignment with fallback role, entity bindings | done | de66c0709 |
| 1 | 1.4 | Task inspector §6.1 sections in NodeEditDialogCrudForm (What/About/Who/When/Decisions) | done | ce40b55e2 |
| 1 | 1.5 | Decision buttons bound to durable transition ids + approval preset | done | 78d8853e6 |
| 2 | 2.1 | WorkInboxSourceProvider contract + registry + user_task source + workInboxService DI | done | 55e300ad8 |
| 2 | 2.2 | GET /api/workflows/work-inbox (provider merge, filters, sort, limit clamp) | done | 96b993533 |
| 2 | 2.3 | Work Inbox page + backend/tasks bridge redirect (tableId preserved) + DS badge cleanup | done | 5b424f1d2 |
| 2 | 2.4 | Task detail: decision + context side-by-side, claim button, next-task loop | done | c71ea2f82 |
| 2 | 2.5 | EntityContextPanel + pending-work record-page widget + CustomerTodoLink phase-in | done | ec788a14d |
| 3 | 3.1 | Task SLA scheduler on the Phase-3a absolute-deadline queue backstop (reminders + breach) | done | 879981f0f |
| 3 | 3.2 | SLA-breach route resolver (pure, shaped like lib/error-routing.ts) | done | e097b5e0d |
| 3 | 3.3 | Notification quick-action one-click predicate + workflows.tasks.complete command | done | 6366beaeb |
| 3 | 3.4 | External-form renderer registry (#4243) + validateFormData covers the fields shape | done | bb9ee88df |
| 4 | 4.1 | Integration tests (work inbox, claim/next, entity widget, decision routing, A1 regression) | done | 743be068e |
| 4 | 4.2 | Docs + UPGRADE_NOTES + spec changelog | done | 7049621bc |
| 5 | 5.1 | Pure `lib/task-visibility.ts` predicate (visible/actable/claimable, fail-closed) | todo | — |
| 5 | 5.2 | Entity-access resolver + denormalized `entity_types` column (SQL gate, not a post-filter) | todo | — |
| 5 | 5.3 | Administration ACL features + `setup.ts` grants; existing ids stay load-bearing | todo | — |
| 5 | 5.4 | Tenant opt-out setting (read filter only, never claim/complete) | todo | — |
| 5 | 5.5 | Apply the predicate to task + work-inbox reads and the act paths; role-membership check on claim | todo | — |
| 5 | 5.6 | Disposition tasks: `administrativeQueueFeature` on the provider contract (enterprise declares its own) | todo | — |
| 5 | 5.7 | Security-review checklist evidence + UPGRADE_NOTES entry | todo | — |
| 6 | 6.1 | `assignee_kind` column + portal principal modelling | todo | — |
| 6 | 6.2 | Portal ACL features via `defaultCustomerRoleFeatures` | todo | — |
| 6 | 6.3 | Portal task routes (list/get/complete) — new surface, backoffice routes untouched | todo | — |
| 6 | 6.4 | Portal task pages + nav + Portal Event Bridge live updates | todo | — |

## Goal

Deliver Phase 4a — human tasks that frontline staff can actually work: a real task inspector, a Work Inbox projection over `UserTask` with an extension contract, entity context where the work is, and notification delivery that fires — on a foundation of pre-existing defects fixed first.

## Scope

Phase 0 (debt) + Phase 1 (inspector) + Phase 2 (Work Inbox) + Phase 3 (deadlines/notifications/forms) + Phase 4 (tests/docs) as numbered above.

## Maintainer decisions taken 2026-07-28 — now IN scope (phases 5 and 6)

1. **The §6.4 permission flip ships in full, in one move.** Maintainer rationale: agent_orchestrator is not production code yet, so the risk of disposition tasks becoming invisible is acceptable as a blocker. It is NOT acceptable as an outcome — phase 5.6 gives them an administrative-queue visibility class that needs no change to the auto-approve boundary. Design: `.ai/analysis/2026-07-28-task-visibility-design.md`.
2. **Portal principals get an `assignee_kind` discriminator column**, not a `customer:<id>` string prefix — a value you can index and filter beats string parsing every future query must remember.

**Two design deviations carried, both documented in the design doc and to be called out in the PR:**
- **D-1** — keep `workflows.tasks.claim`/`.complete` as route `requireFeatures`, contrary to the spec's "one's own assigned work requires no workflows feature". Dropping them would leave two FROZEN ACL ids that no route consults (the exact dead-grant problem this change exists to avoid), and the sentence's real purpose — portal parity — is served by the new `portal.tasks.*` routes instead. The narrowing §6.4 demands still lands: holding `.complete` no longer completes anyone else's task.
- **D-2** — add a denormalized `user_tasks.entity_types` column so the entity gate is a SQL `WHERE`. A JS post-filter would make pagination counts lie (ask for 50, get 12, total says 50).

**Still requiring a decision before they start:**

3. **Any new `UserTaskStatus` value** (e.g. `REASSIGNED`) — workflows AGENTS.md Ask-First on state machines. Reassignment will use existing statuses + audit columns + a workflow event, mirroring Phase 3a's `failureQueue` (which reused `PAUSED` + `metadata.attention` rather than adding a status).
4. **Changing the auto-approve vs `USER_TASK` boundary** in agent_orchestrator (its AGENTS.md Ask-First). A7 (disposition tasks unassigned and never closed) is *reported*, not silently redesigned.
5. **A shared `LocalizedString` type.** §6.5 assumes one; none exists. This run keeps a local `{ [locale]: string } | string` shape inside workflows; promoting it to `packages/shared` would create a new STABLE type surface.
6. **A real `Task` entity (C3).** Resolved question #1 says projection now, entity next cycle. The C3 spec document is deferred with the portal work.

## Risks

- **A1 is a hard prerequisite** and lands first: role assignment authored in the Studio is silently discarded on save today (zod strips the undeclared key), so every claim/role-queue/Work-Inbox story is built on sand until 0.1. Same class of silent object-stripping bug Phase 3b found three times.
- **Notifications are greenfield, not "surfacing"** — the event is undeclared and unemitted, deep links point at a route that does not exist, and role-assigned tasks notify nobody. Size Phase 3 accordingly.
- **`tableId: 'workflows.tasks.list'` is FROZEN** (BC §6). The Work Inbox must re-emit it or the enterprise Caseload row action silently disappears — and that action is *already* broken (A8), so a naive rewrite would hide the breakage instead of fixing it.
- **`assignedToRoles` holds role NAMES, not ids** (deferred in 0.4, deliberately). The Studio's `RolesMultiSelect` emits `{ value: name }`, `step-handler` copies those names onto the task, `claimUserTask` and the `myTasks` predicate compare them against `auth.roles` (also names), the shipped `examples/*.json` carry names, and existing `user_tasks` rows store names. Moving to immutable ids is a coordinated data + authored-definition migration, not a query-side edit — a rename silently orphans an assignment until then. Not exploitable by a caller: `auth.roles` is derived server-side from the user's role records.
- `UserTask` is not in the optimistic-lock curated list, and the UI-coverage guard only matches `PUT|PATCH|DELETE` while every task mutation today is a `POST`. A reassign UI will trip it — wire `buildOptimisticLockHeader`/`surfaceRecordConflict`.
- Zero unit tests exist today for `lib/task-handler.ts`, all four `api/tasks/**` routes, `notifications.ts`, and the task subscriber. Every step adds them for what it touches.
- `.ai/tmp/**` is excluded from Playwright discovery — integration specs written in this worktree are not picked up by the repo-root runner.

## Implementation Plan

Step detail lives in `BRIEFING-phase4.md`, one section per topic. Binding rules per step:

1. One Step = one commit; flip the Tasks row in the same commit using Read+Edit tools, never a shell rewrite.
2. Unit tests mandatory for every step; integration batched in 4.1 plus wherever the spec's coverage list names a path.
3. Additive-only across all 13 contract surfaces. New API routes and DI keys are free; ACL and event ids are add-only; DB columns nullable/defaulted with a reviewed migration and snapshot (never run `yarn db:migrate`).
4. Every state change logs a `WorkflowEvent` via `eventLogger` (module MUST #6); services resolve via DI (MUST #1); every query scoped by tenant + organization (MUST #10).
5. i18n in all 4 locales; DS tokens only (Boy-Scout the task page's `bg-yellow-100`/`text-red-600` badges); status never colour-only.
6. `yarn generate` after module-file changes; build packages before generate in a fresh worktree.
7. Checkpoints every ~5 steps.
