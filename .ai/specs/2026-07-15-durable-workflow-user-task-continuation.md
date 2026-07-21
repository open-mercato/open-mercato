# Durable Workflow User-Task Continuation

## TLDR

**Key points:**

- Keep `USER_TASK` completion and the existing complete endpoint, but separate the durable database acknowledgement from post-completion workflow execution.
- Commit the completed task, root/branch context, exited step, and an immutable continuation intent atomically.
- Make repeated completion delivery idempotently re-drive the same continuation, with one database winner and explicit at-least-once semantics for external activities.

**Scope:** root and parallel-branch user tasks, completion races, crash recovery, persistent retry, replay-safe responses, and operational reconciliation.

**Primary risk:** the current handler flushes `COMPLETED` before later lookups and transition execution. A failure can therefore leave a completed task attached to a paused workflow, while a blind retry is rejected as already completed.

## Overview

The current `completeUserTask()` performs several independently flushed phases: mark the task completed, load and update the workflow instance, exit the step, execute a transition, and continue the executor. A process failure or thrown transition can split those phases permanently.

This specification defines a durable handoff without inventing a new workflow step or claiming exactly-once external side effects. The database becomes authoritative for whether a user completion was accepted and whether its continuation was applied. Normal execution attempts continuation immediately; persistent delivery and replay repair failures. A repeated identical completion is a recovery operation, not a second business mutation.

Access and assignment checks come from [`2026-07-15-secure-workflow-user-task-access-and-personal-inbox.md`](2026-07-15-secure-workflow-user-task-access-and-personal-inbox.md). This specification begins only after that policy authorizes the actor.

## Current Baseline and Delta

Baseline reviewed: `open-mercato/open-mercato` `develop` at `28649ddec6dd26c15244f4b4264117c8e645a368` on 2026-07-21.

| Current behavior | Keep | Required delta |
| --- | --- | --- |
| `POST /api/workflows/tasks/{id}/complete` | URL/body and task form validation | Idempotent recovery response and continuation status |
| Root task context merge | Form data remains merged into root context | Commit with task/step/intent in one transaction |
| Parallel task branch resume | Branch namespace and branch-only progression | Commit branch completion intent atomically and resume only that branch |
| `WorkflowEvent` audit log | Existing table and event history | Use immutable requested/applied events as the recovery journal |
| Workflow execution lock | Existing instance/branch pessimistic serialization | Reuse for a single continuation winner |
| Persistent event/queue runtime | Existing retry infrastructure | Declare a focused completion event/subscriber |
| Instance retry API | Existing failed-instance behavior | Also reconcile pending user-task continuation when explicitly retried |

No merged upstream change currently provides this continuation journal or replay path. PRs #4019, #4085, and #4291 do not overlap it.

## Problem Statement

The current completion sequence can produce these externally visible states:

1. task is `COMPLETED`, but workflow/branch context was not updated;
2. context and task are updated, but the step is still active;
3. step is exited, but no outgoing transition was applied;
4. a transition side effect ran, the transaction rolled back, and retry may run it again;
5. a second HTTP request sees only “already completed” and cannot repair any of the above.

Task completion and workflow execution cannot share a long transaction safely because synchronous activities may call external systems. Conversely, a database commit followed by an unrecorded in-memory continuation call creates an unrecoverable crash window.

## Goals

1. Atomically persist accepted user input and a durable continuation intent.
2. Keep the task-completion transaction short and free of arbitrary transition activities.
3. Serialize root/branch continuation so only one database transition is applied.
4. Make identical completion replay a safe recovery mechanism.
5. Resume both root and parallel-branch tasks.
6. Expose pending/applied status without changing existing route/body contracts.
7. State external side-effect guarantees honestly as at-least-once.

## Non-Goals

- Exactly-once HTTP, email, webhook, or third-party activity execution.
- A platform-wide transactional outbox.
- Changing queue strategy, retry defaults, or worker concurrency.
- Reworking all workflow executor transaction boundaries.
- User-task assignment, visibility, navigation, or contextual widgets.
- Manual transition selection, task release/unclaim, compensation redesign, or timer/signal continuation.
- A database migration in this first version.

## Proposed Solution

### Design Decisions

