# SPEC: `WAIT_FOR_CONDITION` Step Type for the Workflows Engine

> Status: **Draft** · Date: 2026-07-20 · Scope: OSS
> Module: `packages/core/src/modules/workflows/`
> Related: `.ai/specs/implemented/2026-06-01-workflows-parallel-fork-join.md` (branch tokens, `resumeBranch`),
> `.ai/specs/2026-03-29-workflow-integration-flows.md` (template for extending the action/step surface),
> `packages/core/src/modules/business_rules/lib/expression-evaluator.ts` (condition language)

## TLDR

Add a `WAIT_FOR_CONDITION` step type that pauses a workflow (or a single parallel branch) until a
**boolean condition over the run context** becomes true — the generalisation of "wait until context
variable `X` is set". The condition reuses the **existing** `ConditionExpression` language and
`ruleEvaluator.evaluateConditions`, the same evaluator that already backs transition conditions.
Resume is **event-driven first** (a scoped context-write endpoint wakes matching waiters) with a
**delayed-job poll as the durability backstop**, reusing the `WAIT_FOR_TIMER` queue machinery.

**No database migration is required** — `step_instances.step_type` is `varchar(50)`
(`data/entities.ts:426-427`) and the step type otherwise lives in the definition JSON.

## Overview

Today the engine can pause for a **timer** (`WAIT_FOR_TIMER`), a **named signal**
(`WAIT_FOR_SIGNAL`), a **human** (`USER_TASK`), and **async activities**. It cannot pause for a
*state predicate*. This spec adds that fourth wait primitive without touching any existing state
machine.

## Problem Statement

1. **No way to wait on state, only on named events.** `WAIT_FOR_SIGNAL` requires the producer and
   the workflow author to agree on a signal name up front. When the value can be written by several
   different producers (an async activity result, a sibling parallel branch, an external system, a
   back-office edit), there is no single signal name to wait for — only a resulting context value.
2. **Parallel branches cannot synchronise below `PARALLEL_JOIN` granularity.** `PARALLEL_JOIN` is
   wait-all over *whole branches*. A branch that needs one value produced by a sibling must today
   wait for the sibling to finish entirely.
3. **Modelling it as an action is not possible without a contract change.** `ActivityExecutionResult`
   has no `WAITING` state; only `StepExecutionResult` does
   (`lib/step-handler.ts`, `{ status: 'WAITING', waitReason }`). Suspension is strictly a step-type
   capability. Adding suspension to activities would change the activity state machine, which
   `workflows/AGENTS.md` § Ask First explicitly gates.
4. **Polling in user-land is the current workaround** and it is bad: authors build a
   `WAIT_FOR_TIMER` → `AUTOMATED` (re-read) → conditional-transition loop back to the timer. That
   produces one `StepInstance` row and several `workflow_events` rows per tick, pollutes the
   instance timeline, and has no timeout semantics.

## Goals / Non-Goals

**Goals**
- A `WAIT_FOR_CONDITION` step that pauses until a context predicate holds.
- Reuse of the existing condition language and evaluator — **no second expression dialect**.
- Event-driven wake-up on context write, with a delayed-job poll as the durability backstop.
- Mandatory timeout with an explicit `FAIL` / `CONTINUE` outcome so a run can never hang forever.
- Branch-aware: works inside a `PARALLEL_FORK` branch and resumes only that branch.
- Full event sourcing, unit + integration coverage.

