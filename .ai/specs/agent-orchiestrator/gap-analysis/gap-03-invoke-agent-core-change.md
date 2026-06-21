# INVOKE_AGENT Core-Workflows Change — Design Analysis

> **Category:** Build · **Gap:** GAP-03 · **Priority:** P0 · **Status:** Recommended
> **Related:** `2026-06-19-agent-orchestration-step-and-proposal.md`, `ADR-001-orchestration-engine.md`, `2026-06-19-agent-dispatch.md`, the core `workflows` module (`packages/core/src/modules/workflows/`)
> **Contract surface:** `workflows` activity-type list — `BACKWARD_COMPATIBILITY.md` §2 (Type Definitions, STABLE) + §8 (Database Schema, ADDITIVE-ONLY)

## 1. Gap statement

The orchestration spine needs a way for a `workflows` process to (1) hand a unit of work to the agent layer via `DispatchService.enqueue`, (2) **park** the instance while the agent runs asynchronously, and (3) **resume** when `agent_orchestrator.proposal.ready {processId, stepId, proposalId}` fires. ADR-001 and the orchestration spec both originally assumed `workflows` exposes a "pluggable activity registry" to register a custom `INVOKE_AGENT` activity. **It does not.** The real activity-type list is a closed union dispatched by a hand-written `switch` in `activity-executor.ts`:

```ts
// packages/core/src/modules/workflows/lib/activity-executor.ts:51
export type ActivityType =
  | 'SEND_EMAIL' | 'CALL_API' | 'EMIT_EVENT' | 'UPDATE_ENTITY'
  | 'CALL_WEBHOOK' | 'EXECUTE_FUNCTION' | 'WAIT'
```

The same seven values are re-declared as a Zod `z.enum([...])` in `data/validators.ts:108` and validated into the persisted `activityType` column. There is **no registry, no plugin seam, no `register(type, handler)`**. So the gap is precisely: *how do agents become a workflow step without inventing a registry that the codebase forbids?*

## 2. Architectural drivers

- **BC / contract stability.** The activity-type union is a contract surface twice over: an exported TS type (§2 STABLE) and a persisted `varchar` enum validated by Zod (§8 ADDITIVE-ONLY). Any first-class change is additive-only, deprecation-protocol-governed, and needs migration + snapshot.
- **`workflows`-team ownership.** `workflows` may be owned by a different team. Editing its enum + executor `switch` + Zod validator + visual `ActivityEditor` + i18n is a cross-team change requiring sign-off — per the module's own "Adding a New Activity Type" 7-step checklist.
- **Time-to-skeleton.** The P0 goal is proving the spine end-to-end *now*. A zero-core-change path unblocks all of `agent_orchestrator` (dispatch, trace, disposition) without waiting on a cross-team contract review.
- **Reusability beyond agents.** A generic async-activity seam (approach c) would benefit any module needing "enqueue → park → resume on signal" (long-running external calls, human-gated jobs), not just agents — a strategic but speculative payoff.
- **Park/resume correctness.** The chosen path MUST use a *real* park state the signal handler can resume. This is the load-bearing question and is verified against the code below.
- **Saga / compensation interaction.** Agent steps sit inside transitions that may carry compensation. The agent enqueue has no DB side effect to compensate (the proposal is inert until disposed), but a parked instance that times out must route to a failure branch, not dangle.

## 3. Approaches considered

### (a) Phase-1 composition — ZERO core change

Model the agent step as two existing activities in one transition: an `EXECUTE_FUNCTION` activity calling `DispatchService.enqueue(...)`, immediately followed by a `WAIT_FOR_SIGNAL` step keyed on `agent_orchestrator.proposal.ready`. No edit to `packages/core/src/modules/workflows`.

**Is (a) actually possible today? — verified YES, with one shaping note:**