| Decision | Rationale |
| --- | --- |
| `WorkflowEvent` records requested/applied continuation | Existing scoped durable storage avoids a new table and migration |
| Accepted task completion and requested event share one transaction | No completed task can exist without a recoverable handoff record |
| Transition activities run after that transaction | User-task row locks are not held across external work |
| Existing instance/branch execution lock is the single-winner boundary | Reuses current workflow serialization |
| Same-actor, same-input replay repairs pending continuation | Closes the commit/response/enqueue crash window without a new endpoint |
| Same original actor with different input returns `409`; any different actor is rejected as `404` before replay classification | Prevents accepted-data rewrites without creating a task-existence oracle |
| Persistent completion event is a retry accelerator, not the source of truth | Database/message enqueue is not atomic today |
| Instance retry and a scoped reconcile command can re-drive pending intents | Gives operators a deterministic recovery path when no client retries |

### Alternatives Considered

| Alternative | Why rejected |
| --- | --- |
| Keep current flushes and add `try/catch` | Does not repair process termination or committed partial state |
| Execute the full workflow inside the completion transaction | Holds locks while arbitrary activities run |
| Add a continuation table/outbox | A platform outbox does not exist; a one-off dispatcher would add more machinery than the scoped journal |
| Treat event-bus enqueue as atomic with task commit | The queue is outside the task database transaction |
| Return conflict for every repeated complete request | Prevents recovery after an acknowledged database commit |
| Promise exactly-once activities | Existing executor/activity contracts are retryable and external effects cannot be atomically committed with Postgres |

## Architecture

```text
authorized complete route
  -> short scoped completion transaction
       task + context + step exit + requested WorkflowEvent
  -> resumeUserTaskContinuation
       existing root/branch execution lock
       recorded transition + applied WorkflowEvent in one transaction
  -> existing workflow execution loop

HTTP replay / persistent subscriber / instance retry / scoped CLI
  -> the same resumeUserTaskContinuation entry point
```

The workflows module owns the completion command, requested/applied journal events, resume function, persistent subscriber, and reconciliation entry points. The secure-access companion owns actor admission and replay visibility; this specification never creates an alternate authorization path. Existing workflow executor, transition, parallel-branch, event, and queue primitives remain the only execution mechanisms.

No public DI key, cross-module dependency, new worker framework, or second workflow cursor is introduced. The task/instance/branch locks and `WorkflowEvent` journal form the durability boundary; event delivery and explicit retries are accelerators that converge on the same idempotent command.

## State and Invariants

### Durable Events

The workflow audit log adds two internal event types:

```ts
type UserTaskContinuationRequested = {
  taskId: string
  stepInstanceId: string
  branchInstanceId?: string | null
  fromStepId: string
  transitionId: string
  toStepId: string
  completedBy: string
  inputDigest: string
}

type UserTaskContinuationApplied = {
  taskId: string
  transitionId: string
  toStepId: string
}
```

`inputDigest` is a deterministic server-side digest of canonicalized validated form data plus comments. It is used only to compare retries and does not replace stored form data. It must not contain secrets or be exposed as an authentication credential.

The correctness invariants are:

1. A task first enters `COMPLETED` in the same transaction as `USER_TASK_COMPLETED` and, when an outgoing transition is selected, `USER_TASK_CONTINUATION_REQUESTED`.
2. One task has one accepted input digest and at most one effective requested transition.
3. `USER_TASK_CONTINUATION_APPLIED` is written in the same database transaction that moves the root/branch token away from the user-task step.
4. A token already moved away from the recorded step is an idempotent applied/no-op outcome, never a reason to run the transition again.
5. A completed task with requested but not applied continuation remains recoverable through replay/reconciliation.

The implementation may enforce uniqueness through the existing task lock plus event lookup; it does not require a new database constraint in this phase. Concurrency tests must prove the invariant rather than assuming event order.

### Transition Selection

After form data is merged into a transaction-local context, the completion command evaluates the version-pinned workflow definition and selects the same first valid automatic transition semantics used today. The chosen transition ID/from/to is persisted in the requested event so retry does not reselect against later mutable state.

