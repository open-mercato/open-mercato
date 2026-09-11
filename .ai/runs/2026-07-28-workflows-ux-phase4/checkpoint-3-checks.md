# Checkpoint 3 — Phase 4a feature work complete (steps 2.1–3.4)

- Date: 2026-07-28 (UTC) · Runner: local · **185 suites / 2302 tests passing**, typecheck 22/22, lint 0 errors

Work Inbox (2.1–2.3), task detail + record-page presence (2.4–2.5), deadlines/breach/quick-actions/form registry (3.1–3.4).

## Four false premises found by executors this window

**1. A near-miss that would have broken every Studio-authored task.** Step 3.4's brief said `validateFormData` "validates only the JSON-Schema shape, so the `{fields:[…]}` authoring shape is never validated" — true, but incomplete. `TaskFormFields` also only ever walked `formSchema.properties`, so a Studio-authored form **rendered nothing at all**. Adding the required-field validation I asked for, on its own, would have made every Studio-authored task **uncompletable** — a form with no visible fields failing validation on required fields. Both halves now go through one pure `lib/task-form-schema.ts` whose type mapping is the exact inverse of the editor's.

**2. The pressed decision cannot reach a command.** Quick-actions send only `{ actionId }`; `notificationService.executeAction` builds `commandInput = { id: sourceEntityId, ...payload }` and **drops `actionId`**. The platform's only other command-backed notification gives each button its own command id — unavailable here, since workflow decisions are per-task data. Course correction: one-click requires *at most one* decision; multi-decision tasks take the deep link and the command refuses rather than guessing. Fixing it properly means adding `actionId` to `commandInput` in the notifications module — a cross-module contract change, not made unasked.

**3. Queue naming.** `workflow-task-sla` read as a job *kind* on the existing `workflow-activities` queue, not a new queue — a new queue needs its own worker registration and eats the documented per-queue DB connection budget, for jobs that are one row read plus an event. This is exactly what Phase 3a's `condition` backstop does.

**4. `onBreach.reassignTo` is user-id-*or*-role**, not a user id (the inspector's own placeholder says so). A UUID addresses `assigned_to`; anything else is a role name into `assigned_to_roles`.

## Scope decisions taken (both consistent with existing precedent)

- **A branch-scoped task does not follow its breach route** — identical reasoning to the decision-button case in 2.4: a parallel branch advances through `resumeBranch` with its own token, and overriding its outgoing route is a parallel-execution change, not a task-surface one. Logged as `route_skipped_branch`.
- **A routed breach sets `status = 'ESCALATED'`** — an **existing** `UserTaskStatus`, so no state-machine change and no Ask-First trigger.

## SLA job: absolute and idempotent — verified

`deadlineAt` is an ISO instant written at task creation and never recomputed by the worker. A redelivery no-ops three ways: task not `PENDING|IN_PROGRESS`; the breach claimed by a conditional `nativeUpdate … WHERE status IN (…) AND escalated_at IS NULL` matching zero rows; the reminder skipped once `escalatedAt` is set or the deadline has passed. No deadline schedules nothing.

## Confirm dialog: not needed, not built

`confirmRequired` is typed and validated platform-wide but nothing renders it, so no action declares it — a test asserts that. One-click is a single unambiguous completion; anything needing deliberation takes the deep link.
