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

Baseline reviewed: `open-mercato/open-mercato` `develop` at `39ab1d9e62950e84a5acfb10f2925a3ac41ec328` on 2026-07-22.

| Current behavior | Keep | Required delta |
| --- | --- | --- |
| `POST /api/workflows/tasks/{id}/complete` | URL/body and task form validation | Idempotent recovery response and continuation status |
| Root task context merge | Form data remains merged into root context | Commit with task/step/intent in one transaction |
| Parallel task branch resume | Branch namespace and branch-only progression | Commit branch completion intent atomically and resume only that branch |
| `WorkflowEvent` audit log | Existing table and event history | Use immutable requested/applied events as the recovery journal |
| Workflow execution lock | Some executor paths lock a root instance or branch; completion, task/step reads, and `resumeBranch` do not | Add one lock order across every affected completion/resume path |
| Persistent event/queue runtime | Existing retry infrastructure | Declare a focused completion event/subscriber |
| Failed-instance retry API | Preserve its current `FAILED`-only behavior | Do not claim it can reconcile `PAUSED`/`RUNNING` user-task continuations |

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
| New root/branch/step/task lock discipline is the single-winner boundary | Current completion and direct branch resume are not fully locked; the spec must add, not assume, this boundary |
| Same-actor, same-input replay repairs pending continuation | Closes the commit/response/enqueue crash window without a new endpoint |
| Same original actor with different input returns `409`; any different actor is rejected as `404` before replay classification | Prevents accepted-data rewrites without creating a task-existence oracle |
| Persistent completion event is a retry accelerator, not the source of truth | Database/message enqueue is not atomic today |
| Identical HTTP replay, persistent delivery, and a scoped reconcile command can re-drive pending intents | These paths are reachable for a completed task even while its instance remains `PAUSED`/`RUNNING` |

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

HTTP replay / persistent subscriber / scoped CLI
  -> the same resumeUserTaskContinuation entry point
```

The workflows module owns the completion command, requested/applied journal events, resume function, persistent subscriber, and reconciliation entry points. The secure-access companion owns actor admission and replay visibility; this specification never creates an alternate authorization path. Existing workflow executor, transition, parallel-branch, event, and queue primitives remain the only execution mechanisms.

The existing route's direct import of task-handler functions is replaced by one module-local `workflowTaskHandler` DI registration so routes follow the workflows service-resolution rule and tests can substitute the command boundary. This is an additive stable DI key with the current complete/claim route call sites; it is not a new cross-module dependency. No new worker framework or second workflow cursor is introduced. The new root/branch/step/task lock discipline and `WorkflowEvent` journal form the durability boundary; event delivery and explicit retries are accelerators that converge on the same idempotent command.

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
  transitionDigest: string
  completedBy: string
  inputDigest: string
}

type UserTaskContinuationApplied = {
  taskId: string
  transitionId: string
  toStepId: string
}
```

`inputDigest` is a deterministic server-side SHA-256 digest of canonicalized validated form data plus comments. `transitionDigest` uses the same canonical serializer and hashes a resolved execution envelope: transition ID, source/destination IDs, trigger, priority, activities, failure policy, every other executor-relevant transition option, and the complete scoped snapshot of every referenced pre/post business rule. Each rule snapshot includes its reference order/required flag plus all evaluation- or side-effect-bearing fields: rule ID/type/entity/event, condition expression, success/failure actions, enabled/priority/version/effective window, and tenant/organization identity. Descriptive/audit timestamps and actor fields that cannot affect execution are excluded explicitly by the helper and tests. The implementation extracts/reuses the existing key-sorted `stableSerialize`/hash semantics from `shipping_carriers/lib/shipment-idempotency.ts` into a shared helper; the shipping path keeps a compatibility export so there is one serializer, not two. Object keys are sorted, object properties whose value is `undefined` are omitted, array order is retained, `null` is retained, and array `undefined` follows the existing serializer's `null` representation. Comments normalize missing, `undefined`, `null`, and the empty string to `null`; non-empty strings, including whitespace, remain byte-for-byte distinct. Digests are used only for equality checks, do not replace stored input or transition/rule definitions, must not contain secrets, and are not authentication credentials.

The correctness invariants are:

1. A task first enters `COMPLETED` in the same transaction as `USER_TASK_COMPLETED` and, when an outgoing transition is selected, `USER_TASK_CONTINUATION_REQUESTED`.
2. One task has one accepted input digest and at most one effective requested transition.
3. `USER_TASK_CONTINUATION_APPLIED` is written in the same database transaction that moves the root/branch token away from the user-task step.
4. A token already moved away from the recorded step is an idempotent applied/no-op outcome, never a reason to run the transition again.
5. A completed task with requested but not applied continuation remains recoverable through replay/reconciliation.
6. Resume executes only a resolved transition-and-rule envelope whose complete canonical semantics match the persisted `transitionDigest`; later definition or business-rule edits can never run under the original completer's continuation request.

The implementation may enforce uniqueness through the existing task lock plus event lookup; it does not require a new database constraint in this phase. Concurrency tests must prove the invariant rather than assuming event order.

### Transition Selection

After form data is merged into a transaction-local context, the completion command resolves the definition by instance definition ID plus the same exact tenant/organization tuple as the locked task/instance and selects the same first valid automatic transition semantics used today. The existing unscoped `findDefinitionForInstance` behavior is not reused unchanged on this path. It resolves every referenced business rule through that same tuple before computing the execution envelope. Workflow definitions and business rules are mutable rows, so this contract does not claim nonexistent immutable versions. Instead, the chosen `transitionId`, `fromStepId`, `toStepId`, and full-envelope `transitionDigest` are persisted in the requested event. These fields become the authoritative replay identity and semantic binding: retry never reselects a different transition and never executes changed conditions, rule actions, activities, or configuration under the original completer's identity.

- If a valid automatic transition exists, create the continuation intent.
- If automatic transitions exist but none is valid, return `409 USER_TASK_NO_VALID_TRANSITION` and roll back the task completion. This intentionally replaces today's successful response that leaves the instance running at the same step. The UI keeps the task actionable, shows a localized non-destructive condition error, preserves entered form data, and offers a return-to-form/retry path after the user or workflow manager corrects the input/definition. Release notes and API tests call out this behavior change.
- If the definition intentionally has no automatic outgoing transition, preserve current task-complete/no-progression behavior and return `continuation.status = 'not_required'`; no requested event is written.

The no-outgoing-transition case is explicit legacy behavior, not a durable progression guarantee.

## Completion Transaction

The authorized complete command forks the request entity manager and uses `withAtomicFlush(em, phases, { transaction: true, label: 'workflows.user-task.complete' })`. It performs:

1. Validate and canonicalize form data before opening the transaction.
2. Resolve the scoped task identity without mutation, then re-read and acquire new pessimistic-write locks in the canonical order: root `WorkflowInstance`; the target `WorkflowBranchInstance` when present; `StepInstance`; `UserTask`. Every affected complete, root resume, direct `resumeBranch`, signal, and async-activity resume path that can touch these rows follows this prefix order and never acquires an earlier row after a later row.
3. Re-read task, actor eligibility, workflow/branch cursor, and active step under lock.
4. In the first atomic phase, for a first completion:
   - merge form data into root context or branch namespace;
   - set task completion fields;
   - exit the active step with the existing output shape;
   - append `USER_TASK_COMPLETED`;
   - select/persist `USER_TASK_CONTINUATION_REQUESTED` when required.
5. Let `withAtomicFlush` flush the phase and commit or roll back all task/context/step/journal writes together. No hand-rolled intermediate flush or external effect is allowed inside the transaction.
6. After commit, call the continuation service once and emit `workflows.task.completed` as a persistent event; either order is safe because both are idempotent accelerators.

The initial unlocked identity read is never trusted for authorization or mutation; all predicates are repeated after the locks. The implementation must audit lock order against `executeWorkflow`, direct and activity-driven parallel resume, signals, and async-activity resume. Tests race HTTP/HTTP and HTTP/subscriber paths and fail on lock inversion or duplicate journal/cursor progress.

## Continuation Application

`resumeUserTaskContinuation(taskId, scope)`:

1. Load the scoped task and requested event.
2. Acquire the same root/branch execution lock.
3. If an applied event exists, return `applied`.
4. If the token no longer points at the recorded source step and the recorded transition is present in workflow history, record/return `applied` without executing again.
5. Verify the task is completed, the persisted transition/from/to IDs are internally consistent with the requested event and recorded step history, and the step was exited by this task. Load the exact transition ID and all referenced rules once through the current scoped stores, build the resolved execution envelope, and compare it with `transitionDigest`. A missing/disabled/foreign rule, identity mismatch, or digest mismatch remains pending, emits a structured operator-visible reconciliation failure, and never guesses or executes a replacement transition/rule.
6. Pass that already-verified in-memory execution envelope to exact transition/rule executors that do not reload or reselect from mutable definition or business-rule stores. This requires narrow extensions/refactors of the existing transition and rule-engine primitives; the from/to lookup and `executeRuleByRuleId` paths cannot be reused for durable replay.
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

The existing instance retry API remains unchanged because it rejects every instance that is not `FAILED`, while a pending user-task continuation is normally `PAUSED` or `RUNNING`. It is not listed or tested as a recovery path.

A workflows CLI command accepts tenant/organization and optional instance/task filters, scans a bounded page of requested-without-applied events, and invokes the same resume function. Together with same-payload HTTP replay and the persistent subscriber, this is the third reachable recovery path.

The command is finite and operator-invoked; this specification does not add a polling loop. It reports scanned/applied/already-applied/failed counts without form data or comments.

## API Contracts

### Complete Response

The existing response remains successful after the task commit and adds:

```ts
{
  data: UserTask,
  message: string,
  continuation: {
    status: 'applied' | 'pending' | 'not_required'
    retryable: boolean
  }
}
```

- `applied`: token left the user-task step.
- `pending`: completion is durable but continuation attempt failed or has not finished; repeating the same request is safe.
- `not_required`: no automatic outgoing transition exists.

The existing required `message` member remains unchanged; only `continuation` is additive in `userTaskCompleteResponseSchema` and OpenAPI. Existing clients may ignore the additive field. The route does not return a generic `500` after a durable task commit merely because post-commit continuation failed. Structured logs/metrics capture the failure, and the response marks it pending.

Errors before commit retain `400/401/403/404/409` semantics. Same-actor different-input replay returns `409`; a different actor receives the access specification's indistinguishable `404`.

## UI/UX

- On `applied`, remove the task from the active inbox and show the existing success message.
- On `pending`, show a non-destructive “Task completed; workflow is continuing” state and retain a Retry continuation action that repeats the same complete request payload.
- Disable repeat submission while one request is in flight.
- Contextual widgets and task detail consume the same continuation status; neither invents a separate resume endpoint.
- A task whose continuation is pending is no longer actionable as a task, but its detail remains available to the completing user and managers under the access specification.
- On `USER_TASK_NO_VALID_TRANSITION`, keep the form values and task actionable, show a localized condition error, and direct the user to correct/retry the form or contact a workflow manager; no completion-success message is shown.

All new strings use workflows locale keys and semantic status components.

## Frontend Architecture Contract

The access companion's first atomic delivery groups extract `/backend/tasks` and `/backend/tasks/{id}` into server page roots with bounded client islands. Durable UI lands only after that split and adds continuation/no-valid-transition behavior to `UserTaskDetailClient` plus the smallest inbox status/action leaf; it does not restore a page-root `"use client"` directive.

| Surface | Server root | Client island | Data owner | Guardrail |
| --- | --- | --- | --- | --- |
| task detail | access companion's server page | bounded detail/action client leaves | additive complete response | preserve required `message`; no new endpoint or form normalizer |
| personal inbox | access companion's server page | bounded table/action client leaves | authorized task projection | pending completed tasks are history/detail state, not active rows |
| order-approval widget / checkout demo | existing hosts | existing clients unchanged | existing complete API | compatibility tests only; additive response does not require production edits |