- If a valid automatic transition exists, create the continuation intent.
- If automatic transitions exist but none is valid, return `409 USER_TASK_NO_VALID_TRANSITION` and roll back the task completion. The task remains actionable so corrected input/definition handling can recover instead of producing a completed-but-stuck task.
- If the definition intentionally has no automatic outgoing transition, preserve current task-complete/no-progression behavior and return `continuation.status = 'not_required'`; no requested event is written.

The no-outgoing-transition case is explicit legacy behavior, not a durable progression guarantee.

## Completion Transaction

The authorized complete command performs:

1. Validate and canonicalize form data before opening the transaction.
2. Resolve the scoped task identity, then acquire the existing root instance or branch execution lock and the task/step locks in one documented order shared with affected resume paths.
3. Re-read task, actor eligibility, workflow/branch cursor, and active step under lock.
4. For a first completion:
   - merge form data into root context or branch namespace;
   - set task completion fields;
   - exit the active step with the existing output shape;
   - append `USER_TASK_COMPLETED`;
   - select/persist `USER_TASK_CONTINUATION_REQUESTED` when required.
5. Commit without executing transition activities or emitting an external event.
6. After commit, call the continuation service once and emit `workflows.task.completed` as a persistent event; either order is safe because both are idempotent accelerators.

The implementation must audit lock order against `executeWorkflow`, parallel resume, signals, and async-activity resume. It must not introduce a new inverse lock order.

## Continuation Application

`resumeUserTaskContinuation(taskId, scope)`:

1. Load the scoped task and requested event.
2. Acquire the same root/branch execution lock.
3. If an applied event exists, return `applied`.
4. If the token no longer points at the recorded source step and the recorded transition is present in workflow history, record/return `applied` without executing again.
5. Verify the task is completed, definition version and transition IDs match, and the step was exited by this task.
6. Execute the recorded transition through the existing transition/executor primitives.
7. Write `USER_TASK_CONTINUATION_APPLIED` in the same database transaction that advances the root/branch cursor.
8. After that commit, continue the normal workflow loop from the new cursor.

For a parallel task, only the recorded branch namespace/cursor is resumed. Sibling branches and the root context retain existing join semantics.

The short completion transaction is always separate from transition execution. The existing executor may still run synchronous activities inside its own transaction; therefore a crash after an external effect but before its database commit can repeat that activity. Existing activity idempotency requirements remain mandatory, and this feature does not claim otherwise.

## Replay and Recovery Contract

### Repeated Complete Request

When the route sees an already-completed task, the secure-access policy first admits only the original completing actor with the complete feature. This admission applies to pending, applied, and not-required outcomes so a lost-response retry remains idempotent; only the pending outcome is advertised as an interactive retry capability. The durable command then performs a scoped locked read:

- same `completedBy` and same canonical input digest: do not mutate the task; call continuation resume and return current state;
- same original actor but different input digest: return `409 TASK_ALREADY_COMPLETED`;
- any different actor is rejected as `404` by the secure-access boundary before replay classification, preserving task non-enumerability;
- applied continuation: return the same successful projection;
- pending continuation: attempt resume and return pending/applied result.

Thus a client retry after a lost HTTP response repairs the continuation without duplicating the user completion. The access specification owns completed-task detail visibility and the server-derived `canRetryContinuation` capability; this specification owns digest comparison and resume behavior.

### Persistent Event

Declare `workflows.task.completed` with trusted tenant/organization scope and a minimal `{ taskId }` payload. Its persistent subscriber calls the same resume function. Redelivery after application is a no-op.

The event is emitted after the database commit. Enqueue failure does not erase or roll back the accepted task; the requested event remains the source of truth.

### Explicit Reconciliation

Two existing operational entry points gain focused repair behavior:

- an authorized instance retry first checks for requested-without-applied user-task continuation for that instance and re-drives it before applying failed-instance retry semantics;
- a workflows CLI command accepts tenant/organization and optional instance/task filters, scans a bounded page of requested-without-applied events, and invokes the same resume function.

The command is finite and operator-invoked; this specification does not add a polling loop. It reports scanned/applied/already-applied/failed counts without form data or comments.

## API Contracts

### Complete Response

The existing response remains successful after the task commit and adds:

```ts
{
  data: UserTask,
  continuation: {
    status: 'applied' | 'pending' | 'not_required'
    retryable: boolean
  }
}
```

