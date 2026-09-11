# Design note — workflow-level error handler (Step 2.7)

Spec: `.ai/specs/2026-07-26-workflows-ux-redesign.md` §5.9 defines the handler only negatively — "an
**engine construct, not an event trigger** (the event-trigger subscriber deliberately excludes
`workflows.*` events)". This note fixes the open semantics before any 2.7 code is written, with the
code evidence each decision rests on. Anchors verified on `feat/workflows-ux-phase2b-3` @ `5adad34d6`.

## Code evidence (re-anchored, post Phase 2b/3a)

| Fact | Where |
|---|---|
| Step failure marks the step instance FAILED, logs `STEP_FAILED`, returns `{status:'FAILED'}` | `lib/step-handler.ts` `executeStep` catch (~:266–307) |
| A failed step surfaces to the executor as a **transition** failure | `lib/transition-handler.ts` `executeTransitionForToken` — `stepExecutionResult.status === 'FAILED'` → `{success:false}` (~:598) |
| Transition-activity failure short-circuits unless `continueOnActivityFailure` | `lib/transition-handler.ts` (~:455–490) |
| Instance failure funnels through **one** call shape | `lib/workflow-executor.ts` `completeWorkflow(trx, container, id, 'FAILED', …)` at the branch-failed (~:359), transition-rejected (~:498), and transition-threw (~:601) sites |
| `completeWorkflow`'s FAILED branch runs compensation and **returns early** | `lib/workflow-executor.ts` (~:745–806): `compensateWorkflow(…, {continueOnError:true})` → `enqueueSubWorkflowParentResume` → `emitInstanceLifecycleEvent('workflows.instance.failed')` → `return` |
| Compensation may leave the instance `COMPENSATED`, not `FAILED` | same block, comment "It will be COMPENSATED or remain FAILED" |
| The out-of-band durable-FAILED fork only fires on a **rolled-back transaction** | `lib/workflow-executor.ts` `persistFailedStatusAfterRollback` (~:678–722), called only from the `catch` around `transactionalEm.transactional(...)` (~:665) |
| Sub-workflow start machinery | `lib/step-handler.ts` `handleSubWorkflowStep` → `startWorkflow(em, {workflowId, initialContext, metadata.labels.parent*})` (~:790–815) |
| Established "durable follow-up work after a terminal write" pattern | `lib/workflow-executor.ts` `enqueueSubWorkflowParentResume` (~:866–903) + job kind union in `lib/activity-queue-types.ts` + dispatch in `lib/activity-worker-handler.ts` |
| Branch failure is propagated, never handled per-branch | `lib/parallel-handler.ts` (~:312–331) → `{outcome:'failed'}` → executor `completeWorkflow(FAILED)` |

## (a) Ordering — handler **before** compensation

The handler is **scheduled before** `compensateWorkflow` runs, inside the same FAILED branch of
`completeWorkflow`, and it receives a `contextSnapshot` captured at that moment (pre-compensation).

Justification from the code, not preference:

1. `completeWorkflow`'s FAILED branch **returns early** after compensation. Any hook placed after it
   would have to live in a second, unrelated code path and would silently not run for the
   compensating case — the exact case where a catch-all handler matters most.
2. Compensation is best-effort (`continueOnError: true`) and its whole block is wrapped in
   `try/catch` that swallows exceptions ("Compensation failed with exception"). A handler placed
   after it would be skipped whenever compensation throws.
3. Compensation mutates external systems and can flip the instance to `COMPENSATED`. A handler is a
   *recovery/notification* construct: it must observe the state **that failed**, not the state after
   rollback. Capturing the snapshot before compensation is the only way to guarantee that.

Ordering is therefore asserted in tests as: `ERROR_HANDLER_SCHEDULED` is logged **before** any
`COMPENSATION_*` event, and the payload's `contextSnapshot` equals the pre-compensation context.

## (b) Durability — queued job, seeded by an in-transaction event

**Rejected:** riding `persistFailedStatusAfterRollback`. Evidence: that fork runs **only** when the
execution transaction throws out of `transactional(...)`. The ordinary failure path
(`completeWorkflow(trx, …, 'FAILED')`) commits normally and never reaches it, so it covers a minority
of failures and would leave the common case unhandled.

**Rejected:** starting the handler inline on the failing `EntityManager`. `startWorkflow` +
`executeWorkflow` write many rows; a handler that itself throws would abort/poison the transaction
that is trying to record the failure — the exact hazard `persistFailedStatusAfterRollback` exists to
repair. It would also hold the instance's `PESSIMISTIC_WRITE` lock for the handler's whole run.

**Chosen:** a new `workflow-activities` queue job `kind: 'workflow_error_handler'`, enqueued from the
FAILED branch of `completeWorkflow` exactly like `enqueueSubWorkflowParentResume` (best-effort,
logged, never masks the original failure), executed by the worker on its **own** EM/connection.
Durability comes in two layers:

- `ERROR_HANDLER_SCHEDULED` is written to `workflow_events` **in the failing transaction**, so the
  intent to run a handler is durable and event-sourced (AGENTS rule 6) even if the enqueue call is
  lost. The job is re-derivable from that row (a future replay/triage surface reads it; Phase 5).
- The queue itself provides at-least-once delivery for the execution.

A crash strictly between the committed FAILED write and the enqueue therefore loses the *execution*
but never the *record*, which is the strongest guarantee available without a transactional outbox
(none exists in this repo). This is stated as a known limitation rather than papered over.

## (c) Recursion guard — instance **metadata**, not context

The handler child is started with `metadata.errorHandler = { depth: n + 1, forInstanceId, forStepId }`
on `WorkflowInstanceMetadata` (additive optional field). Scheduling is skipped when the failing
instance's own `metadata.errorHandler.depth` is `>= WORKFLOW_MAX_ERROR_HANDLER_DEPTH` (= 1).

Metadata, **not** context: `instance.context` is user-writable through
`PATCH /api/workflows/instances/[id]/context` (`updateWorkflowContextScoped`), so a context-carried
depth marker is attacker/author-mutable and the guard would be bypassable. Metadata is engine-owned,
durable, survives restarts, and is already the carrier for the analogous `labels.parentInstanceId`
sub-workflow linkage. Consequence: a handler that designates itself, or a handler that fails, cannot
schedule a second handler — one level, always.

## (d) Branch semantics — only after propagation, never per branch

A failure inside a parallel branch is already funnelled: `advanceBranches` marks the branch FAILED,
cancels siblings, and returns `{outcome:'failed'}`, which the executor turns into a single
`completeWorkflow(FAILED)`. The instance-level handler fires at that one choke point, i.e. **after**
join-failure propagation, exactly once per instance, carrying the failed branch's step as
`failedStepId`. No per-branch invocation: the handler is an instance-level construct with a single
`failedStepId`/`contextSnapshot` triple, and firing it per branch would multiply handlers for one
logical failure.

Per-branch recovery stays with the **step-level error route** (Step 2.6), which `advanceOneBranch`
follows with the branch token (`followBranchErrorRoute`) so a handled branch failure never reaches
the instance at all. Only unhandled branch failures propagate — and those, not the handled ones, are
what the instance-level handler is for. The `failureQueue` directive is deliberately instance-level
and is not honored per branch.

## (e) Ask-First check — additive pre-fail hook only, no state-machine change

This design does **not** change the documented instance or step state machines:

- No new `WorkflowInstanceStatus` or `StepInstanceStatus` value. The §5.9 "parks as ATTENTION"
  wording is implemented as the **existing** `PAUSED` state plus an additive
  `metadata.attention` marker — `RUNNING → PAUSED` is already a documented edge (USER_TASK, SIGNAL,
  TIMER, SUB_WORKFLOW all take it).
- No existing transition is reordered or removed; the handler is a pre-fail **hook** inside the
  already-existing FAILED branch of `completeWorkflow`.
- A failed step instance is **never** flipped `FAILED → COMPLETED`. The `continueWithFallback`
  directive leaves the step FAILED and lets the instance advance, so
  `PENDING → ACTIVE → COMPLETED|FAILED|SKIPPED|CANCELLED` holds verbatim.
- Compensation semantics are unmodified: same LIFO algorithm, same `continueOnError: true`, same
  trigger condition (an instance reaching FAILED). The `failureQueue` directive parks instead of
  failing, so compensation legitimately does not run for a parked instance — that is the directive's
  purpose and it is opt-in per step; every definition without error config keeps byte-identical
  behavior.

⇒ No Ask-First gate is tripped. Proceeding with implementation. Called out in the PR body for review.

## Contract summary implemented in 2.7

- Definition: `errorHandler?: { workflowId, version? } | { stepId }` (additive, optional, exactly one
  form).
  - **`workflowId` form — the catch-all.** Scheduled from the FAILED branch of `completeWorkflow`
    for every instance failure (single-token, transition, and propagated branch failures alike),
    executed by the worker as a handler sub-workflow whose initial context is the triple
    `{ failedStepId, error, contextSnapshot }`.
  - **`stepId` form — in-instance recovery.** Resolved by the 2.6 resolver as the **last** option
    (after per-step error routes and after the step directive, so it is genuinely a catch-all): the
    executor writes `__error`, moves the token to the handler step and executes it — the same
    cursor-jump-plus-`executeStep` shape `resumeBranchAfterActivities` and the timer/signal resumes
    already use, so no transition record is synthesized. A failure of the handler step itself
    resolves to `fail` (the resolver refuses to jump a step to itself), which is the recursion guard
    for this form.
- New workflow events: `ERROR_HANDLER_SCHEDULED`, `ERROR_HANDLER_STARTED`, `ERROR_HANDLER_SKIPPED`.
- New queue job kind: `workflow_error_handler`.
- `WorkflowInstanceMetadata.errorHandler?: { depth, forInstanceId?, forStepId? }`.
