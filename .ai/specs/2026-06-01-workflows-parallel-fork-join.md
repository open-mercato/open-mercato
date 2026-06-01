# SPEC: Parallel Fork / Join for the Workflows Engine

> Status: **Draft — ready for pre-implement** · Date: 2026-06-01 · Scope: OSS
> Module: `packages/core/src/modules/workflows/`
> Related: `.ai/specs/analysis/ROADMAP-workflows-module-development.md` (WF-1, P0),
> `.ai/specs/2026-04-14-code-based-workflow-definitions.md`, `.ai/specs/2026-03-29-workflow-integration-flows.md` (dependent — assumes FORK/JOIN)
> Issue: [open-mercato/open-mercato#2292](https://github.com/open-mercato/open-mercato/issues/2292) — the `PARALLEL_FORK` / `PARALLEL_JOIN` portion (`WAIT_FOR_TIMER` from that issue is already implemented)

## TLDR

`PARALLEL_FORK` / `PARALLEL_JOIN` are declared in `WorkflowStepType` (`data/entities.ts:19-20`)
and documented in `user-guide/workflows/step-types.mdx`, but the engine throws
`STEP_TYPE_NOT_IMPLEMENTED` (`lib/step-handler.ts:341-348`). Any definition that uses parallel
branches fails at runtime.

This spec adds concurrent branch execution via a **multi-token execution model**: a FORK splits
execution into N **persistent branches** (`workflow_branch_instances`) that run **interleaved
under a single lock** (BPMN semantics — no true thread-level concurrency), each with its own
**private context namespace**; a JOIN synchronizes them with **wait-all** semantics and merges
the namespaces back into `instance.context`. A branch can **pause independently** (USER_TASK,
signal, timer, async activity), and the failure of one branch **cancels the siblings** and runs
saga compensation for the whole instance.

## Problem Statement

- A declared-but-unimplemented step type breaks the platform contract: a definition with
  FORK/JOIN passes save-time validation, yet throws `STEP_TYPE_NOT_IMPLEMENTED` at execution.
- The engine is **single-token**: `WorkflowInstance.currentStepId: varchar` (entities.ts:241),
  the `executeWorkflow` loop (workflow-executor.ts:293-476) advances one step and picks **only**
  `validAutoTransitions[0]` (workflow-executor.ts:382). Pauses (`PAUSED`,
  `WAITING_FOR_ACTIVITIES`) and `pendingTransition` live at the instance level.
- Real processes (parallel approvals, concurrent integration calls) are impossible; the
  integration-flows spec explicitly assumes FORK/JOIN are available.

## Goals / Non-Goals

**Goals**
- A working `PARALLEL_FORK` (split into N branches) and `PARALLEL_JOIN` (wait-all synchronization).
- Independent pausing and resumption of a single branch.
- Per-branch context namespacing + deterministic merge at JOIN (no silent key collisions).
- Sibling-branch cancellation on failure + whole-instance compensation.
- Definition validation (FORK↔JOIN pairing, ≥2 branches, convergence to JOIN).
- Full event sourcing + unit + integration coverage.

**Non-Goals (this iteration)**
- **Nested FORK** (a fork inside another fork's branch) — the entity carries `parentBranchId`,
  but the validator **rejects** nesting; enabling it is a separate phase.
- **wait-N / quorum / discriminator** semantics — wait-all only.
- **first-completed / race** and automatic cancellation on partial-condition satisfaction
  (outside the failure path).
- Visual-editor authoring — see Phase 4 (may be split into a separate spec).

## Resolved Design Decisions (gate resolved)

| Decision | Choice | Consequence |
|---|---|---|
| Concurrency model | **Persistent branches** (table `workflow_branch_instances`) | Branches are first-class entities; a known list for cancellation and synchronization |
| Execution | **Interleaved under a lock (BPMN)**, not thread-parallel | No memory races; advance one branch at a time within the transaction |
| JOIN semantics | **wait-all only** | JOIN proceeds once all branches are terminal (COMPLETED) |
| Pausing in a branch | **Independent** (USER_TASK / signal / timer / async) | Resume must target the branch, not the instance |
| Branch context | **Namespace per branch**, merge at JOIN | No collisions; deterministic merge + optional `outputMapping` |
| Branch failure | **Cancel siblings** + instance compensation | Saga LIFO over instance events (already instance-scoped) |

## Proposed Solution

### Conceptual model — tokens

We introduce an **execution token** abstraction. A token is a "cursor" holding `currentStepId`,
`context`, `status`, `pendingTransition`. Today exactly one token exists = the `WorkflowInstance`
itself. After this change:

- **Root token** = `WorkflowInstance` (as today, when there are no active branches).
- **Branch token** = `WorkflowBranchInstance` (after a FORK; the root token "sleeps" until JOIN).

The execution loop operates over *active tokens*. With no FORK, behavior is 1:1 with the current
engine (zero behavioral change — critical for BC).

```
RUNNING (root token at FORK)
        │ FORK: create N branch tokens, root token → FORKED state (dormant)
        ▼
  ┌───────────────┬───────────────┐
  ▼               ▼               ▼
branch A         branch B        branch C
currentStepId    currentStepId   currentStepId
status ACTIVE    status PAUSED   status COMPLETED(@JOIN)
namespace{...}   namespace{...}  namespace{...}
  └───────────────┴───────────────┘
        │ when ALL branches COMPLETED@JOIN (wait-all)
        ▼ merge namespaces → instance.context; root token → currentStepId = step after JOIN
RUNNING (root token continues single-token)
```

### Data Model — new `WorkflowBranchInstance` entity

New table `workflow_branch_instances` (entities.ts), scoped per tenant/org:

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | |
| `workflow_instance_id` | uuid (FK by id, fetch-by-id) | Parent instance |
| `fork_step_id` | varchar(100) | The FORK step that created the branch |
| `join_step_id` | varchar(100) | The paired JOIN the branch converges to |
| `branch_key` | varchar(100) | = `transitionId` of the FORK's outgoing transition (stable branch identifier) |
| `parent_branch_id` | uuid null | For nesting (always null this iteration; validator blocks it) |
| `current_step_id` | varchar(100) | The branch token's position |
| `status` | varchar(30) | `ACTIVE \| PAUSED \| WAITING_FOR_ACTIVITIES \| COMPLETED \| FAILED \| CANCELLED` |
| `context_namespace` | jsonb | The branch's private write scope |
| `pending_transition` | jsonb null | Per-branch equivalent of `instance.pendingTransition` (async) |
| `error_message` / `error_details` | text / jsonb null | |
| `started_at` / `completed_at` | timestamptz | |
| `tenant_id` / `organization_id` | uuid | Scoping (NEVER cross-tenant) |
| `created_at` / `updated_at` | timestamptz | |

Indexes: `(workflow_instance_id, status)`, `(workflow_instance_id, fork_step_id)`, `(tenant_id, organization_id)`.
No cross-module ORM relations (everything here is within workflows — allowed); FK by id.

**`WorkflowInstance`** — additive (nullable, no change to existing columns):
- new status `FORKED` in `WorkflowInstanceStatus` (root token dormant while branches run).
- (optional) `active_fork_step_id varchar null` — which FORK is open (helps UI and re-fork validation).

**`UserTask`** and **`WorkflowEvent`** — add `branch_instance_id uuid null` (additive), so resume
and the timeline know which branch an event/task belongs to.

**Migration:** update `data/entities.ts`, run `yarn db:generate`, keep only the SQL for this
change, update `migrations/.snapshot-open-mercato.json` in the same commit (per
`packages/core/AGENTS.md` → Entity Schema And Migration Workflow). Do not run `yarn db:migrate`.

### Definition schema — FORK/JOIN config + validation

`workflowStepSchema` (`data/validators.ts`) — add optional configs:

```ts
// on a PARALLEL_FORK step:
config: { joinStepId: string }                 // required for FORK
// on a PARALLEL_JOIN step:
config: { forkStepId: string,                  // required for JOIN (back-reference pairing)
          outputMapping?: Record<string,string> } // optional namespace→top-level lift
```

Definition validation (extend save-time validation / `start-validator` — fail-closed):
1. Every FORK has `config.joinStepId` pointing to an existing JOIN step; the JOIN has a back-reference `config.forkStepId`.
2. A FORK has **≥2** outgoing transitions (`trigger: 'auto'`); a JOIN has **≥2** incoming transitions.
3. Every path from a FORK **converges** to its JOIN (graph analysis; no path bypassing the JOIN, no END inside a branch).
4. **No nesting** this iteration: no path between a FORK and its JOIN contains another FORK → validation error `NESTED_FORK_NOT_SUPPORTED`.
5. No FORK↔JOIN cycles; `branch_key` (transitionId) unique within a fork.

### Execution model — interleaved loop (token-aware)

Internal refactor (lib, not public DI): extract a **token abstraction** — `step-handler` and
`transition-handler` operate on a token object (`currentStepId`, `context`, `status`,
`pendingTransition`) instead of directly on `WorkflowInstance`. The root token is an adapter over
the instance (zero behavioral change without FORK). The public DI method signatures
(`workflowExecutor.startWorkflow`, `executeWorkflow`, `resumeWorkflowAfterActivities`) stay
backward-compatible; we add new branch-aware functions.

`executeWorkflow` (workflow-executor.ts) — new logic inside the existing transaction + pessimistic lock:

```
1. Load instance (lock).
2. If instance has NO active branches (status != FORKED):
     → behave as today (root token), UNTIL it hits a FORK step (see FORK handler).
3. If instance is FORKED:
     → interleaved loop: for each branch with status=ACTIVE, advance ONE step
       (same logic as today, but on the branch token: enterStep/executeStep/transition).
     → branch at its JOIN: status=COMPLETED (do not execute past JOIN), check wait-all.
     → pausing branch: status=PAUSED/WAITING_FOR_ACTIVITIES (store branch.pendingTransition), does not block siblings.
     → FAILED branch: cancel siblings + completeWorkflow(FAILED) (compensation).
     → when ALL branches COMPLETED@JOIN → fire the JOIN (merge + resume root token).
     → when no branch is ACTIVE (all PAUSED/WAITING) → return RUNNING (instance waits for external resume).
```

`maxIterations` (today 100) counted per loop pass; guards against infinite loops in interleaved mode too.

### FORK handler (`step-handler.ts`)

On entering a `PARALLEL_FORK` step:
1. Collect **all** outgoing `auto` transitions from the fork (not `[0]`).
2. For each: create a `WorkflowBranchInstance` (`fork_step_id`, `join_step_id` from `config.joinStepId`,
   `branch_key=transitionId`, `current_step_id` = the transition's `toStepId`, `status=ACTIVE`,
   `context_namespace = {}`). Run the fork transition's activities in the branch's context (sync/async as usual).
3. `instance.status = 'FORKED'`, `instance.active_fork_step_id = forkStepId`.
4. Log `PARALLEL_FORK_OPENED` (eventData: forkStepId, joinStepId, branchKeys[]).

The branch's effective **read-context** = `{ ...instance.context (snapshot at fork time), ...branch.context_namespace }`.
Branch writes go **only** to `branch.context_namespace`.

### JOIN handler + synchronization (wait-all)

When a branch reaches its `join_step_id`:
1. Branch → `status=COMPLETED`, `completed_at` set; it does **not** execute the step after JOIN.
2. Check all branches of this fork: if **every** one is COMPLETED → the JOIN "fires".
3. **Merge namespaces** into `instance.context`:
   - deterministically: `instance.context.branches[branchKey] = branch.context_namespace` (no silent collisions),
   - then optional `joinStep.config.outputMapping` (path → top-level) to deliberately lift selected values.
4. `instance.status='RUNNING'`, `instance.active_fork_step_id=null`, `instance.currentStepId = <step after JOIN>`
   (the single outgoing transition from JOIN). Keep/archive branch tokens (they remain in the table as audit, status COMPLETED).
5. Log `PARALLEL_JOIN_COMPLETED` (eventData: forkStepId, mergedBranchKeys[]).
6. Continue the normal single-token loop.

### Per-branch pause/resume

Every resume path must distinguish **root token** vs **branch token** (by `branchInstanceId`):

| Trigger | Today | After change |
|---|---|---|
| USER_TASK complete (`api/tasks/[id]/complete`) | resumes the instance | if `UserTask.branch_instance_id` is set → resume the branch; otherwise the instance |
| Signal (`signal-handler`) | instance | targets the branch awaiting the signal (by branchInstanceId/stepInstance) |
| Timer (`timer-handler`, job payload) | instance | the job payload carries `branchInstanceId` → `fireTimer` resumes the branch |
| Async activity (`resumeWorkflowAfterActivities`) | instance, one `pendingTransition` | per-branch `pending_transition`; worker payload carries `branchInstanceId` |

Branch resume pattern: set branch `status=ACTIVE`, restore `pending_transition` (if async), then
re-enter `executeWorkflow` (FORKED mode) — the interleaved loop finishes synchronization. If
resuming the branch makes it the last one reaching the JOIN → the JOIN fires in the same pass.

### Branch failure and compensation

When a branch → `FAILED`:
1. All siblings of this fork with `status ∈ {ACTIVE, PAUSED, WAITING_FOR_ACTIVITIES}` → `CANCELLED`
   (log `PARALLEL_BRANCH_CANCELLED` per branch; cancel related open `UserTask`/timers best-effort).
2. `instance.status='FAILED'` + `completeWorkflow(FAILED)`. Compensation works unchanged:
   `compensateWorkflow` walks LIFO over the **instance's** `ACTIVITY_COMPLETED` events (entities are
   instance-scoped, so it covers activities run across all branches). LIFO by `occurredAt` is correct
   even for activities from different branches.
3. Log `PARALLEL_FORK_FAILED`.

### New events (`events.ts`, `as const`)

Add (additive, non-breaking):
`workflows.branch.opened`, `workflows.branch.completed`, `workflows.branch.cancelled`,
`workflows.branch.failed`, `workflows.join.completed`.
Plus internal event-sourcing types (`WorkflowEvent.eventType`): `PARALLEL_FORK_OPENED`,
`PARALLEL_BRANCH_COMPLETED`, `PARALLEL_BRANCH_CANCELLED`, `PARALLEL_JOIN_COMPLETED`, `PARALLEL_FORK_FAILED`.
Run `yarn generate` after changing `events.ts`.

## Backward Compatibility

- All schema changes are **additive** (new table, nullable columns, new `FORKED` status). No changes
  to existing columns/types. See `BACKWARD_COMPATIBILITY.md` (DB schema = ADDITIVE-ONLY).
- Public DI methods (`workflowExecutor.*`) keep their signatures; the token abstraction is an internal refactor.
- Definitions without FORK/JOIN execute **bit-identically** (root token = the old path). This is a hard
  requirement and a checkpoint in tests (regression of existing TC-WF-001..013).
- New fields in `events.ts` and new event types are additive (event IDs = ADDITIVE-ONLY).

## Visual Editor (Phase 4 — may be split out)

- React Flow nodes `ParallelForkNode` / `ParallelJoinNode` (`components/nodes/`), registration in the
  node-type map, icons (`lib/node-type-icons.ts`), status colors via semantic tokens (DS: zero hardcoded colors).
- Editor: adding branches (multiple edges from FORK), pairing FORK↔JOIN, in-UI validation with clear errors
  (`NESTED_FORK_NOT_SUPPORTED`, no convergence to JOIN).
- Instance viewer: visualize parallel branches and their statuses (per-branch timeline, `branch_instance_id` on events).
- i18n (en/es/de/pl) under `workflows.stepTypes.*`, `workflows.parallel.*`.

## Phasing & Steps

**Phase 1 — Data model + validation**
1. `WorkflowBranchInstance` entity + nullable additions (`UserTask.branch_instance_id`, `WorkflowEvent.branch_instance_id`, instance `FORKED`/`active_fork_step_id`). Migration + snapshot.
2. FORK/JOIN config schema in `validators.ts` + pairing/convergence/no-nesting validation. Unit tests for validation.

**Phase 2 — Engine (token abstraction)**
3. Refactor `step-handler`/`transition-handler` to the token abstraction; root-token adapter. TC-WF-001..013 regression must pass unchanged.
4. FORK handler (branch creation, fork activities, FORKED status).
5. Interleaved loop in `executeWorkflow` (advance branches, detect pause/failure).
6. JOIN handler (wait-all, namespace merge + outputMapping, root-token resume). Unit tests: 2- and 3-branch happy path, merge, outputMapping.

**Phase 3 — Pause, resume, failure**
7. Per-branch resume: USER_TASK, signal, timer, async activity (job payloads + `branch_instance_id`).
8. Branch failure → sibling cancellation + instance compensation. Unit tests + saga.
9. Events (`events.ts` + event-sourcing types), `yarn generate`. Base i18n.

**Phase 4 — Visual editor (optionally a separate spec)**
10. FORK/JOIN nodes, branch authoring, in-UI validation, per-branch instance viewer, full i18n, DS compliance.

## Integration & Test Coverage

New integration specs `__integration__/TC-WF-014..` (self-contained: fixtures created in setup via API, cleanup in teardown — `.ai/qa/AGENTS.md`):
- **TC-WF-014** FORK→2 AUTOMATED branches→JOIN wait-all, completed, namespace merge.
- **TC-WF-015** FORK with a USER_TASK branch: one branch PAUSED, the other proceeds; completing the task resumes the branch; JOIN fires.
- **TC-WF-016** FORK with an async-activity branch (queue) + per-branch resume; JOIN after the job completes.
- **TC-WF-017** Failure in one branch → siblings CANCELLED, instance FAILED, LIFO compensation spans activities from both branches.
- **TC-WF-018** Validation: missing `joinStepId` / nested FORK / path bypassing JOIN → definition save error.
- **TC-WF-019** Regression: an existing FORK-less definition executes identically (root token).
- **TC-WF-020** Tenant scoping: branches/tasks/events never cross-tenant.

API surface to cover: `POST /api/workflows/instances` (start), `instances/[id]` (detail with branches),
`instances/[id]/advance`, `tasks/[id]/complete` (branch-aware), `instances/[id]/signal` (branch-aware),
`POST /api/workflows/definitions` (FORK/JOIN validation).

## Risks & Failure Scenarios

| Risk | Mitigation |
|---|---|
| Token-abstraction refactor breaks existing paths | TC-WF-001..013 as a regression gate; 1:1 root-token adapter |
| Context key collisions between branches | Namespacing `context.branches[branchKey]`; no implicit top-level; explicit `outputMapping` |
| JOIN deadlock (a branch never arrives) | Convergence validation; FAILED/CANCELLED branch counts as terminal with whole-instance failure |
| Resume hits the wrong branch | `branch_instance_id` on UserTask/WorkflowEvent/job payloads; tests TC-WF-015/016 |
| Double JOIN firing (concurrent resume) | Pessimistic lock on the instance + transaction; wait-all counted under the lock |
| Nested FORK slipping through | `NESTED_FORK_NOT_SUPPORTED` validator fail-closed; TC-WF-018 |
| Orphaned tasks/timers after branch cancellation | Best-effort cancellation + log; does not block completeWorkflow(FAILED) |

## Open Follow-ups (out of scope)

- Nested FORK (`parent_branch_id` already in the model).
- wait-N / quorum / discriminator (Q2 — deferred).
- Per-branch analytics (ties into WF-3 from the roadmap).

## Changelog

### 2026-06-01
- Open Questions gate resolved (persistent-branch model, BPMN-interleaved, wait-all, independent pauses,
  namespace+merge, sibling cancellation). Added full design, phasing, BC, tests, and risks. Skeleton → Draft.
- Translated to English.