**Non-Goals (this iteration)**
- Cross-instance conditions (waiting on *another* workflow's context) — use `WAIT_FOR_SIGNAL`.
- Conditions over data outside the run context (direct DB/entity queries). The predicate reads
  context only; an `AUTOMATED` step can fetch data into context first.
- A generic per-activity-type config form generator (a real gap — see § Deferred, tracked separately).
- Changing the activity (`ActivityType`) surface at all.

## Resolved Design Decisions

| Decision | Choice | Consequence |
|---|---|---|
| Step type vs. action | **Step type** | Only `StepExecutionResult` can express `WAITING`; the activity state machine is untouched (no "Ask First" gate tripped) |
| Condition language | **Reuse `ConditionExpression`** (`SimpleCondition \| GroupCondition`) | Zero new syntax; the visual editor's existing condition builder is reusable; no `eval` |
| Evaluator | **`ruleEvaluator.evaluateConditions`** | Same code path as transition conditions (`transition-handler.ts:707`) |
| Primary resume | **Event-driven on context write** | No queue job per tick in the common case |
| Backstop resume | **Delayed job, new queue `kind: 'condition'`** | Survives a missed wake; reuses `WAIT_FOR_TIMER` machinery end-to-end |
| Timeout | **Mandatory**, validated at save time | A typo in a field path can never hang a run forever |
| Timeout outcome | `onTimeout: 'FAIL' \| 'CONTINUE'` | `CONTINUE` sets `outputData.timedOut`, so transitions can branch on it |
| DB schema | **No migration** | `step_type` is `varchar(50)`; step type lives in definition JSON |

### Rejected alternative: activity type `WAIT_FOR_CONTEXT`

Closer to the original framing ("add it to the Automated step's Actions") and cheaper in isolation
(a case in `activity-executor.ts`, a case in `activity-worker-handler.ts`, three UI lists), but
rejected because:
- it requires extending `ActivityExecutionResult` with a suspend signal and teaching
  `handleAutomatedStep` and `executeTransitionForToken` to propagate it — an **activity state machine
  change**, gated by `workflows/AGENTS.md` § Ask First;
- a step that can hang for hours would render in the graph as an instantaneous `AUTOMATED` node,
  making stuck runs undiagnosable from the visual editor;
- retry/compensation semantics for a suspending activity are undefined (does `retryPolicy` re-arm
  the wait? does `compensate` fire on timeout?);
- it burns one queue job per poll with no event-driven path.

## Proposed Solution

### Step configuration

```jsonc
{
  "stepId": "wait_for_payment",
  "stepName": "Wait for payment confirmation",
  "stepType": "WAIT_FOR_CONDITION",
  "config": {
    // Reuses ConditionExpression — identical shape to transition `condition`.
    "condition": {
      "operator": "AND",
      "rules": [
        { "field": "payment.status", "operator": "==", "value": "captured" },
        { "field": "payment.amount", "operator": ">=", "valueField": "order.total" }
      ]
    },
    "timeout": "PT30M",          // REQUIRED, ISO 8601 duration
    "onTimeout": "CONTINUE",     // 'FAIL' (default) | 'CONTINUE'
    "pollIntervalMs": 30000      // optional, default 30000, clamped (see below)
  }
}
```

The "wait for context variable" shorthand is just the degenerate case:

```jsonc
"condition": { "field": "invoiceId", "operator": "IS_NOT_EMPTY", "value": null }
```

Operators come from `comparisonOperatorSchema` (`business_rules/data/validators.ts:28-45`):
`=`, `==`, `!=`, `>`, `>=`, `<`, `<=`, `IN`, `NOT_IN`, `CONTAINS`, `NOT_CONTAINS`, `STARTS_WITH`,
`ENDS_WITH`, `MATCHES`, `IS_EMPTY`, `IS_NOT_EMPTY`. There is **no null-specific operator** —
`IS_NOT_EMPTY` is the idiom for "variable is set", and it also rejects `''` / `[]`. If a workflow
must distinguish "unset" from "empty", that gap needs a new operator in the business-rules module
(out of scope here; call it out during implementation if a real case appears).

`field` paths resolve against the **token read context** — for a root token
`instance.context`, for a branch token `{...instance.context, ...branch.contextNamespace}`
(`lib/execution-token.ts` → `tokenReadContext`). This is the same merge the branch's activities
already see, so the semantics need no new explanation for authors.

### Execution flow

```
enterStep(WAIT_FOR_CONDITION)
        │
        ▼
  evaluate condition against tokenReadContext(token)
        │
   ┌────┴────┐
 true       false
   │          │
   │          ▼  compute deadlineAt = now + timeout
   │          │  log CONDITION_AWAITING
   │          │  token.status = PAUSED
   │          │  enqueue delayed job {kind:'condition'} at min(pollInterval, remaining)
   │          ▼  return { status:'WAITING', waitReason:'CONDITION' }
   │
   ▼ log CONDITION_MET
 return { status:'COMPLETED', outputData:{ conditionMet:true, evaluations:1, waitedMs:0 } }
```

Two things can wake a paused waiter:

**(a) Event-driven — the fast path.** A scoped context write calls
`conditionHandler.wakeConditionWaiters(...)`, which re-evaluates every token in the instance parked
at a `WAIT_FOR_CONDITION` step. On a hit it exits the step and drives the workflow forward. On a
miss it is a no-op (the pending poll job still stands).

**(b) Delayed job — the backstop.** The worker dispatches `kind: 'condition'` to
`conditionHandler.evaluateWaitCondition()`, which mirrors `timer-handler.fireTimer()`:

1. Load + scope the instance; verify it is still `PAUSED` (or the branch is) at a
   `WAIT_FOR_CONDITION` step — otherwise no-op (the event-driven path already resumed it).
2. Evaluate the condition.
3. **Met** → log `CONDITION_MET`, `exitStep`, run auto transitions, `executeWorkflow`.
4. **Not met, before deadline** → log `CONDITION_EVALUATED` (`{met:false, attempt}`), re-enqueue at
   `min(pollIntervalMs, deadlineAt - now)`.
5. **Not met, deadline passed** → log `CONDITION_TIMED_OUT`; `onTimeout: 'FAIL'` → step `FAILED`
   (normal compensation path); `onTimeout: 'CONTINUE'` → `exitStep` with
   `outputData.timedOut = true` and continue.

Branch-scoped waits take the `resumeBranch(...)` path from `parallel-handler.ts`, exactly as
`fireTimer` does for `branchInstanceId` (`lib/timer-handler.ts:60-84`).

Steps 1–2 run inside the existing transaction + pessimistic instance lock, so a concurrent
context write cannot interleave with an evaluation.

### Why both paths

Event-driven alone loses the wait if the waking write happens in a process that never reaches the
wake call (a worker crash between `flush` and wake, a write through a path not yet migrated).
Poll alone costs a job per tick and adds latency equal to the interval. Together: the common case
resumes in milliseconds with zero jobs, and the deadline is still enforced by a job that already
exists for the timeout.

## Architecture

### New / changed files

| File | Change |
|---|---|
| `data/entities.ts:14-23` | Add `WAIT_FOR_CONDITION` to the `WorkflowStepType` union. **No column change.** |
| `data/validators.ts:50-60` | Add to `workflowStepTypeSchema` enum |
| `data/validators.ts:293` | Extend `workflowStepSchema.superRefine` with a `WAIT_FOR_CONDITION` branch (§ Validation) |
| `lib/condition-handler.ts` | **New.** `evaluateWaitCondition()`, `wakeConditionWaiters()`, `ConditionWaitError`. Modelled on `lib/timer-handler.ts` |
| `lib/step-handler.ts:318` | Add `case 'WAIT_FOR_CONDITION'` → `handleWaitForConditionStep(em, instance, stepInstance, stepDef, context, branch)` |
| `lib/step-handler.ts` (new fn) | `handleWaitForConditionStep`, modelled on `handleWaitForTimerStep` (`:822`) |
| `lib/activity-queue-types.ts` | Add `WorkflowActivityJobCondition` (`kind: 'condition'`) to the union |
| `lib/activity-executor.ts:245` | Add `enqueueConditionCheckJob()` alongside `enqueueTimerJob()` |
| `lib/activity-worker-handler.ts:40-59` | Add the `kind === 'condition'` dispatch branch |
| `lib/workflow-executor.ts:969` | Add `updateWorkflowContextScoped()` (§ Security). Leave `updateWorkflowContext` untouched for BC |
| `lib/node-type-icons.ts` | `waitForCondition` in `NodeType`, `NODE_TYPE_ICONS` (`Filter`), `NODE_TYPE_COLORS` (`text-primary` — DS token, no hardcoded shade), `NODE_TYPE_LABELS`, both direction maps |
| `lib/graph-utils.ts:459,475` | Add both directions of the node-type ↔ step-type map |
| `components/nodes/WaitForConditionNode.tsx` | **New** React Flow node |
| `components/StepsEditor.tsx:46` | Add to `STEP_TYPES` + condition/timeout inputs |
| `components/NodeEditDialog.tsx`, `NodeEditDialogCrudForm.tsx` | Config fields for the new step type |
| `i18n/{en,es,de,pl}.json` | `workflows.steps.types.WAIT_FOR_CONDITION` + config field labels + error strings |
| `di.ts` | Register `conditionHandler` |
| `api/instances/[id]/context/route.ts` | **New.** `PATCH` — scoped context write + wake (§ API Contracts) |
| `acl.ts` + `setup.ts` | New feature `workflows.instances.update_context` |

### Queue job type

```ts
export interface WorkflowActivityJobCondition extends WorkflowActivityJobBase {
  kind: 'condition'
  stepInstanceId: string
  deadlineAt: string  // ISO 8601 — absolute, so re-enqueues cannot extend the wait
  attempt: number     // 1-based; guards against runaway re-enqueue
}

export type WorkflowActivityJob =
  | WorkflowActivityJobActivity
  | WorkflowActivityJobTimer
  | WorkflowActivityJobCondition
```

`deadlineAt` is **absolute and carried on the job**, not recomputed per tick — otherwise a slow
queue would silently extend the timeout on every hop.

### Validation (save-time, fail-closed)

Extends the existing `workflowStepSchema.superRefine` (`data/validators.ts:293`), mirroring the
`WAIT_FOR_TIMER` branch:

1. `config.condition` is required and MUST parse as a `ConditionExpression`. Reuse
   `validateConditionExpressionForApi` from `business_rules/lib/payload-validation.ts:30` — do not
   hand-roll. It already enforces the safety bounds in risk #7.
2. `config.timeout` is **required** and MUST be a valid ISO 8601 duration (`isValidDurationString`).
3. `config.onTimeout`, when present, MUST be `'FAIL'` or `'CONTINUE'`. Default `'FAIL'`.
4. `config.pollIntervalMs`, when present, MUST be an integer in `[5000, 3600000]`.
5. `pollIntervalMs` MUST NOT exceed the parsed `timeout` (otherwise the first poll lands after the
   deadline and the step degenerates into a plain timer).
6. A `WAIT_FOR_CONDITION` step MUST have ≥1 outgoing transition — same rule the other waiting step
   types already carry.

### Events

`workflow_events.event_type` is a plain `varchar` (`data/entities.ts:584`) — additive, no migration.

| Event | When | `eventData` |
|---|---|---|
| `CONDITION_AWAITING` | Step entered, condition false | `{ stepId, condition, deadlineAt, pollIntervalMs }` |
| `CONDITION_EVALUATED` | Poll tick, still false | `{ stepId, met: false, attempt, nextCheckAt }` |
| `CONDITION_MET` | Condition became true | `{ stepId, attempts, waitedMs, wokenBy: 'context-write' \| 'poll' \| 'immediate' }` |
| `CONDITION_TIMED_OUT` | Deadline passed | `{ stepId, attempts, waitedMs, onTimeout }` |

`CONDITION_EVALUATED` is logged **only on a false poll tick**, never on the event-driven miss path —
otherwise a busy instance would flood its own timeline with one row per unrelated context write.

## Data Models

No new entity, no new column, **no migration**. The feature is entirely definition-JSON +
event-log + queue-payload.

Fields reused:
- `workflow_instances.context` (jsonb) — the predicate's data source for a root token
- `workflow_branch_instances.context_namespace` (jsonb) — overlaid for a branch token
- `step_instances.step_type` (`varchar(50)`) — stores the literal `WAIT_FOR_CONDITION`
- `step_instances.output_data` (jsonb) — `{ conditionMet, timedOut?, attempts, waitedMs }`
- `workflow_instances.status` / `workflow_branch_instances.status` — reuses `PAUSED`, no new value

## API Contracts

### `PATCH /api/workflows/instances/[id]/context` — new

Merges a partial context patch into a running instance and wakes any condition waiters.

```jsonc
// Request
{ "context": { "payment": { "status": "captured", "amount": 4200 } } }

// 200
{ "ok": true, "woken": ["wait_for_payment"], "instanceId": "..." }
```

- Feature: **`workflows.instances.update_context`** (new, `dependsOn: ['workflows.instances.view']`).
  Deliberately *not* folded into `workflows.instances.signal` — writing arbitrary context is a
  strictly broader capability than sending a named signal.
- Tenant/org scoped from the authenticated context, never from the request body.
- Shallow merge, consistent with `updateWorkflowContext`. Reserved keys
  (`__result`, `_pendingAsyncActivities`) are **rejected**, not silently dropped.
- Rejects instances not in `RUNNING`/`PAUSED`/`FORKED`.
- Optimistic locking per `AGENTS.md`: `WorkflowInstance` has `updated_at`; the route wraps the
  mutation with `enforceCommandOptimisticLock` (command/action endpoint, not `makeCrudRoute`).
- Exports `openApi` per `packages/core/AGENTS.md`.
- Wires the mutation guard registry (`runMutationGuards`, operation `update`) per
  `packages/core/AGENTS.md` § API Routes.

### Security note on the existing helper

`getWorkflowInstance(em, instanceId)` (`lib/workflow-executor.ts:940-945`) is
**not tenant-scoped** — it is an internal helper whose callers scope first. `updateWorkflowContext`
(`:969`) builds on it and is therefore also unscoped. The new route MUST NOT call
`updateWorkflowContext`; it calls the new `updateWorkflowContextScoped(em, { instanceId, tenantId,
organizationId, updates })`, which filters on `tenantId`/`organizationId` in the `findOne`. The
legacy function stays as-is for backward compatibility (it is a DI-exposed surface), with an added
JSDoc warning that it performs no scoping.

### Unchanged

No existing endpoint, DI signature, event ID, or step type changes. All additions are additive.

## Backward Compatibility

Per `BACKWARD_COMPATIBILITY.md`, the touched contract surfaces and their treatment:

| Surface | Change | Classification |
|---|---|---|
| `WorkflowStepType` union | New member | **ADDITIVE** — existing definitions unaffected |
| `WorkflowActivityJob` union | New `kind: 'condition'` member | **ADDITIVE** — `kind` is already a discriminator with an `'activity'` default for legacy jobs |
| `stepHandler` / `transitionHandler` DI signatures | None | **FROZEN, preserved** |
| `updateWorkflowContext` | None (new sibling added) | **STABLE, preserved** |
| Event IDs | 4 new `workflow_events.event_type` values | **ADDITIVE** — column is `varchar`, consumers filter by value |
| ACL features | 1 new feature | **ADDITIVE** — added to `setup.ts` `defaultRoleFeatures`, synced via `yarn mercato auth sync-role-acls` |
| DB schema | None | **No migration** |

A definition saved before this change behaves identically. A definition *using*
`WAIT_FOR_CONDITION` fails closed on an older deployment with the existing
`UNKNOWN_STEP_TYPE` error from `executeStepByType`'s `default` branch — the same failure mode
`PARALLEL_FORK` had before it was implemented, and the reason this spec ships the handler and the
type in the same change.

## Risks & Impact Review

| # | Risk | Severity | Area | Mitigation | Residual |
|---|---|---|---|---|---|
| 1 | **Runaway poll loop.** A never-satisfiable condition (typo'd field path) re-enqueues forever, saturating the queue. | High | Queue | Mandatory `timeout` + absolute `deadlineAt` on the job + hard `attempt` cap (`OM_WORKFLOWS_MAX_CONDITION_ATTEMPTS`, default 1000) → forced `CONDITION_TIMED_OUT`. Validator rejects `pollIntervalMs < 5000`. | A pathological definition still costs up to `timeout / pollInterval` jobs. Accepted — bounded. |
| 2 | **Lock contention.** Each poll takes `PESSIMISTIC_WRITE` on the instance row. Many waiters on a hot instance serialise. | Medium | DB | Waits are per-instance, so contention is per-instance, not global. `pollIntervalMs ≥ 5000` floor. Event-driven path means the common case does not poll at all. | Instances with many concurrent branch waiters and a 5s interval will contend. Documented; raise the interval. |
| 3 | **Silent wake miss.** A context write that bypasses the new endpoint never wakes the waiter. | Medium | Correctness | The poll backstop guarantees eventual evaluation within `pollIntervalMs`. Event-driven is an optimisation, never the sole guarantee. | Up to one poll interval of latency. Acceptable by design. |
| 4 | **Cross-tenant context write** via the new endpoint. | High | Security | Scope derived from the authenticated context only; `updateWorkflowContextScoped` filters on `tenantId`+`organizationId`; the unscoped legacy helper is explicitly not used by the route; `orgScopeAssertions` test helper applied. | None if the test lands. **Route test is mandatory, not optional.** |
| 5 | **Condition reads a branch's private namespace and races a sibling.** | Medium | Correctness | Evaluation happens under the instance lock; reads use `tokenReadContext`, which is the same view the branch's own activities see. Documented: a branch cannot observe a sibling's *private* namespace — only merged instance context. | Authors may expect cross-branch visibility. Mitigated by docs + an explicit validator-level note, not by code. |
| 6 | **Worker not running** → every wait hangs until the process starts. | Medium | Ops | Pre-existing for `WAIT_FOR_TIMER`; same failure mode, same remedy (`mercato workflows start-worker`). Event-driven wake works without the worker, so a wait whose condition is met via the endpoint still proceeds. | Timeout enforcement requires the worker. Documented. |
| 7 | **Expression evaluator DoS** via a deeply nested `GroupCondition`. | Low | Availability | `isSafeExpression` (behind `validateConditionExpressionForApi`) already bounds max depth 10, max 50 rules per group, max field-path length 200; reused here unchanged. `testLinearRegex` guards the `MATCHES` operator. | None beyond the existing business-rules surface. |
| 8 | **Timeline flooding** from `CONDITION_EVALUATED` rows. | Low | UX/Storage | Logged only on false *poll* ticks, never on event-driven misses. Bounded by risk #1's attempt cap. | A long wait with a short interval produces up to `attempt`-cap rows. |

## Testing

### Unit — `lib/__tests__/condition-handler.test.ts` (new), `step-handler.test.ts` (extended)
- Condition true at entry → `COMPLETED` immediately, **no queue job enqueued**, `wokenBy: 'immediate'`
- Condition false → `PAUSED`, `CONDITION_AWAITING` logged, job enqueued with correct `deadlineAt`
- Poll tick, still false, before deadline → re-enqueue at `min(pollInterval, remaining)`
- Poll tick, now true → `CONDITION_MET`, `exitStep`, auto transition executed
- Deadline passed, `onTimeout: 'FAIL'` → step `FAILED`
- Deadline passed, `onTimeout: 'CONTINUE'` → `COMPLETED` with `outputData.timedOut === true`
- `deadlineAt` is **not** extended by a slow re-enqueue
- Attempt cap reached → forced timeout
- Instance already resumed (event-driven won the race) → poll job is a **no-op**, not an error
- Branch-scoped wait → `resumeBranch` path, sibling branches untouched
- Nested-group and `is_not_null` (the "wait for variable" shorthand) conditions

### Unit — validators
- Missing `condition` / missing `timeout` → save rejected
- `pollIntervalMs` below floor, above ceiling, or greater than `timeout` → rejected
- Invalid `onTimeout` value → rejected
- Malformed `ConditionExpression` → rejected by the reused business-rules validator

### Unit — regression
- `stepHandler` / `transitionHandler` resolved from DI still accept their legacy instance-based
  signatures (the guard the fork/join spec established)
- A definition with no `WAIT_FOR_CONDITION` step produces a byte-identical execution trace

### API — `api/instances/[id]/context/__tests__/route.test.ts` (new)
- Happy path: patch merges, `woken` lists the resumed step
- **Cross-tenant instance id → 404, never 200** (via `orgScopeAssertions`)
- Missing `workflows.instances.update_context` → 403
- Reserved keys (`__result`, `_pendingAsyncActivities`) → 400
- Instance in `COMPLETED` → 409
- Stale `updated_at` → 409 with the structured optimistic-lock conflict body

### Integration — `__integration__/TC-WF-*.spec.ts`
- Author a `WAIT_FOR_CONDITION` workflow in the visual editor, start it, PATCH context, observe resume
- Timeout path end-to-end with the worker running

## Implementation Phases

**Phase 1 — Engine core.** Type union, validators + `superRefine`, `lib/condition-handler.ts`,
`handleWaitForConditionStep`, step-handler `case`, queue job type, `enqueueConditionCheckJob`,
worker dispatch branch, DI registration. Unit tests. *Ships a working feature usable from JSON
definitions.*

**Phase 2 — Event-driven wake.** `updateWorkflowContextScoped`, `wakeConditionWaiters`,
`PATCH /api/workflows/instances/[id]/context`, ACL feature + `setup.ts` + `sync-role-acls`, route
tests. *Turns the poll into a backstop rather than the only path.*

**Phase 3 — Visual editor.** Node component, icon/colour/label maps, both `graph-utils` direction
maps, `StepsEditor` / `NodeEditDialog*` config fields reusing the existing condition builder, i18n
for all four locales.

**Phase 4 — Docs.** `apps/docs/docs/user-guide/workflows/step-types.mdx` (new section + the summary
table at `:17-19`), and a note in `activities.mdx` clarifying that actions cannot suspend and
pointing at this step type.

Phases 1 and 3 are independently mergeable; Phase 2 depends on Phase 1.

## Deferred / Follow-ups

- **Per-action-type config forms.** Only `WAIT` has purpose-built inputs today
  (`ActivitiesEditor.tsx:276-311`); every other action type falls back to a raw JSON `<Textarea>`
  (`:314-334`, `NodeEditDialog.tsx:1161+`). A `configSchema` → form generator would fix this across
  all action types. Out of scope here; worth its own spec.
- **Stale `AGENTS.md` checklist.** `workflows/AGENTS.md` § "Adding a New Activity Type" step 1 says
  the `ActivityType` enum lives in `data/entities.ts` — it lives in `lib/activity-executor.ts:91`
  and `data/validators.ts:108`. Step 5 names `components/ActivityEditor.tsx`, which does not exist
  (it is `components/ActivitiesEditor.tsx` + `components/fields/ActivityArrayEditor.tsx`). The
  checklist also omits the **second** switch in `lib/activity-worker-handler.ts:85-107`, whose
  omission makes `async: true` throw `Unsupported activity type`. Fix in the Phase 1 PR.
- **Cross-branch condition visibility** — waiting on a sibling branch's private namespace.
- **Condition over entity data** (not just context), via a guarded read.

## Final Compliance Report

*(to be completed at implementation; the gate below is the checklist)*

- [ ] `yarn generate` run after adding the step type
- [ ] No migration generated (verify `yarn db:generate` emits nothing for `workflows`)
- [ ] All queries scoped by `tenant_id` + `organization_id`
- [ ] New ACL feature added to `acl.ts` **and** `setup.ts` `defaultRoleFeatures`; `sync-role-acls` documented
- [ ] `openApi` exported from the new route; mutation guards wired
- [ ] Optimistic locking enforced on the new PATCH route
- [ ] No hardcoded user-facing strings; all four locales populated
- [ ] No hardcoded Tailwind status colours in the new node (DS tokens only)
- [ ] No `any` in new code; zod schemas with `z.infer`
- [ ] Every state change accompanied by a `workflow_events` row
- [ ] DI-signature regression test passes
- [ ] `yarn typecheck && yarn lint && yarn test && yarn build:packages`

## Changelog

- **2026-07-20** — Initial draft. Scope: `WAIT_FOR_CONDITION` step type, event-driven + polled
  resume, mandatory timeout, branch awareness. Rejected the activity-type alternative on
  state-machine grounds.