- **Does `EXECUTE_FUNCTION` allow calling a DI service?** Yes. `executeFunction()` (`activity-executor.ts:767`) resolves `container.resolve('workflowFunction:<name>')` and calls `fn(args, context)`. `agent_orchestrator` registers a `workflowFunction:agentDispatch` in its `di.ts` that resolves `DispatchService` from the same container and calls `enqueue(...)`. The function returns `{ proposalId, taskId }`, and `executeActivities()` (`:378`) merges any object output back into `workflowContext` under the activity name — so the ids are available to later steps. ✔
- **Does `WAIT_FOR_SIGNAL` exist and park cleanly?** Yes. `handleWaitForSignalStep()` (`step-handler.ts:761`) sets `instance.status = 'PAUSED'`, stamps `pausedAt`, flushes, and returns `{ status: 'WAITING', waitReason: 'SIGNAL' }` to halt the executor. ✔
- **Does it resume cleanly on signal?** Yes. `sendSignal()` (`signal-handler.ts:59`) requires `status === 'PAUSED'`, asserts the current step is `WAIT_FOR_SIGNAL`, matches `signalConfig.signalName` (falling back to `stepId`), merges the signal payload into `instance.context`, exits the step, finds auto-transitions, and calls `workflowExecutor.executeWorkflow(...)`. Branch-scoped resume for `FORKED` instances is also handled. ✔ A subscriber on `agent_orchestrator.proposal.ready` calls `workflowExecutor`/signal-handler with `{ instanceId: processId, signalName: 'agent_orchestrator.proposal.ready', payload: { proposalId } }`.
- **Shaping note (sequencing).** `EXECUTE_FUNCTION` is a *transition activity*; `WAIT_FOR_SIGNAL` is a *step type*. The convention is therefore: an `AUTOMATED` step whose outbound transition runs the `EXECUTE_FUNCTION` (sync, not `async`) enqueue, transitioning into a `WAIT_FOR_SIGNAL` step. Run the enqueue **synchronously** so the proposal task exists before the instance parks — avoid the `async`/queue path here, which targets `WAITING_FOR_ACTIVITIES`, a *different* resume channel (`resumeWorkflowAfterActivities`) than the signal handler.

### (b) First-class `INVOKE_AGENT` activity

Add `'INVOKE_AGENT'` to the `ActivityType` union (`activity-executor.ts`) **and** the Zod enum (`validators.ts`), add a `case 'INVOKE_AGENT'` to `executeActivityByType()` that enqueues the `AgentTask` and drives the step into the same parked wait state the signal resumes, plus migration/snapshot for the `activityType` column, `ActivityEditor` UI, and i18n. Atomic enqueue-and-park; one definition node instead of two.

### (c) Generic extensible activity registry in core `workflows`

Replace the closed `switch` with a registry where any module registers `register('CUSTOM_X', handler)`. Biggest core change; reusable beyond agents. But it *converts a closed contract into an open extension point* — itself a large new contract surface to design, version, and secure (handler discovery, ordering, tenant scoping, failure semantics, visual-editor integration for unknown types). Speculative until a second consumer exists.

## 4. Trade-off matrix

| Dimension | (a) Phase-1 composition | (b) `INVOKE_AGENT` activity | (c) Generic registry |
|---|---|---|---|
| Core `workflows` change | **None** | Additive enum + switch + migration + UI | Large refactor (switch → registry) |
| BC risk | None (new module only) | Low (additive, deprecation-safe) | High (new open contract surface) |
| Workflows-owner sign-off | Not required | Required | Required + design review |
| Time-to-skeleton | **Immediate** | After cross-team review | Slow |
| Authoring ergonomics | 2-node convention (verbose) | 1-node, self-documenting | 1-node + arbitrary types |
| Park/resume correctness | Proven by existing code | Must replicate park state exactly | Must define per-handler |
| Reusability beyond agents | Already general (any DI fn) | Agent-specific | **Maximal** |
| Saga/compensation fit | Standard (transition-level) | Standard | Needs per-handler contract |
| Effort | **S** | **M** | **L** |

## 5. Recommendation

**Sequence: (a) now → (b) when the convention is proven and the workflows owner signs off. Treat (c) as an optional strategic bet, not on the critical path.**

(a) is **confirmed possible against the real code** — `EXECUTE_FUNCTION` resolves DI services, `WAIT_FOR_SIGNAL` parks via `instance.status='PAUSED'`, and `sendSignal` resumes cleanly with payload merge. It unblocks the entire `agent_orchestrator` program with zero contract risk and zero cross-team dependency. (b) is pure ergonomics/atomicity sugar over the identical park/resume machinery — worth doing once there are real definitions to migrate and the owner is engaged, but it is **not** a prerequisite for the spine. (c) trades a safe closed contract for an open one; defer until a second non-agent consumer justifies the new surface. The orchestration spec already encodes exactly this staging (Phases 1 and 5) — this analysis confirms the engineering reality behind it.

## 6. Effort, risks, dependencies

