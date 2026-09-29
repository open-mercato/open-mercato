# Workflows — Emit Declared Instance Lifecycle Events

> **Status:** Implemented (core scope, 2026-07-12; paused/resumed + task-assignment deferred) · **Owner:** Patryk Lewczuk (Comerito) · **Created:** 2026-06-26
> **Module:** `workflows` (core) · **Type:** prerequisite enabler (Ask First — core-module change)
> **Unblocks:** Phase B of [`2026-06-25-agent-process-subject-and-caseload-projection.md`](./2026-06-25-agent-process-subject-and-caseload-projection.md) (terminal status, non-agent stage transitions, assignment/SLA filters).

## TLDR

`workflows/events.ts` **declares** `workflows.instance.{created,started,completed,failed,cancelled,paused,resumed}` (with `category: 'lifecycle'`, `as const`), but **no code emits them** — they never reach the event bus. The module instead writes an internal `WorkflowEvent` audit row (`lib/event-logger.ts`) that other modules can't subscribe to. This spec wires the executor's existing lifecycle transitions to **publish the already-declared events** (plus, where the platform models task assignment, a task-assignment/claim signal). It is purely additive (no new IDs, no rename, no payload removal), but it touches a core module, so it is gated behind maintainer sign-off.

## Problem Statement

External modules cannot react to a workflow instance opening, advancing a stage, or reaching a terminal state. The agent-orchestrator Processes projection needs exactly these signals to materialize terminal status, stage transitions on steps that don't invoke an agent, and the assignment/SLA fields behind the `My team` / `Stuck >24h` / `Waiting on you` filters. Today it can only infer state from agent events, which cover the agent steps but not the instance lifecycle. The events to carry these signals already exist in the contract — they are simply not emitted.

## Proposed Solution

At each lifecycle transition the executor already performs (and already logs to `WorkflowEvent`), additionally publish the matching declared module event through the standard event bus, scoped with `tenantId`/`organizationId` and the instance `id`:

| Transition point (existing) | Emit |
|---|---|
| instance created | `workflows.instance.created` |
| run started | `workflows.instance.started` |
| step/stage advanced | `workflows.instance.started` payload carries `stepId`/`stage` (or a dedicated step event if one is later added) |
| completed | `workflows.instance.completed` |
| failed | `workflows.instance.failed` |
| cancelled | `workflows.instance.cancelled` |
| paused / resumed | `workflows.instance.paused` / `…resumed` |

**Payload (additive, all events):** `{ id, tenantId, organizationId, workflowId, version, status, stepId?, stage? }` — enough for a subscriber to update a per-instance projection without reading workflow internals. `persistent: true` so it survives restarts; keep the internal `WorkflowEvent` audit write unchanged (the two coexist — one is audit, one is the bus).

**Task assignment:** if the platform emits/owns a USER_TASK assignment + claim signal, surface `assigneeUserId`/`teamId`/`waitingSince`-relevant fields on it (or add a `workflows.task.assigned` / `…claimed` event) so consumers can mirror assignment. If task assignment is not yet modeled as events, scope that to a follow-up and document the limitation.

## Architecture

- **Emit alongside the existing audit log, not instead of it.** `logWorkflowEvent()` stays; the bus emission is added at the same call sites. No behavior change to workflow execution.
- **Reuse the declared `eventsConfig`.** No new event IDs — the contract already lists them; this only makes them real.
- **Idempotent for consumers.** Lifecycle events are state-transition signals; subscribers must treat them idempotently (a re-delivered `completed` is a no-op).

## Backward Compatibility

Fully **additive** per `BACKWARD_COMPATIBILITY.md`:
- Event IDs already declared in `workflows/events.ts` — emitting them adds no new contract surface (§5). No rename, no removal.
- Payload fields are all new/optional; no existing subscriber breaks (there are none today).
- No DB, API, ACL, or signature change.
The only reason this is "Ask First" is that it modifies a **core** module to serve an enterprise overlay — get maintainer sign-off before implementing.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| Double-emit / event storms on high-frequency step transitions | Medium | Emit instance-level lifecycle only; debounce/collapse rapid step updates; do not emit per-span | Low |
| Consumers assume exactly-once delivery | Medium | Document at-least-once + idempotent-consumer contract | Low |
| Hidden coupling: workflows starts "knowing" about agent processes | Low | Workflows emits generic lifecycle events; it has no agent-orchestrator dependency | Low |

## Integration Coverage

> Location: `packages/core/src/modules/workflows/__integration__/TC-WF-LIFECYCLE-EVENTS-<NNN>.spec.ts`.

| Flow | Must-have test |
|---|---|
| Instance lifecycle emits | Starting, completing, failing, cancelling, pausing/resuming an instance each publishes the matching `workflows.instance.*` event with `{ id, tenantId, organizationId, status }` |
| Audit coexistence | The internal `WorkflowEvent` audit row is still written (no regression) |
| Idempotent consumer | A test subscriber receiving a duplicate `completed` performs the side effect once |
| Tenant scope | Emitted payloads always carry the correct `tenantId`/`organizationId` |

## Final Compliance Report

- **Events:** Declared via `createModuleEvents(... as const)` (already present); now emitted; `yarn generate` after any payload doc change.
- **Architecture:** Cross-module side effects via events (this spec is the enabler); no direct imports.
- **BC:** Additive only — existing declared IDs, new optional payload fields.

## Changelog

- **2026-07-12:** Core scope implemented in `lib/workflow-executor.ts` via a best-effort `emitInstanceLifecycleEvent` helper over the module's `emitWorkflowsEvent` (global-bus emitter, `persistent: true`, payload `{ id, tenantId, organizationId, workflowId, version, status, stepId }`). Emission sites: `startWorkflow` → `created` + `started`; each successful step advance in `executeWorkflow` → `started` with `stepId`/`fromStepId`; `completeWorkflow` → `completed`/`failed`/`cancelled` (including the compensation early-return path, which emits `failed` with the post-compensation status); `persistFailedStatusAfterRollback` → `failed` (its `status !== 'RUNNING'` guard also dedupes re-entry). The internal `WorkflowEvent` audit rows are unchanged; bus failures are logged and never break execution. Unit-tested in `lib/__tests__/instance-lifecycle-events.test.ts` (6 tests: created/started payloads, terminal emits exactly once each, step-advance payload, audit coexistence, failing-bus resilience). **Deferred:** `paused`/`resumed` emission (parking happens at many engine-internal sites across step/signal/task/timer/parallel handlers — per this spec's own storm-risk mitigation, emit instance-level lifecycle only; revisit if a consumer needs park signals), the task-assignment/claim signal (assignment is not modeled as events today — follow-up per §Proposed Solution), and the `TC-WF-LIFECYCLE-EVENTS` Playwright integration specs (unit coverage landed first; author them per §Integration Coverage when the integration env is exercised).
- **2026-06-26:** Initial draft. Prerequisite enabler extracted from the agent-orchestrator Processes-projection analysis: make `workflows` actually emit its already-declared `workflows.instance.*` lifecycle events (and, if modeled, a task-assignment signal) so external read-models can react to instance terminal/stage/assignment transitions.