- `applied`: token left the user-task step.
- `pending`: completion is durable but continuation attempt failed or has not finished; repeating the same request is safe.
- `not_required`: no automatic outgoing transition exists.

Existing clients may ignore the additive field. The route does not return a generic `500` after a durable task commit merely because post-commit continuation failed. Structured logs/metrics capture the failure, and the response marks it pending.

Errors before commit retain `400/401/403/404/409` semantics. Same-actor different-input replay returns `409`; a different actor receives the access specification's indistinguishable `404`.

## UI/UX

- On `applied`, remove the task from the active inbox and show the existing success message.
- On `pending`, show a non-destructive “Task completed; workflow is continuing” state and retain a Retry continuation action that repeats the same complete request payload.
- Disable repeat submission while one request is in flight.
- Contextual widgets and task detail consume the same continuation status; neither invents a separate resume endpoint.
- A task whose continuation is pending is no longer actionable as a task, but its detail remains available to the completing user and managers under the access specification.

All new strings use workflows locale keys and semantic status components.

## Data Models

No new entity or column is planned. Existing records are used as follows:

| Record | Durable role |
| --- | --- |
| `UserTask` | accepted input, completing actor, immutable completed lifecycle |
| `WorkflowEvent` | requested/applied continuation journal and audit |
| `WorkflowInstance` | root cursor, context, and execution lock |
| `WorkflowBranchInstance` | branch cursor, namespace, and execution lock |
| `StepInstance` | proof that the user-task step exited |

If implementation evidence proves event lookup cannot meet bounded recovery targets without a schema change, work stops for a separately reviewed additive index proposal.

## Observability and Performance

- Structured logs include task/instance/branch IDs, transition ID, outcome, and attempt source, but never form data/comments.
- Metrics: requested count, applied count, pending age, replay count, reconciliation failure count.
- Normal completion adds bounded event lookups and one post-commit continuation attempt.
- Reconciliation is paginated, tenant/organization scoped, oldest pending first, and bounded by an explicit limit.
- Target: p95 database-only completion acknowledgement below 250 ms excluding post-commit workflow activity time.
- The API must not hold task locks while external activities run.

## Migration and Backward Compatibility

- No schema migration, route rename, body change, or existing workflow event removal.
- Response fields are additive.
- Repeated identical completion changes from conflict/not-found to idempotent success; this is an intentional reliability correction.
- Repeated completion with different input remains a conflict.
- Existing completed tasks without requested events are not automatically replayed; only tasks completed after this contract, or explicitly repaired through a separately reviewed backfill, participate.
- External activities retain at-least-once behavior.

## Implementation Plan

### Phase 1: Atomic Completion Intent

1. Refactor complete into one scoped transaction with deterministic lock order.
2. Persist task/context/step plus requested event atomically.
3. Add input digest and replay classification helpers.

### Phase 2: Idempotent Resume

1. Add the root/branch continuation resume function using existing execution locks.
2. Persist applied event with cursor advancement.
3. Declare the persistent completion event/subscriber.

### Phase 3: Recovery and UX

1. Make identical complete replay re-drive pending continuation.
2. Add instance-retry reconciliation and bounded CLI repair.
3. Expose continuation status and pending/retry UI.
4. Add crash-window, redelivery, branch, and headed UI coverage.

## Expected File Manifest

| Path | Action |
| --- | --- |
| `packages/core/src/modules/workflows/lib/task-handler.ts` | Refactor completion transaction/replay |
| `packages/core/src/modules/workflows/lib/user-task-continuation.ts` | Add focused resume/reconcile logic |
| `packages/core/src/modules/workflows/lib/transition-handler.ts` / `parallel-handler.ts` | Narrow integration with recorded transition and branch cursor |
| `packages/core/src/modules/workflows/api/tasks/[id]/complete/route.ts` | Add replay and continuation response |
| `packages/core/src/modules/workflows/events.ts` | Declare completion event |
| `packages/core/src/modules/workflows/subscribers/user-task-completed.ts` | Persistent idempotent resume |
| workflows CLI command surface | Add bounded scoped reconcile command |
| task detail/inbox and locales | Add pending/applied UX |
| workflows unit/integration tests | Add atomicity, crash, replay, branch, redelivery proof |