- **Effort:** (a) **S** — one DI-registered `workflowFunction`, one subscriber, one documented definition snippet. (b) **M** — five-step "Adding a New Activity Type" checklist + migration/snapshot + tests. (c) **L** — out of scope for GAP-03.
- **Risks:**
  - *Wrong resume channel* (Med): if the enqueue activity is marked `async`, the instance parks in `WAITING_FOR_ACTIVITIES` and resumes via `resumeWorkflowAfterActivities`, not the signal. Mitigation: run the enqueue **sync**; document it.
  - *Lost `proposal.ready` signal* (Med): a parked instance never resumes. Mitigation: dispatch lease/timeout sweeper (dispatch spec) emits a failure signal / dead-letters; add an optional `signalConfig.timeout` on the `WAIT_FOR_SIGNAL` step routing to a timeout branch.
  - *(b) enum drift* (Low): the union exists in **two** places (`activity-executor.ts` + `validators.ts`) plus the persisted column — all three must move together or Zod rejects valid rows / TS narrows wrongly.
- **Dependencies:** `DispatchService.enqueue` (dispatch spec) is the hard blocker for (a). (b) additionally depends on the **workflows module owner's sign-off** and a migration + `.snapshot-open-mercato.json` for the `activityType` column.

## 7. Concrete deliverables

**(a) Phase-1 — ships first, no core change:**
- `agent_orchestrator/di.ts`: register `workflowFunction:agentDispatch` resolving `DispatchService`; `(args, ctx) => dispatch.enqueue({ capability, contextRef, guardrailSet, timeoutMs, processId: ctx.workflowInstance.id, stepId })` returning `{ proposalId, taskId }`.
- A documented **agent-step definition snippet**: `AUTOMATED` step → transition with a **sync** `EXECUTE_FUNCTION` activity (`functionName: 'agentDispatch'`) → `WAIT_FOR_SIGNAL` step with `signalConfig.signalName = 'agent_orchestrator.proposal.ready'` (optional `timeout` + timeout transition).
- A subscriber on `agent_orchestrator.proposal.ready` that calls the signal handler with `instanceId = processId`, `signalName = 'agent_orchestrator.proposal.ready'`, `payload = { proposalId }`.

**(b) Phase-2 — first-class, contract-governed (after sign-off):**
- **Enum value:** add `'INVOKE_AGENT'` to `ActivityType` (`activity-executor.ts:51`) **and** `activityTypeSchema` (`validators.ts:108`) — additive, no removals/renames.
- **Executor case:** add `case 'INVOKE_AGENT':` to `executeActivityByType()` (`:407`) that calls `DispatchService.enqueue(...)` and signals the step into the parked wait state (the same `instance.status='PAUSED'` + `WAIT_FOR_SIGNAL`-equivalent the signal handler resumes); the `switch` `default` path stays untouched so pre-existing definitions are unaffected.
- **Park-on-QUEUED:** the case returns a result that drives the instance into the signal-wait park (not `WAITING_FOR_ACTIVITIES`), consistent with (a)'s channel.
- **Resume-on-signal contract:** unchanged — `agent_orchestrator.proposal.ready {processId, stepId, proposalId}` resolved by `sendSignal` exactly as in (a).
- **BC tests:** (1) every pre-existing definition + the executor `default` path execute unchanged; (2) the Zod enum accepts `INVOKE_AGENT` and still rejects unknown types; (3) a no-bypass test that an agent never executes an effector directly.
- **Migration:** additive only — the `activityType` column is already `varchar`, so **no DDL is required**; ship a `.snapshot-open-mercato.json` update reflecting the widened enum and run `yarn db:generate` as a diff probe.
- **UI/i18n:** add `INVOKE_AGENT` to `ActivityEditor.tsx` and `workflows.activityTypes` i18n.

### Acceptance

- A definition using the (a) convention runs an internal agent, produces an `AgentProposal`, and resumes on `proposal.ready`; under threshold a `business_rules` VALIDATION rule auto-approves, over threshold it raises a `USER_TASK`.
- The enqueue runs **sync** and the instance parks in `PAUSED` (signal channel), not `WAITING_FOR_ACTIVITIES`.
- A lost signal is recovered by the dispatch sweeper → failure signal / dead-letter; the optional `WAIT_FOR_SIGNAL` timeout routes to a timeout branch.
- (b), when shipped, is strictly additive: all pre-Phase-2 definitions and the (a) convention continue to execute unchanged; BC tests green.

## Changelog

- **2026-06-19:** Initial GAP-03 design analysis. Verified against real `workflows` code that approach (a) is possible today — `EXECUTE_FUNCTION` resolves DI services (`activity-executor.ts:767`), `WAIT_FOR_SIGNAL` parks via `instance.status='PAUSED'` (`step-handler.ts:761`), and `sendSignal` resumes with payload merge (`signal-handler.ts:59`). Quoted the actual 7-value activity-type union from `activity-executor.ts:51` / `validators.ts:108`. Flagged the dual-declaration drift risk and the sync-vs-async resume-channel trap. Recommended (a) → (b) staging with (c) deferred.