No new client file, provider, heavy browser library, or bootstrap registry is introduced by this spec beyond the access-owned leaves. The zero page-root-client and 300-LOC leaf budgets from the access companion remain binding. Implementation must pass `yarn check:client-boundaries`, task-detail hydration and pending/retry/error interactions, and compatibility tests proving the existing order-approval widget and checkout demo still accept `{ data, message, continuation }` without production rewrites.

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
- Repeated completion currently returns `404` in practice because `TASK_NOT_FOUND` contains “not found or already completed” and the route matches the not-found branch before its documented but unreachable `409`. Repeated identical completion changes from that effective `404` baseline to idempotent success; this is an intentional reliability correction.
- Repeated completion with different input remains a conflict.
- Existing completed tasks without requested events are not automatically replayed; only tasks completed after this contract, or explicitly repaired through a separately reviewed backfill, participate.
- External activities retain at-least-once behavior.

## Implementation Plan

### Cross-Spec Implementation Order and Atomic Delivery Groups

1. Land the access/inbox capability as one release unit: required organization scope, actor policy, assignment audit/repair gate, secure projections, inbox `myTasks=true` requests, ACL/default grants, dual navigation, scoped Claim/Complete authorization, mutation guards, and direct-assignment notification/link repair. Do not activate broad-list gating while the inbox can omit `myTasks=true`, and never ship `navHidden` without both operator and manager entries.
2. Land this durable continuation capability as one release unit: journal, canonical digest, new locks, atomic completion, resume/reconcile paths, additive response, and `canRetryContinuation` UI. Do not expose a continuation capability before durable state exists.
3. Land contextual source binding, source-authorized routes, and widgets only after both companion contracts exist. If #4019, #4085, or #4291 merges first, rebase and preserve its editor/form-schema semantics rather than duplicating them.

The phases below are implementation sequencing inside the single durable release, not independently deployable product capabilities. Across all three specs, every release unit must be independently green and deployable; commits within a unit must not create an intermediate deploy that broadens visibility, hides both task destinations, advertises an unavailable capability, or strands an accepted completion.

### Phase 1: Atomic Completion Intent

1. Refactor complete into one scoped transaction with deterministic lock order.
2. Persist task/context/step plus requested event atomically.
3. Add shared canonical digest helpers for completion input and complete transition semantics.

### Phase 2: Idempotent Resume

1. Add the root/branch continuation resume function and exact verified-transition executor using the new execution locks.
2. Persist applied event with cursor advancement.
3. Declare the persistent completion event/subscriber.

### Phase 3: Recovery and UX

1. Make identical complete replay re-drive pending continuation.
2. Add bounded CLI repair; preserve the existing failed-instance retry route unchanged.
3. Expose continuation status and pending/retry UI.
4. Add crash-window, redelivery, branch, and headed UI coverage.

## Expected File Manifest

| Path | Action |
| --- | --- |
| `packages/core/src/modules/workflows/lib/task-handler.ts` | Refactor completion transaction/replay |
| `packages/core/src/modules/workflows/lib/user-task-continuation.ts` | Add focused resume/reconcile logic |
| `packages/core/src/modules/workflows/lib/transition-handler.ts` / `parallel-handler.ts` | Add exact verified transition/rule-envelope execution without mutable-store reload; integrate recorded branch cursor |
| `packages/core/src/modules/business_rules/lib/rule-engine.ts` | Add narrow execution of already-scoped, verified in-memory rule snapshots; preserve existing ID-based callers |
| `packages/core/src/modules/workflows/di.ts` | Register additive `workflowTaskHandler` service used by task routes |
| `packages/shared/src/lib/serialization/stable.ts` and shipping compatibility export/tests | Extract/reuse one canonical serializer/SHA-256 primitive without breaking the existing shipping helper path |
| `packages/core/src/modules/workflows/api/tasks/[id]/complete/route.ts` | Resolve handler via DI; add replay and continuation response |
| `packages/core/src/modules/workflows/api/openapi.ts` | Preserve `message`; add continuation response schema |
| `packages/core/src/modules/workflows/events.ts` | Declare completion event |
| `packages/core/src/modules/workflows/subscribers/user-task-completed.ts` | Persistent idempotent resume |
| `packages/core/src/modules/workflows/lib/event-logger.ts` and workflows locale files | Format/localize requested/applied audit events for the events admin page |
| workflows CLI command surface | Add bounded scoped reconcile command |
| `packages/core/src/modules/workflows/backend/tasks/[id]/page.tsx` | Preserve existing response/message behavior; add pending/applied/no-valid-transition UX |
| `packages/core/src/modules/workflows/widgets/injection/order-approval/widget.client.tsx` | Compatibility test target; no production edit expected because `data`/`message` remain |
| `packages/core/src/modules/workflows/frontend/checkout-demo/page.tsx` | Compatibility test target; no production edit expected because `data`/`message` remain |
| workflows unit/integration tests | Add atomicity, crash, replay, branch, redelivery proof |