## Testing Strategy

| Area | Required proof |
| --- | --- |
| Atomicity | injected failure before commit leaves task/context/step/events unchanged |
| Commit/response crash | task+request committed, client retry applies continuation once |
| Emit failure | accepted task remains pending and explicit replay repairs it |
| Complete race | two requests accept one input; one mutation/event; other idempotent or `409` by digest |
| Resume race | HTTP attempt and persistent subscriber produce one applied transition |
| Root progression | form data, exited step, transition, next step, applied event |
| Parallel progression | only target branch advances; sibling/join behavior retained |
| Redelivery | repeated persistent job is a no-op after applied |
| No valid transition | rollback with `409`; task remains actionable |
| No outgoing transition | explicit `not_required` legacy behavior |
| External effect | test documents possible at-least-once execution; idempotent handler fixture tolerates replay |
| Reconcile | tenant/org filters, bounded page, metrics, no sensitive logs |
| UI | applied and pending states on desktop/narrow; retry repeats identical payload |

## Risks and Impact Review

### Completed Task, Paused Workflow

- **Scenario:** the process stops after task commit but before continuation execution or queue enqueue.
- **Severity:** High.
- **Affected area:** workflow liveness.
- **Mitigation:** requested event is committed with the task; identical HTTP replay, persistent subscriber, instance retry, and CLI reconciliation call the same idempotent resume.
- **Residual risk:** without a client retry, event enqueue, instance retry, or operator reconciliation, recovery latency is unbounded; a platform outbox is explicitly outside this scope.

### Duplicate Database Progression

- **Scenario:** HTTP and worker attempts race.
- **Severity:** High.
- **Affected area:** cursor, context, audit history.
- **Mitigation:** existing execution lock, source-step verification, requested/applied event checks, concurrency integration test.
- **Residual risk:** future resume paths must preserve the same lock order.

### Duplicate External Activity

- **Scenario:** external side effect succeeds but executor transaction rolls back before applied state commits.
- **Severity:** High.
- **Affected area:** third-party systems.
- **Mitigation:** explicit at-least-once contract and existing activity idempotency requirements; never label the feature exactly-once.
- **Residual risk:** non-idempotent legacy activities can duplicate and require provider-side keys or compensation.

### Lock Deadlock or Latency

- **Scenario:** complete acquires task/instance/branch locks in an order opposite another resume path.
- **Severity:** High.
- **Affected area:** workflow throughput.
- **Mitigation:** lock-order inventory before coding, one documented order, short completion transaction, race/deadlock tests.
- **Residual risk:** unrelated future executor changes can reintroduce inversion.

### Sensitive Replay Logging

- **Scenario:** form data/comments or their canonical representation are logged during reconciliation.
- **Severity:** High.
- **Affected area:** privacy and secrets.
- **Mitigation:** logs contain identifiers/outcomes only; digest is non-reversible and not logged unless necessary at truncated safe form.
- **Residual risk:** task data remains subject to its existing database protection policy.

## Final Compliance Report

| Requirement | Planned compliance |
| --- | --- |
| Scope and locks | Tenant/org predicates and existing instance/branch serialization |
| Transaction safety | Task/context/step/request committed together; external execution after commit |
| Queue guidance | Idempotent persistent subscriber; no new strategy/default/polling loop |
| Backward compatibility | Existing route/body/event history retained; additive response/internal events |
| Sensitive data | No form/comment payload in logs or event-bus payload |
| Simplicity | Reuse `WorkflowEvent` and current retry/executor paths; no new table/public framework |
| Integration coverage | Root, branch, races, crash windows, redelivery, reconciliation explicitly required |

Implementation remains blocked until this specification is merged and the public feature-claim admission gate is satisfied.

## Changelog

### 2026-07-21

- Split durable completion/continuation from the access and inbox specification.
- Grounded the design in the current multi-flush handler, existing workflow event log, root/branch execution locks, persistent event runtime, and instance retry path.
- Defined identical-request replay, requested/applied journal events, explicit reconciliation, and honest at-least-once external side-effect semantics.

### 2026-07-15

- Initial scope approved as part of the workflow user-task improvement design.