## Testing Strategy

| Area | Required proof |
| --- | --- |
| Atomicity | injected failure before commit leaves task/context/step/events unchanged |
| Commit/response crash | task+request committed, client retry applies continuation once |
| Emit failure | accepted task remains pending and explicit replay repairs it |
| Complete race | two requests accept one input; one mutation/event; other idempotent or `409` by digest |
| Resume race | HTTP attempt and persistent subscriber produce one applied transition |
| Definition/rule edit race | changed transition or referenced-rule evaluation/action semantics produce pending reconciliation failure; an unchanged verified in-memory envelope executes exactly once even if an edit commits afterward |
| Root progression | form data, exited step, transition, next step, applied event |
| Parallel progression | only target branch advances; sibling/join behavior retained |
| Redelivery | repeated persistent job is a no-op after applied |
| No valid transition | rollback with `409`; task remains actionable |
| No outgoing transition | explicit `not_required` legacy behavior |
| External effect | test documents possible at-least-once execution; idempotent handler fixture tolerates replay |
| Reconcile | tenant/org filters, bounded page, metrics, no sensitive logs |
| Audit rendering | requested/applied types have localized `formatEventMessage` output and events-page filter/detail coverage |
| Response compatibility | `data` and required `message` remain; all three UI consumers tolerate/use additive continuation state |
| UI | applied and pending states on desktop/narrow; retry repeats identical payload |

## Risks and Impact Review

### Completed Task, Paused Workflow

- **Scenario:** the process stops after task commit but before continuation execution or queue enqueue.
- **Severity:** High.
- **Affected area:** workflow liveness.
- **Mitigation:** requested event is committed with the task; identical HTTP replay, persistent subscriber, and CLI reconciliation call the same idempotent resume.
- **Residual risk:** without a client retry, persistent delivery, or operator reconciliation, recovery latency is unbounded; a platform outbox is explicitly outside this scope.

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
| Scope and locks | Required tenant/org tuple plus new root/branch/step/task lock order across affected paths |
| Transaction safety | `withAtomicFlush(..., { transaction: true })` commits task/context/step/request together; external execution runs after commit |
| Queue guidance | Idempotent persistent subscriber; no new strategy/default/polling loop |
| Backward compatibility | Existing route/body/required `message`/event history retained; only continuation response/internal events are additive; effective repeated-complete baseline is documented as `404` |
| Sensitive data | No form/comment payload in logs or event-bus payload |
| Simplicity | Reuse `WorkflowEvent` and current retry/executor paths; no new table/public framework |
| Integration coverage | Root, branch, races, crash windows, redelivery, reconciliation explicitly required |

Implementation remains blocked until this specification is merged and the public feature-claim admission gate is satisfied.

## Changelog

### 2026-07-22

- Rebased the specification baseline onto current `develop` and corrected the current lock, retry, mutable-definition, and repeated-completion baselines.
- Defined the new root/branch/step/task lock order and adopted `withAtomicFlush(..., { transaction: true })` for atomic acknowledgement.
- Reused the existing stable serializer/hash semantics, preserved the required `message` response, and named every current UI consumer and audit renderer.
- Bound replay to a canonical digest of the complete resolved transition-and-business-rule execution envelope and required exact executors that cannot reload changed activities, conditions, or rule actions.
- Removed the unreachable instance-retry recovery claim, added reachable replay/subscriber/CLI recovery, no-valid-transition UX, and cross-spec delivery ordering.

### 2026-07-21

- Split durable completion/continuation from the access and inbox specification.
- Grounded the design in the current multi-flush handler, existing workflow event log, partial root/branch locking, persistent event runtime, and the then-evaluated instance retry path; the 2026-07-22 review correction removes that unreachable retry claim.
- Defined identical-request replay, requested/applied journal events, explicit reconciliation, and honest at-least-once external side-effect semantics.

### 2026-07-15

- Initial scope approved as part of the workflow user-task improvement design.
