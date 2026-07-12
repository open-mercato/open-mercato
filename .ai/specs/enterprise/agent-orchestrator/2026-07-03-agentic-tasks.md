# Agentic Tasks

## TLDR

**Key Points:**
- Adds `AgentTaskDefinition` — a persisted, UI-creatable "launcher" that points at either a single AI agent or a `workflows` definition (which may itself chain multiple `INVOKE_AGENT` steps) — plus `AgentTaskRun`, a unified execution ledger across both target types.
- A task can be triggered manually (backend UI), by an external system (API key), on a schedule (cron), or by a domain event — all four converge on one `run()` path, queued and always-async.
- Every task executes under its own dedicated, auto-provisioned identity (`AgentPrincipal`), never as "whoever clicked the button," so external/scheduled/event triggers have a stable actor to attribute writes to.

**Scope:**
- `AgentTaskDefinition` + `AgentTaskRun` + `AgentTaskEventTrigger` entities, migrations, CRUD API, ACL, events.
- Async run pipeline: `POST /tasks/:id/run` → `agent-task-runs` queue → worker → `agentRuntime.run()` or `workflowExecutor.startWorkflow()`.
- Execution-principal auto-provisioning (reusing the existing agent-identity overlay) and a least-privilege features picker on the Create Task form.
- Cron scheduling (reusing `@open-mercato/scheduler`) and domain-event triggers (mirroring `workflows`' `WorkflowEventTrigger`).
- Cross-module launch: a "Run agentic task" row/bulk action any module's `DataTable` can inject, correlating back to the source record (`sourceEntityType`/`sourceEntityId`).
- A schema-driven input form for that cross-module launch surface specifically (optional `inputSchema` on the definition), reusing the existing OUTCOME JSON-Schema-subset compiler.

**Concerns (if any):**
- Introduces a second, deliberately distinct meaning of "agent task" in this codebase — the unbuilt `agent-dispatch` spec (`.ai/specs/enterprise/agent-orchestrator/next/2026-06-19-agent-dispatch.md`) reserves `AgentTask`/`agent_tasks` for an unrelated external-worker-fleet routing concept. This spec deliberately avoids that name (`AgentTaskDefinition`/`AgentTaskRun`, tables `agent_task_definitions`/`agent_task_runs`) to prevent a future collision.
- Every `AgentTaskDefinition` provisions a real `auth.User`(`kind='agent'`) + `auth.Role` via the existing identity overlay — this is a real resource per task, not free, and needs the same least-privilege discipline any agent principal needs.

## Overview

Open Mercato's `agent_orchestrator` module (`packages/enterprise/src/modules/agent_orchestrator/`) already lets an authenticated backend user run a single AI agent ad hoc (the **Playground**, `/api/agent_orchestrator/agents/:id/run`) and lets an authenticated backend user manually start a `workflows` instance — including one whose definition chains multiple `INVOKE_AGENT` steps across sequential or parallel branches (**Backend → Workflows → Definitions → Start**, `POST /api/workflows/instances`). Both paths already flow through the module's full propose-only pipeline (`AgentRun` → `AgentProposal` → `DispositionService` → effector command), so guardrails, trace capture, evals, and the human-review Caseload all already work for anything an Agentic Task points at.

What doesn't exist is a first-class, named, reusable object a business user (or another system) can point at either of those two targets, save, and re-trigger — with a single run history, without needing to know an agent id or a workflow id, and without needing to hand-author raw JSON every time. This spec adds exactly that thin layer: `AgentTaskDefinition` (the saved pointer) and `AgentTaskRun` (one execution of it), triggerable manually, via API, on a schedule, or by a domain event.

**Target audience**: backend admins/engineers who configure reusable "agentic tasks" once, and either (a) business users in other modules (e.g. a claims handler) who launch a preconfigured task against a specific record, or (b) external systems that call the same task over the API.

**Key benefit**: turns "an agent or a multi-agent workflow that already works" into "a named, governed, self-service capability anyone with the right permission can launch, on demand or automatically" — without duplicating any execution, disposition, or orchestration logic that already exists.

> **Market Reference**: **n8n** (open-source workflow automation, Fair-Code license) models a "Workflow" as a node graph fronted by exactly one of several trigger types — Manual, Webhook, Schedule/Cron, or an app/event trigger — all of which start the same execution. This spec adopts that "N trigger sources converge on one execution" shape (manual / API / schedule / event, §"Architecture"). It deliberately rejects n8n's node-graph-as-the-object model: Open Mercato already has a first-class workflow engine (`workflows`, with its own visual editor and `INVOKE_AGENT` step) — re-implementing a node graph inside `agent_orchestrator` would duplicate that engine. `AgentTaskDefinition` stays a thin **pointer** to an existing agent or an existing workflow definition, never an authoring surface of its own. **Zapier**'s "Zap history" (one row per run, status, replay) informed `AgentTaskRun`'s shape as a flat, queryable ledger rather than a nested trace (the module's existing `AgentRun`/`AgentSpan` trace tree already covers the deep trace; `AgentTaskRun` is the shallow, cross-target-type index over it).

## Problem Statement

1. **No reusable, named launcher.** Running the same agent or workflow repeatedly requires either re-pasting JSON into the Playground (single-agent) or knowing the exact workflow id and re-opening the "Start instance" dialog (multi-agent) every time. Neither is a shareable, permissioned, self-service object.
2. **No unified run history across target types.** An agent-target run's history lives in `agent_orchestrator`'s Runs list; a workflow-target run's history lives in `workflows`' Instances list. There is no single place to see "every time this task ran, and what happened."
3. **No non-human trigger path.** Both existing entry points assume an interactive human session. There is no supported way for an external system to kick off a specific, pre-approved agent/workflow run over the API, nor for a task to run on a schedule or in response to a domain event.
4. **No cross-module self-service launch.** A hackathon-quality precedent already proves the shape is wanted: `apps/mercato/src/modules/claims/backend/claims/sandbox/page.tsx` on the `feat/agentic-claims-branch` branch lets a user pick a workflow and bulk-start instances against selected claim rows — but it is claims-only, module-locked, and does not exist on the branch this spec targets. The underlying need (launch a preconfigured agent/workflow task against a selected business record from any module's list) has no generic home.

## Proposed Solution

Add two core entities — `AgentTaskDefinition` (the saved pointer + config) and `AgentTaskRun` (one execution) — plus a supporting `AgentTaskEventTrigger` for domain-event triggers, entirely inside the existing `agent_orchestrator` module. No new execution engine: every run is still either `agentRuntime.run()` (agent target) or `workflowExecutor.startWorkflow()` (workflow target) — the exact calls the Playground and the workflow "Start instance" dialog already make. `AgentTaskDefinition` only adds: a name, a target pointer, default/schema'd input, a dedicated execution identity, and zero-or-more triggers (schedule, event); `AgentTaskRun` only adds: a denormalized, queryable row per execution, uniform across both target types.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| New entities `AgentTaskDefinition`/`AgentTaskRun`, not the unbuilt dispatch spec's `AgentTask` | Dispatch's `AgentTask` solves external-fleet routing (leases, A2A, pull workers) — a different problem. Reusing the name would collide if dispatch is ever built and confuse two unrelated concepts. |
| `POST /tasks/:id/run` is always async (`202 { taskRunId, status: 'running' }`), for both target types | External callers and scheduled/event triggers have no "wait for the dialog to close" moment; a uniform contract means the UI, an external system, and a cron job all observe completion the same way (event or poll), regardless of how fast the underlying agent call actually is. |
| Execution always happens in a queue worker, never inline in the API handler | Matches `packages/core/AGENTS.md` → Operation Progress: durable/long-running work MUST use `@open-mercato/queue` workers, not survive only in a live HTTP request. Also the only way to make "always async" literally true rather than just a response-shape convention. |
| Every `AgentTaskDefinition` gets a dedicated `executionPrincipalId`, auto-provisioned via the existing `provisionAgentPrincipal()` helper with a synthetic id (`agentDefinitionId: 'task:<taskDefinitionId>'`) | A task can be triggered by an external system's bare API key, which may carry **no** attributable `userId` at all (`resolveApiKeyAuth` only attaches one if the key has `sessionUserId`/`createdBy`). "Run as whoever triggered it" has no answer in that case. Reusing the existing per-agent provisioning path (just with a synthetic id) needs zero new identity code. |
| `AgentTaskRun.triggeredBy` is separate, non-ACL provenance (`user:<id>` / `api_key:<id>` / `schedule:<id>` / `event:<eventName>`) | Decouples "who may ask this task to run" (`agent_orchestrator.tasks.run`, checked identically for a human session or an API key) from "who the task acts as" (always the execution principal). Keeps the audit trail uniform across all four trigger sources. |
| Scheduling reuses `@open-mercato/scheduler`'s `schedulerService.register()`; event triggers mirror `workflows`' `WorkflowEventTrigger` + wildcard subscriber | Both are existing, proven platform primitives — `agent_orchestrator/setup.ts` already registers its own metric-rollup job the same way. No new scheduling or event-matching infrastructure. |
| Optional `inputSchema` (same JSON-Schema subset as agent `OUTCOME.md`) drives a dynamic form **only** on the cross-module launch surface; the task owner's own "Run now" dialog keeps a JSON textarea regardless | Walking through all four trigger sources, only a human at the cross-module launch point (a non-technical end user, e.g. a claims handler) ever hand-types input at the moment of triggering. The admin/engineer "Run now" dialog already has `inputDefaults`/"insert sample"; API, schedule, and event triggers render no form at all. Scoping the new UI work to where it actually earns its cost avoids over-building. |
| Idempotency key on `/run`, unique per `(organizationId, taskDefinitionId)` | External callers retry after network timeouts; without this, a retry double-triggers the task (double `AgentRun`, or worse, a duplicate workflow instance with side effects). |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| A "Save as preset" button on the Playground instead of a new entity | Only covers the single-agent case; doesn't unify run history across target types; doesn't give a single ACL-gated object a business user can point at either an agent or a workflow — which is the literal ask. |
| Run as the triggering human user's own ACL (no dedicated principal) | Breaks for API-triggered runs where the caller's key carries no `userId` at all; also ties task availability to whichever operator happens to hold the right grants, rather than to the task's own least-privilege scope. |
| Build this as the dispatch spec's `AgentTask` (Phase 1, internal-only) | Inherits dispatch's fleet-routing status machine (`queued`/`claimed`/leases) for a problem that has no fleet to route to — a human/system picks one already-known agent or workflow directly. Adds machinery this feature doesn't need. |

## User Stories / Use Cases

- **An operations admin** wants to **save "Deal Health Check" (agent `deals.health_check`) as a named, permissioned task** so that **an ops team member can re-run it on a specific deal without knowing the underlying agent id or pasting JSON.**
- **A claims team lead** wants to **inject a "Run Claims Resolution" action into the Claims list** so that **a claims handler can launch the multi-agent claims workflow directly from a claim row, with the claim id auto-filled and just one extra field (e.g. priority) to fill in.**
- **An external billing system** wants to **call `POST /tasks/:id/run` with an API key** so that **a nightly settlement event in that system can trigger an agentic review task in Open Mercato without a human in the loop.**
- **An admin** wants to **schedule a task to run every morning at 7am** so that **a recurring agentic check (e.g. "flag stalled deals") happens automatically.**
- **An engineer** wants to **see one run-history table for a task**, regardless of whether it targets a single agent or a multi-step workflow, so that **debugging "did this run, and what happened" doesn't require checking two different modules' history pages.**

## Architecture

```
                    ┌─────────────┐   ┌─────────────┐   ┌──────────────┐   ┌───────────────┐
                    │   Manual    │   │  API (key)  │   │  Schedule    │   │ Domain event  │
                    │  (UI Run    │   │  external   │   │  (cron via   │   │ (wildcard     │
                    │   button)   │   │  system     │   │  scheduler)  │   │  subscriber)  │
                    └──────┬──────┘   └──────┬──────┘   └──────┬───────┘   └──────┬────────┘
                           │                 │                 │                  │
                           └────────┬────────┴────────┬────────┴──────────────────┘
                                    ▼                 (all require agent_orchestrator.tasks.run
                          POST /tasks/:id/run           or are module-internal enqueues)
                                    │
                     validate + idempotencyKey dedupe
                     insert AgentTaskRun(status='running')
                     emit task_run.started (clientBroadcast)
                     enqueue { taskRunId } → agent-task-runs queue
                                    │
                          202 { taskRunId, status: 'running' }
                                    │
                                    ▼
                   ┌────────────────────────────────────┐
                   │  worker: task-run-executor          │
                   │  resolve executionPrincipalId       │
                   │  (always the acting identity)       │
                   └───────────────┬──────────────────────┘
                                   │
                targetType='agent'  │  targetType='workflow'
                                   ▼                        ▼
                    agentRuntime.run(...)          workflowExecutor.startWorkflow(...)
                    (same call the Playground        (same call "Start instance" makes;
                     makes) → AgentRun/Proposal        may INVOKE_AGENT once or many times,
                     → disposition, unchanged           park at USER_TASK, resume — all
                                   │                     unchanged workflows engine behavior)
                    update AgentTaskRun              subscriber on workflows.instance.
                    (completed/failed) + emit         completed/failed resolves AgentTaskRun
                    task_run.completed/failed         asynchronously once the instance finishes
```

### Commands & Events

**Commands** (all through the Command pattern per `packages/core/AGENTS.md`; every mutation is undoable except where explicitly noted):
- `agent_orchestrator.agent_task_definition.create` / `.update` / `.delete`
- `agent_orchestrator.agent_task_event_trigger.create` / `.update` / `.delete`
- `agent_orchestrator.agent_task_run.create` — the `/run` side effect (insert row + enqueue). **Not undoable**: triggering a run is an action, not a reversible state change; if the underlying agent/workflow made a mistake, that is corrected through *its own* undo/disposition path (e.g. `AgentProposal` reject, or `workflows` instance cancel), not by "undoing" the trigger. No cancel action ships in v1 — canceling an in-flight `agent`-target run has no meaningful semantics (an LLM call either finished or didn't); canceling a `workflow`-target run already has one, via the existing `workflows.instances.cancel` feature on the underlying instance.

**Events** (`events.ts`, `as const`, `agent_orchestrator.<entity>.<action>`):
- `agent_orchestrator.task.created` / `.task.updated` / `.task.deleted` (CRUD)
- `agent_orchestrator.task_run.started` / `.task_run.completed` / `.task_run.failed` (lifecycle, `clientBroadcast: true`)
- `agent_orchestrator.task_event_trigger.created` / `.updated` / `.deleted` (CRUD)

## Data Models

All entities: MikroORM v7 `/legacy` decorators, explicit `@Property`, `tenant_id` **and** `organization_id` (two-column tenancy per the module's conventions doc), UUID PK (`defaultRaw: 'gen_random_uuid()'`), no cross-module ORM relations (FK ids only).

### AgentTaskDefinition (`agent_task_definitions`) — editable, `updated_at` for optimistic locking

- `id`: uuid (PK)
- `tenant_id`, `organization_id`: uuid
- `name`: varchar(255)
- `description`: text, nullable
- `target_type`: varchar(20) — TS union `'agent' | 'workflow'`
- `target_agent_id`: varchar(150), nullable — the stable `agentId` when `target_type='agent'`
- `target_workflow_id`: varchar(150), nullable — `WorkflowDefinition.workflowId` when `target_type='workflow'` (FK id only)
- `input_defaults`: jsonb, nullable — **encrypted** (see Encryption below)
- `input_schema`: jsonb, nullable — JSON-Schema, restricted to the OUTCOME-compatible subset (`object`/`array`/`string`/`number`/`integer`/`boolean`/`nullable`/`const`)
- `execution_principal_id`: uuid — FK id → `agent_principals`; **mandatory**, auto-provisioned at creation, never null after create
- `schedule_cron`: varchar(100), nullable
- `schedule_timezone`: varchar(64), nullable, default `'UTC'`
- `schedule_enabled`: boolean, default `true`
- `enabled`: boolean, default `true`
- `created_by`: uuid (userId)
- `created_at`, `updated_at`: timestamptz
- `deleted_at`: timestamptz, nullable

Indexes: `(tenant_id, organization_id)`; `(organization_id, target_type)`.

### AgentTaskRun (`agent_task_runs`) — system-transitioned, append-only-after-terminal (mirrors `AgentRun`'s treatment; no user-facing edit form, so no optimistic-lock UI surface)

- `id`: uuid (PK)
- `tenant_id`, `organization_id`: uuid
- `task_definition_id`: uuid — FK id → `agent_task_definitions`
- `target_type`: varchar(20) — denormalized snapshot at trigger time
- `target_agent_id` / `target_workflow_id`: varchar(150), nullable — denormalized snapshot (history survives the definition being edited/deleted)
- `status`: varchar(20) — TS union `'running' | 'completed' | 'failed'`
- `agent_run_id`: uuid, nullable — FK id → `agent_runs`
- `workflow_instance_id`: uuid, nullable — FK id → `workflows` instance
- `input`: jsonb — **encrypted** — the resolved input actually used
- `source_entity_type` / `source_entity_id`: varchar(100)/uuid, nullable — correlates to the triggering business record (e.g. a claim), for cross-module launches
- `triggered_by`: varchar(150) — `'user:<id>'` / `'api_key:<id>'` / `'schedule:<id>'` / `'event:<eventName>'`; provenance only, never an ACL identity
- `idempotency_key`: varchar(200), nullable
- `started_at`: timestamptz, nullable
- `completed_at`: timestamptz, nullable
- `failure_reason`: text, nullable — **encrypted** (may echo back part of a malformed input on validation failure)
- `created_at`: timestamptz

Indexes: `(tenant_id, organization_id)`; `(task_definition_id, created_at)`; `(source_entity_type, source_entity_id)`; **unique** `(organization_id, task_definition_id, idempotency_key)` where `idempotency_key IS NOT NULL`.

### AgentTaskEventTrigger (`agent_task_event_triggers`) — editable, `updated_at` for optimistic locking

- `id`: uuid (PK)
- `tenant_id`, `organization_id`: uuid
- `task_definition_id`: uuid — FK id → `agent_task_definitions`
- `event_pattern`: varchar(255) — e.g. `claims.claim.reported`
- `config`: jsonb, nullable — `{ filterConditions?, contextMapping?, debounceMs?, maxConcurrentInstances? }` (identical shape to `workflows`' `WorkflowEventTriggerConfig`)
- `enabled`: boolean, default `true`
- `priority`: int, default `0`
- `created_at`, `updated_at`: timestamptz
- `deleted_at`: timestamptz, nullable

Indexes: `(tenant_id, organization_id)`; `(task_definition_id)`.

### Encryption (`agent_orchestrator/encryption.ts` additions)

Directly mirrors the module's existing treatment of `agent_run.input`/`.output` (already encrypted — "carry the operator prompt and the model's full response, both PII-bearing"):

```typescript
{
  entityId: 'agent_orchestrator:agent_task_definition',
  fields: [{ field: 'input_defaults' }],
},
{
  entityId: 'agent_orchestrator:agent_task_run',
  fields: [{ field: 'input' }, { field: 'failure_reason' }],
},
```

Reads use `findWithDecryption`/`findOneWithDecryption`; the query engine auto-decrypts on indexed reads.

## API Contracts

All routes under `/api/agent_orchestrator/`. Every route file exports `openApi`; every method exports `metadata` with per-method `requireAuth`/`requireFeatures`.

### List/detail/create/update/delete task definitions

- `GET /tasks` — `makeCrudRoute` list, `indexer: { entityType: 'agent_orchestrator:agent_task_definition' }`. Requires `agent_orchestrator.tasks.view`.
- `GET /tasks/:id` — detail, includes `updatedAt`. Requires `agent_orchestrator.tasks.view`.
- `POST /tasks` — create. Body: `{ name, description?, targetType, targetAgentId?, targetWorkflowId?, inputDefaults?, inputSchema?, scheduleCron?, scheduleTimezone?, scheduleEnabled?, grantedFeatures: string[] }`. Requires `agent_orchestrator.tasks.manage`. Provisions `executionPrincipalId` via `provisionAgentPrincipal` (synthetic id) scoped to `grantedFeatures`; registers the cron schedule if `scheduleCron` is set.
- `PUT /tasks/:id` — update, optimistic-locked on `updatedAt`. Re-scopes the execution principal's role if `grantedFeatures` changed; re-registers/unregisters the schedule if `scheduleCron`/`scheduleEnabled` changed. Requires `agent_orchestrator.tasks.manage`.
- `DELETE /tasks/:id` — soft delete, optimistic-locked. Unregisters any active schedule. Requires `agent_orchestrator.tasks.manage`.

### Run a task

- `POST /tasks/:id/run` — custom write (not `makeCrudRoute`), always async, wired through `validateCrudMutationGuard`/`runCrudMutationGuardAfterSuccess`.
  - Request: `{ input?: Record<string, unknown>, idempotencyKey?: string, sourceEntityType?: string, sourceEntityId?: string }`
  - If `inputSchema` is set on the definition, `input` is validated against it (compiled once to Zod, reusing `lib/sdk/outcomeSchema.ts`'s compiler); a mismatch returns `400` with field-level errors.
  - If `idempotencyKey` is present and already recorded for `(organizationId, taskDefinitionId)`, returns the existing run instead of creating a new one.
  - Response (`202`): `{ taskRunId: string, status: 'running' }`
  - Requires `agent_orchestrator.tasks.run`. Callable by a human session or an `ApiKey` bearer whose granted role includes that feature — no separate machine-auth path.

### Run history

- `GET /task-runs` — `makeCrudRoute` list (read-only), filters: `taskDefinitionId`, `status`, `sourceEntityType`/`sourceEntityId`. Requires `agent_orchestrator.tasks.view`.
- `GET /task-runs/:id` — detail; what the UI polls/subscribes on after a `run` call. Requires `agent_orchestrator.tasks.view`.

### Event triggers (sub-resource CRUD)

- `GET /tasks/:id/event-triggers`, `POST /tasks/:id/event-triggers`, `PUT /tasks/:id/event-triggers/:triggerId`, `DELETE /tasks/:id/event-triggers/:triggerId` — `makeCrudRoute`-style CRUD scoped to a parent definition. Requires `agent_orchestrator.tasks.manage`.

## Internationalization (i18n)

New keys under `agent_orchestrator.tasks.*` in `i18n/<locale>.json` (en/es/de/pl, matching the module's existing locale set): list/create/edit page copy, target-type labels ("Agent" / "Workflow"), run dialog copy, schema-form field labels (derived from `inputSchema` `title`/`description` per field), schedule section copy, event-trigger section copy, run-status labels (`running`/`completed`/`failed`), and error messages (invalid JSON, schema-validation failure, duplicate idempotency key). No hard-coded user-facing strings; server errors surfaced to a user route through `t('agent_orchestrator.errors.<key>')`, internal-only throws prefixed `[internal]`.

## UI/UX

- **`agent_orchestrator/backend/tasks`** (list) — `<DataTable entityId="agent_orchestrator.agent_task_definition" apiPath="/api/agent_orchestrator/tasks" />`: columns `name`, target (`<StatusBadge>`-style badge: "Agent: deals.health_check" / "Workflow: Deal Health Check (Agent)"), `enabled`, last-run status. Row actions: **Run**, Edit, Delete. Sidebar label **"Agentic Tasks"** (not bare "Tasks" — `workflows` already has its own `backend/tasks` for the `USER_TASK` human inbox; different route, but a distinct label avoids operator confusion).
- **Create/Edit** — `<CrudForm>` with `createCrud`/`updateCrud`: `name`, `description`, `targetType` (select), conditional `targetAgentId` (select from `/agents`) or `targetWorkflowId` (select from `/workflows/definitions`), `inputDefaults` (JSON textarea, "insert sample" reusing the target agent's `sampleInput` where available), an optional "Schedule" `<CollapsibleSection>` (`scheduleCron`, `scheduleTimezone`, `scheduleEnabled`), an optional "Event triggers" `<CollapsibleSection>` (add/remove `eventPattern` + `config` rows), and a **"Permissions for this task"** features multi-select that scopes the auto-provisioned `executionPrincipalId`'s role — pre-checked with `workflows.instances.create` when `targetType='workflow'`.
- **Run dialog** — `Cmd/Ctrl+Enter` submit, `Escape` cancel; JSON textarea prefilled from `inputDefaults`; calls `/tasks/:id/run` via `useGuardedMutation(...).runMutation(...)`. Closes immediately on the `202`; the new row appears at the top of the run-history table and live-updates to `completed`/`failed` via the `task_run.*` `clientBroadcast` events (no blocking on the dialog). Clicking a completed row deep-links to the `ProposalCard`/`JsonDisplay` result for an `agent` target, or **Workflows → Instances → :id** for a `workflow` target.
- **Detail page `agent_orchestrator/backend/tasks/:id`** — definition summary, "Run now", `<DataTable>` of `AgentTaskRun` history (`LoadingMessage`/`ErrorMessage` boundaries, `EmptyState` when no runs yet).
- **Cross-module row/bulk action** — an injected `:row-actions`/`:bulk-actions` widget (any host module's `DataTable`) offering the organization's enabled `AgentTaskDefinition`s; selecting one opens a dialog that auto-fills `sourceEntityId` (hidden) and renders `SchemaDrivenTaskInputForm` when `inputSchema` is set (`<FormField label error>`-wrapped inputs, a `select` for `const`-enum strings, nested groups/repeaters for `object`/`array`), falling back to the JSON textarea otherwise. Bulk launches over more than a handful of rows create a `ProgressJob` (`agent_orchestrator.tasks.bulk_run` job type) and a worker loop — **not** a client-side `for` loop over `runMutation` (per `packages/core/src/modules/progress/AGENTS.md`), returning `progressJobId` for `ProgressTopBar` to track.

All status/badge coloring uses DS status tokens (`text-status-*`/`bg-status-*`) — never raw Tailwind shades. All icons via `lucide-react` in page-body UI.

## Configuration

- No new env vars. Scheduling relies on the existing `@open-mercato/scheduler` deployment (BullMQ in `async` mode, polling `LocalSchedulerService` in `local`/dev mode) — a deployment without the scheduler module registered is a safe no-op (mirrors `agent_orchestrator/setup.ts`'s existing best-effort `hasRegistration('schedulerService')` guard); a task with `scheduleCron` set simply never fires until the scheduler is present.

## Dependencies & Prerequisites

- **Identity overlay — SHIPPED on the target branch.** The per-task execution principal reuses `provisionAgentPrincipal` (`lib/identity/agentPrincipalService.ts`) and the `agentRuntime.run(agentId, input, ctx)` `ctx.runAs: { agentUserId, onBehalfOfUserId? }` binding — both already implemented, along with the fail-closed no-bypass flush-time subscriber that engages for any principalled run. No dependency on an unbuilt wave. (The `next/IMPLEMENTATION-TRACE.md` matrix marks identity `⬜ Not started`, but that matrix was generated on `feat/agent-orchestrator-mvp`; identity landed on the current branch — see that file's branch-drift note.)
- **`@open-mercato/scheduler` — already wired.** `agent_orchestrator/setup.ts` already registers a scheduled job via `schedulerService.register()`; scheduling here reuses that exact seam, best-effort behind the existing `hasRegistration('schedulerService')` guard.
- **`workflows.instance.completed` / `.failed` bus emission — HARD PREREQUISITE for the workflow-target path (Phase 3+), NOT met today.** These events are **declared** in `workflows/events.ts` but **never emitted to the event bus** — `workflows/lib/workflow-executor.ts` sets `completedAt`/`failedAt` and writes an internal `WorkflowEvent` audit row, but calls no `.emit(`. The workflow-target completion subscriber (`subscribers/task-run-workflow-resolved.ts`) cannot fire until the core prerequisite spec [`next/2026-06-26-workflows-emit-instance-lifecycle-events.md`] lands. **Consequence: the agent-target phases (1–2) ship with no dependency on this; the workflow-target phase (3) is gated on that prerequisite** — sequence accordingly. A workflow-target `AgentTaskRun` created before the prerequisite lands would be stuck at `'running'`, so the workflow target must not be exposed in the Create form until Phase 3's prerequisite is satisfied.

## Migration & Compatibility

- All net-new tables (`agent_task_definitions`, `agent_task_runs`, `agent_task_event_triggers`) — no changes to any existing schema.
- New API routes under `/api/agent_orchestrator/` — additive only.
- New ACL features (`agent_orchestrator.tasks.view`/`.manage`/`.run`) added to `acl.ts` + `setup.ts` `defaultRoleFeatures`; run `yarn mercato auth sync-role-acls` after merge so existing tenants receive the grants.
- New events (`agent_orchestrator.task.*`, `.task_run.*`, `.task_event_trigger.*`) declared `as const` in `events.ts` — additive.
- No breaking change to any existing contract surface (agent registry, workflow engine, identity overlay are all consumed read-only / via their existing public entry points).
- Run `yarn generate && yarn db:generate` (review generated SQL + update `.snapshot-open-mercato.json`) before `yarn typecheck && yarn lint && yarn test`.

## Implementation Plan

### Phase 1: Core entities, CRUD, identity provisioning
1. `AgentTaskDefinition` + `AgentTaskRun` entities in `data/entities.ts`; Zod schemas in `data/validators.ts`; migration + snapshot update.
2. `encryption.ts` additions (`input_defaults`, `input`, `failure_reason`).
3. `acl.ts` features (`tasks.view`/`.manage`/`.run`) + `setup.ts` `defaultRoleFeatures` + `events.ts` (task CRUD + task_run lifecycle events).
4. `api/tasks/route.ts` (+ `[id]/route.ts`) — `makeCrudRoute` CRUD, `indexer: { entityType: 'agent_orchestrator:agent_task_definition' }`, optimistic-locked update/delete.
5. Execution-principal provisioning: on create, call `provisionAgentPrincipal(container, scope, { agentDefinitionId: 'task:<id>', ... })` scoped to the request's `grantedFeatures`; on update, re-scope the principal's role if `grantedFeatures` changed.
6. Commands: `agent_orchestrator.agent_task_definition.{create,update,delete}` with undo (snapshot-based restore; delete-undo clears `deletedAt` and re-registers any schedule).

### Phase 2: Async run pipeline — `agent` target
1. `agent-task-runs` queue definition (`lib/queue.ts` addition, mirrors the existing `AGENT_ORCHESTRATOR_METRIC_ROLLUP_QUEUE` pattern).
2. `api/tasks/[id]/run/route.ts` — custom write: mutation-guard, idempotency-key dedupe, `inputSchema` validation (when set), insert `AgentTaskRun`, emit `task_run.started`, enqueue, return `202`.
3. `workers/task-run-executor.ts` — `targetType='agent'` branch: resolve `executionPrincipalId` → `agentRuntime.run()`, update `AgentTaskRun`, emit `task_run.completed`/`.failed`.
4. `api/task-runs/route.ts` (+ `[id]/route.ts`) — read-only `makeCrudRoute`.
5. Backend UI: `backend/tasks` list + create/edit `CrudForm` + `backend/tasks/[id]` detail + "Run now" dialog (JSON textarea).

### Phase 3: Async run pipeline — `workflow` target
> **Blocked on the prerequisite** [`next/2026-06-26-workflows-emit-instance-lifecycle-events.md`] (see Dependencies & Prerequisites) — `workflows.instance.completed`/`.failed` are not emitted to the bus today. Do not expose the `workflow` target type in the Create form until that prerequisite has landed and this phase's subscriber is verified firing.
1. (Prerequisite) Land `next/2026-06-26-workflows-emit-instance-lifecycle-events.md` so `workflows.instance.completed`/`.failed` reach the event bus (core-module change, Ask First / maintainer sign-off).
2. Extend `task-run-executor.ts`: `targetType='workflow'` branch → `workflowExecutor.startWorkflow()`.
3. `subscribers/task-run-workflow-resolved.ts` — listens to `workflows.instance.completed`/`.failed`, resolves the matching `AgentTaskRun` by `workflowInstanceId`.
4. UI: target-type picker in Create/Edit; deep link from a workflow-target run row to **Workflows → Instances → :id**.

### Phase 4: Scheduling and event triggers
1. `scheduleCron`/`scheduleTimezone`/`scheduleEnabled` on `AgentTaskDefinition`; wire `schedulerService.register()`/unregister into the create/update/delete commands (best-effort, guarded by `hasRegistration('schedulerService')`).
2. `AgentTaskEventTrigger` entity + CRUD (`api/tasks/[id]/event-triggers/`); `subscribers/task-event-trigger.ts` (wildcard, mirrors `workflows/subscribers/event-trigger.ts`).
3. UI: "Schedule" and "Event triggers" sections in Create/Edit.

### Phase 5: Cross-module launch + schema-driven form
1. Injectable `:row-actions`/`:bulk-actions` widget (task picker + launch dialog), `sourceEntityType`/`sourceEntityId` correlation.
2. `SchemaDrivenTaskInputForm` component, rendering from `inputSchema` (reusing `lib/sdk/outcomeSchema.ts`'s subset→Zod compiler for validation); wired into the cross-module dialog only.
3. Bulk launch via `ProgressJob` (`agent_orchestrator.tasks.bulk_run`) + worker loop, per `packages/core/src/modules/progress/AGENTS.md`.

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `packages/enterprise/src/modules/agent_orchestrator/data/entities.ts` | Modify | Add `AgentTaskDefinition`, `AgentTaskRun`, `AgentTaskEventTrigger` |
| `packages/enterprise/src/modules/agent_orchestrator/data/validators.ts` | Modify | Zod schemas for the three entities + `/run` request |
| `packages/enterprise/src/modules/agent_orchestrator/encryption.ts` | Modify | Add `agent_task_definition.input_defaults`, `agent_task_run.{input,failure_reason}` |
| `packages/enterprise/src/modules/agent_orchestrator/acl.ts` | Modify | `tasks.view`/`.manage`/`.run` |
| `packages/enterprise/src/modules/agent_orchestrator/events.ts` | Modify | `task.*`, `task_run.*`, `task_event_trigger.*` |
| `packages/enterprise/src/modules/agent_orchestrator/setup.ts` | Modify | `defaultRoleFeatures` additions |
| `packages/enterprise/src/modules/agent_orchestrator/lib/tasks/executionPrincipal.ts` | Create | Synthetic-id wrapper over `provisionAgentPrincipal` |
| `packages/enterprise/src/modules/agent_orchestrator/lib/tasks/schedule.ts` | Create | `schedulerService.register()`/unregister wiring |
| `packages/enterprise/src/modules/agent_orchestrator/lib/queue.ts` | Modify | `agent-task-runs` queue definition |
| `packages/enterprise/src/modules/agent_orchestrator/commands/tasks.ts` | Create | Create/update/delete commands + undo |
| `packages/enterprise/src/modules/agent_orchestrator/api/tasks/route.ts` (+ `[id]/route.ts`, `[id]/run/route.ts`, `[id]/event-triggers/**`) | Create | CRUD + run + event-trigger sub-resource routes, each `export openApi` |
| `packages/enterprise/src/modules/agent_orchestrator/api/task-runs/route.ts` (+ `[id]/route.ts`) | Create | Read-only run history |
| `packages/enterprise/src/modules/agent_orchestrator/workers/task-run-executor.ts` | Create | Queue worker — dispatches to `agentRuntime`/`workflowExecutor` |
| `packages/enterprise/src/modules/agent_orchestrator/subscribers/task-run-workflow-resolved.ts` | Create | Resolves `AgentTaskRun` on workflow instance completion/failure |
| `packages/enterprise/src/modules/agent_orchestrator/subscribers/task-event-trigger.ts` | Create | Wildcard subscriber evaluating `AgentTaskEventTrigger` rows |
| `packages/enterprise/src/modules/agent_orchestrator/backend/tasks/**` | Create | List, create/edit, detail, run dialog |
| `packages/enterprise/src/modules/agent_orchestrator/components/SchemaDrivenTaskInputForm.tsx` | Create | Dynamic form from `inputSchema`, used only on the cross-module launch surface |
| `packages/enterprise/src/modules/agent_orchestrator/widgets/injection/agentic-task-launch/**` | Create | `:row-actions`/`:bulk-actions` cross-module launch widget |
| `packages/enterprise/src/modules/agent_orchestrator/migrations/*` | Create | Schema migration + `.snapshot-open-mercato.json` update |
| `packages/enterprise/src/modules/agent_orchestrator/i18n/{en,es,de,pl}.json` | Modify | New `agent_orchestrator.tasks.*` keys |

### Testing Strategy

- Unit: command undo (create/update/delete for both `AgentTaskDefinition` and `AgentTaskEventTrigger`), idempotency-key dedupe, `inputSchema` validation (valid/invalid payloads), executor branch dispatch (`agent` vs `workflow`), wildcard event-trigger matching (`filterConditions`, `debounceMs`).
- Integration (Playwright, `.ai/qa` conventions): see Integration Coverage below.

## Risks & Impact Review

### Data Integrity Failures
- If the API handler crashes after inserting `AgentTaskRun` but before enqueueing the job, the run is stranded at `status='running'` forever with no worker ever picking it up. **Mitigated** by inserting the row and enqueueing the job inside the same command/transaction boundary (`withAtomicFlush` or `runCrudCommandWrite`), so either both happen or neither does.
- If the worker crashes mid-execution (after calling `agentRuntime.run()` but before updating `AgentTaskRun`), the run stays `'running'` indefinitely even though the underlying `AgentRun` completed. **Mitigated** by making the worker idempotent per `packages/queue/AGENTS.md` (check `AgentTaskRun.status` before re-processing on retry) and by queue-level retry/backoff; residual risk of a permanently-stuck row if retries are exhausted is accepted for v1 (surfaces as a stale "running" row in the history table, not a silent failure — visible for manual follow-up).
- Concurrent `/run` calls with the *same* `idempotencyKey` racing each other could both pass the "not yet recorded" check before either inserts. **Mitigated** by the unique partial index on `(organizationId, taskDefinitionId, idempotencyKey)` — the losing insert fails with a unique-violation, caught and turned into "return the existing row."

### Cascading Failures & Side Effects
- The `workflow`-target completion path relies on `workflows.instance.completed`/`.failed` reaching the event bus — which they do **not** today (they are declared but unemitted; see Dependencies & Prerequisites). This is handled as a **hard sequencing prerequisite** (Phase 3 is gated on the lifecycle-events spec landing and the `workflow` target is not exposed in the UI until then), not left as a latent runtime risk. Even after the prerequisite lands, a dropped/redelivered event is the same class of risk as any event-driven state sync; mitigated by idempotent subscriber handling and by the run-history UI showing `startedAt` so a stuck `'running'` row is visually obvious, not silently wrong.
- If `@open-mercato/scheduler` is not registered in a deployment, a task with `scheduleCron` set simply never fires — no error, no crash (mirrors the existing best-effort guard in `agent_orchestrator/setup.ts`). The Create/Edit UI should surface this (e.g. a note if the scheduler DI registration is absent) so an admin isn't confused why a "scheduled" task never runs.
- A guardrail/eval subscriber failure downstream of `agentRuntime.run()` behaves exactly as it already does for any agent run today — this feature adds no new failure surface there.

### Tenant & Data Isolation Risks
- All three new tables carry `tenant_id` + `organization_id`; every query filters by `organization_id`. The `executionPrincipalId` provisioning call is always scoped to the creating request's `{ tenantId, organizationId }`, so a task's principal can never act outside its own org.
- The `agent-task-runs` queue is a shared, cross-tenant queue (like every other queue in the platform) — payloads carry `taskRunId` only, and the worker re-resolves tenant/org scope from the `AgentTaskRun` row itself rather than trusting anything client-supplied, so a malformed/forged payload cannot cross tenants.
- The cross-module launch widget only ever lists the caller's own organization's enabled `AgentTaskDefinition`s (standard `organization_id` filter on the picker's `GET /tasks` call) — no cross-tenant task visibility.

### Migration & Deployment Risks
- Purely additive migration (three new tables, no existing schema touched) — deployable without downtime, no backfill needed.
- If a deploy ships Phase 1 (CRUD) before Phase 2 (run pipeline), a created task simply has no working "Run" button yet — an explicit, sequenced rollout, not a race condition, since Phase 1 ships behind no feature flag that would let end users reach the Create form before Phase 2 lands (the backend UI itself only ships from Phase 2 onward).

### Operational Risks
- Blast radius of this feature failing entirely: isolated to the `agent_task_*` tables and the `agent-task-runs` queue — no existing agent/workflow execution path is modified, so a bug here cannot break the Playground or the "Start instance" flow it delegates to.
- A misconfigured event trigger (overly broad `eventPattern`, e.g. matching every event) could fire a task far more often than intended, generating excess `AgentTaskRun`/`AgentRun` rows and, if the target is a mutating agent, excess proposals for the Caseload to review. Mitigated by `debounceMs`/`maxConcurrentInstances` on `AgentTaskEventTrigger.config` (same knobs `WorkflowEventTrigger` already offers) and by the wildcard subscriber's existing excluded-prefix list (never matches `agent_orchestrator.*`/`workflows.*`/`queue.*` internal events, preventing trigger storms/recursion).
- Storage growth: `AgentTaskRun` rows accumulate per trigger (potentially high-frequency for scheduled/event-triggered tasks). No retention/archival policy ships in v1 — flagged as a known gap, mirroring the same open gap already noted for the module's other append-only tables (`AgentRun`, `AgentSpan`) in `gap-19-retention-archival.md`; not a regression introduced by this feature.

### Risk Register

#### Stray schedule keeps firing after a task is edited/disabled
- **Scenario**: An admin sets `scheduleEnabled=false` (or clears `scheduleCron`) but the update command fails to call `schedulerService.register()`/unregister, leaving a stale cron entry that keeps enqueueing runs for a task the admin believes is paused.
- **Severity**: Medium
- **Affected area**: `agent_orchestrator` scheduling, `@open-mercato/scheduler`
- **Mitigation**: The update command's schedule-sync step runs in the same transaction/flush boundary as the entity update (best-effort but logged loudly on failure, mirroring the existing `setup.ts` scheduler-registration guard); an idempotent `register()`/unregister call on every update (not just when the schedule fields changed) makes this self-healing on the next edit even if one sync attempt failed.
- **Residual risk**: Low — worst case is one extra unwanted run before the next edit re-syncs, visible immediately in the run-history table.

#### Execution principal over-scoped at task creation
- **Scenario**: An admin creates a task and grants its execution principal broader features than the target actually needs (e.g. grants `workflows.*` instead of just `workflows.instances.create`), so a compromised or misused task can act with more privilege than intended.
- **Severity**: High
- **Affected area**: Identity overlay, RBAC
- **Mitigation**: The Create Task form's features picker defaults to the minimum needed (`workflows.instances.create` pre-checked only for `targetType='workflow'`, nothing pre-checked for `targetType='agent'` beyond what the target agent's own tools already require) and requires an explicit admin action to grant anything broader — same least-privilege discipline the identity overlay already documents for real agent principals.
- **Residual risk**: Medium — an admin can still over-grant; this is a human process risk inherent to any permission-picker UI, not something this feature can fully eliminate. Mitigation is defaults + visibility (the granted-features list is shown plainly on the task's detail page for audit).

#### Malformed API payload triggers an unintended run before schema validation exists
- **Scenario**: A task has no `inputSchema` set (schema is optional) and an external system sends a malformed payload; the run proceeds and fails deep inside the agent/workflow with a confusing error instead of a clean 400.
- **Severity**: Low
- **Affected area**: `/tasks/:id/run` API contract
- **Mitigation**: `inputSchema` is opt-in but strongly recommended for any task exposed to external callers; the spec's UI should nudge admins to define one when `targetType`/context suggests external use. Even without a schema, the run's `failureReason` captures whatever error surfaced, visible in the run-history table.
- **Residual risk**: Low — this is the accepted tradeoff of an optional schema; the alternative (mandatory schema) would block simple internal-only tasks from being created without upfront schema authoring.

## Integration Coverage

> Per repo rule, this feature ships executable Playwright integration tests with the change.
> Location: `packages/enterprise/src/modules/agent_orchestrator/__integration__/TC-AGENT-TASK-<NNN>.spec.ts`
> Helpers: `@open-mercato/core/helpers/integration/{auth,api,authFixtures,generalFixtures}` + this module's existing `__integration__/helpers/agentFixtures.ts` extended with task/event-trigger fixtures. All fixtures created in setup (prefer API), cleaned in `finally`/teardown. No seeded/demo data; deterministic across retries.

| API path / UI flow | Method | Must-have tests |
|--------------------|--------|-----------------|
| `POST /tasks`, `GET /tasks`, `PUT /tasks/:id`, `DELETE /tasks/:id` | CRUD | Create provisions an `executionPrincipalId`; update re-scopes the principal's role when `grantedFeatures` changes; optimistic-lock 409 on stale `updatedAt` (`surfaceRecordConflict`); delete unregisters an active schedule; RBAC (`tasks.view`/`.manage`) |
| `POST /tasks/:id/run` — `agent` target | POST | Returns `202 { taskRunId, status: 'running' }` immediately; worker resolves to `completed` with a matching `agentRunId`; disposition (auto-approve vs `USER_TASK`) behaves identically to a direct Playground run of the same agent |
| `POST /tasks/:id/run` — `workflow` target | POST | Returns `202` immediately; `workflowInstanceId` set; a park-for-review workflow leaves the `AgentTaskRun` at `'running'` until the instance resolves; the `workflows.instance.completed`/`.failed` subscriber correctly flips status |
| `POST /tasks/:id/run` — idempotency | POST | Two calls with the same `idempotencyKey` return the same `taskRunId`, no duplicate `AgentTaskRun`/`AgentRun`/instance created |
| `POST /tasks/:id/run` — schema validation | POST | With `inputSchema` set, a malformed payload returns `400` with field-level errors and creates no `AgentTaskRun`; a valid payload proceeds normally |
| `POST /tasks/:id/run` — API-key triggered | POST | An `ApiKey` bearer whose role grants `agent_orchestrator.tasks.run` (no attached `userId`, pure service key) successfully triggers a run; `triggeredBy` records `api_key:<id>`; the resulting `AgentRun`/instance is attributed to the task's `executionPrincipalId`, not the key |
| Scheduling | E2E | A task with `scheduleCron` set fires via the scheduler and produces an `AgentTaskRun` with `triggeredBy: 'schedule:<id>'`; disabling `scheduleEnabled` stops further scheduled runs; deleting the task unregisters the schedule |
| Event triggers | E2E | An `AgentTaskEventTrigger` matching an emitted domain event produces an `AgentTaskRun` with `triggeredBy: 'event:<eventName>'` and input built from `contextMapping`; `filterConditions` correctly excludes non-matching payloads; an excluded-prefix event (e.g. `workflows.*`) never triggers a task (no recursion) |
| `GET /task-runs`, `GET /task-runs/:id` | GET | Filters by `taskDefinitionId`/`status`/`sourceEntityType`+`sourceEntityId`; RBAC (`tasks.view`) |
| Cross-module launch widget | UI | Launching from an injected row action auto-fills `sourceEntityId` (hidden from the rendered form); `SchemaDrivenTaskInputForm` renders correct field types from a sample `inputSchema` and validates client-side before submit; falls back to a JSON textarea when `inputSchema` is absent |
| Bulk launch | UI → `ProgressJob` | Selecting multiple rows and launching creates one `ProgressJob` (`agent_orchestrator.tasks.bulk_run`) tracked by `ProgressTopBar`, not a client-side loop; per-row failures don't abort the whole batch |
| **Tenant isolation (Critical, mandatory)** | all | Org B can never view, run, or see run history for org A's `AgentTaskDefinition`/`AgentTaskRun`/`AgentTaskEventTrigger` — explicit cross-tenant denial test on every surface above (404/403, never the row) |
| DS-token / i18n compliance | UI | Status badges use DS tokens only; all user-facing strings resolve from `i18n/<locale>.json` |

**Tenant-isolation harness (mandatory):** create two orgs/tenants (`createUserFixture` per org), seed a task + a run + an event trigger in org A, assert org B's token gets 404/403 on every read/write/run surface above. Cleanup both orgs in teardown.

## Final Compliance Report — 2026-07-03

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/enterprise/src/modules/agent_orchestrator/AGENTS.md`
- `.ai/specs/enterprise/agent-orchestrator/2026-06-19-agent-orchestrator-conventions.md`
- `packages/core/src/modules/workflows/AGENTS.md`
- `packages/core/src/modules/progress/AGENTS.md`
- `packages/queue/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/ui/AGENTS.md`
- `.ai/specs/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | `targetAgentId`/`targetWorkflowId`/`agentRunId`/`workflowInstanceId`/`executionPrincipalId` are all FK-id strings, no ORM relations |
| root AGENTS.md | Filter by `organization_id` | Compliant | All three entities carry `tenant_id`+`organization_id`; every route/query scoped |
| root AGENTS.md | Optimistic locking default ON for user-editable entities | Compliant | `AgentTaskDefinition`/`AgentTaskEventTrigger` carry `updated_at`, return `updatedAt`; `AgentTaskRun` is system-transitioned (mirrors `AgentRun`'s exemption) |
| root AGENTS.md (Design System Rules) | Semantic status tokens, no arbitrary sizes, no inline `<svg>` | Compliant | UI section specifies `text-status-*`/`bg-status-*`, `lucide-react` icons |
| `agent_orchestrator/AGENTS.md` | Every agent write flows through propose-only pipeline | Compliant | Both target types call the existing `agentRuntime.run()`/`workflowExecutor.startWorkflow()` unchanged — no new write path bypasses disposition |
| `agent_orchestrator/AGENTS.md` | Append-only trace/audit rows never mutated | Compliant | `AgentTaskRun` follows the same "system-transitioned, no user edit" treatment as `AgentRun` |
| conventions doc | Table prefix `agent_`, two-column tenancy, explicit `@Property` | Compliant | `agent_task_definitions`/`agent_task_runs`/`agent_task_event_triggers` |
| `workflows/AGENTS.md` | Resolve `workflowExecutor` via DI, never call lib functions directly | Compliant | Worker resolves `container.resolve('workflowExecutor')` |
| `packages/core/AGENTS.md` → Encryption | PII/GDPR fields declared in `encryption.ts`, read via `findWithDecryption` | Compliant | `input_defaults`, `input`, `failure_reason` declared, mirroring the existing `agent_run.input`/`.output` treatment |
| `packages/core/AGENTS.md` → API Routes | CRUD via `makeCrudRoute` + `indexer`; custom writes via mutation-guard contract | Compliant | `/tasks` CRUD via factory; `/tasks/:id/run` and event-trigger sub-resource are custom writes wired through the guard |
| `packages/core/src/modules/progress/AGENTS.md` | Bulk operations MUST use `ProgressJob` + queue worker, not a client loop | Compliant | Cross-module bulk launch explicitly specified via `ProgressJob` (`agent_orchestrator.tasks.bulk_run`), not `runMutation` looping |
| `packages/queue/AGENTS.md` | Durable work via `@open-mercato/queue`, idempotent workers | Compliant | `agent-task-runs` queue + `task-run-executor` worker, idempotency discussed in Risks |
| `packages/ui/AGENTS.md` | `<CrudForm>`, `<DataTable>`, `apiCall`, `useGuardedMutation` | Compliant | Specified throughout UI/UX section |
| `packages/shared/AGENTS.md` | Command undo reads via `extractUndoPayload`, never `logEntry.payload` | Compliant | Undo behavior specified per command in Architecture § Commands |
| `.ai/specs/AGENTS.md` | Enterprise spec in `.ai/specs/enterprise/`, `{date}-{title}.md` naming | Compliant | This file: `.ai/specs/enterprise/agent-orchestrator/2026-07-03-agentic-tasks.md` |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | Every field in Data Models appears in the corresponding API request/response shape |
| API contracts match UI/UX section | Pass | Create/Edit form fields map 1:1 to `POST /tasks` body; run dialog maps to `POST /tasks/:id/run` |
| Risks cover all write operations | Pass | Create/update/delete, `/run`, schedule registration, event-trigger evaluation all have a corresponding risk or explicit mitigation |
| Commands defined for all mutations | Pass | Definition CRUD, event-trigger CRUD, and the run-trigger action all route through named commands |
| Cache strategy covers all read APIs | Pass | No caching layer proposed — list/detail reads are lightweight per-org CRUD queries; explicitly noted as a deferred optimization, not a gap, since none of the module's comparable list endpoints (`/agents`, `/runs`, `/proposals`) cache today either |

### Non-Compliant Items

None identified.

### Verdict

**Fully compliant** — approved, ready for implementation.

## Changelog

### 2026-07-12
- **Phases 1–4 implemented** on `feat/agent-orchestrator-mvp` (uncommitted working tree): `AgentTaskDefinition`/`AgentTaskRun`/`AgentTaskEventTrigger` entities + migration (`Migration20260711232818_agent_orchestrator.ts`, partial unique idempotency index via `@Index({ expression })`), `encryption.ts` additions, ACL `tasks.view/manage/run` + `setup.ts` role grants, `task.*`/`task_run.*`/`task_event_trigger.*` events (`task_run.*` clientBroadcast), `/tasks` CRUD (`makeCrudRoute` + hooks provisioning the execution principal and syncing the cron schedule), `/tasks/:id` detail, `POST /tasks/:id/run` (always-async 202, mutation-guarded, idempotency-key dedupe, `inputSchema`→Zod validation via the OUTCOME compiler), read-only `/task-runs` (+`/:id`), event-trigger sub-resource CRUD (optimistic-locked via `enforceCommandOptimisticLock`), the `agent-task-runs` queue + `task-run-executor` worker (agent target via `agentRuntime.run` under the task principal with `runAs` on-behalf-of; workflow target via DI `workflowExecutor.startWorkflow` + `executeWorkflow`), the `workflows.instance.completed/failed/cancelled` resolution subscribers (**Phase 3 unblocked** — the lifecycle-events prerequisite landed the same day), the wildcard `task-event-trigger` subscriber (local pattern/filter/mapping matcher, debounce + max-concurrent, `agent_orchestrator.` excluded to prevent recursion), scheduler registration (`schedulerService.register/unregister`, stable uuid per task, scheduled ticks re-enter the same enqueueRun command), and the `backend/tasks` list/create/edit + `backend/tasks/:id` detail UI (Run-now dialog with Cmd/Ctrl+Enter, run history live-updating via `task_run.*`, event-trigger management, granted-features audit chips). 33 new unit tests; full enterprise suite 129/846 green; i18n 4 locales in sync; optimistic-lock guard tests green.
- **Deliberate deviations:** (1) definition CRUD ships through `makeCrudRoute` + hooks instead of bespoke commands-with-undo — matching the module's own CRUD precedent (`eval-assertions`); the run trigger IS a command (`tasks.enqueueRun`, not undoable per spec); no other module command implements undo today. (2) `granted_features` is additionally persisted on the definition (audit display + change diffing without cross-module `RoleAcl` reads); the role ACL is still the enforcement source and is **replaced** (not merged) on every sync so features can be narrowed. (3) The Create-form features picker is a one-per-line text list, not a multi-select ACL browser. (4) `workflows.instance.cancelled` also resolves the ledger row (as `failed`, reason `Workflow instance cancelled`) — a cancelled instance would otherwise strand the row at `'running'`. (5) Filter-condition operators exclude the workflows matcher's `regex` (its safe-regex guard is workflows-internal; not worth duplicating for v1).
- **Phase 5 deferred** (cross-module `:row-actions`/`:bulk-actions` launch widget, `SchemaDrivenTaskInputForm`, bulk launch via `ProgressJob`): the launcher core, all four trigger sources, and both target paths are complete without it; the schema validation half of `inputSchema` already runs server-side.

### 2026-07-03
- Initial specification, synthesized from the confirmed design in `.ai/analysis/2026-07-03-agentic-task-capability-analysis.md` after multiple rounds of clarification (naming vs. the unbuilt dispatch spec, async trigger contract, external-system triggering, dedicated execution identity, idempotency, scheduling/event triggers in scope, schema-driven form scoped to the cross-module launch surface).
- Added to the roadmap: registered as an independent overlay in `README.md`'s suggested-implementation-order table and as row 13 + a sequencing note in `next/IMPLEMENTATION-TRACE.md`. Code audit of the current branch established two facts the stale (2026-06-24) trace matrix got wrong or that the spec had under-specified: (1) the **identity overlay is shipped here** (`provisionAgentPrincipal` + `agentRuntime.run` `ctx.runAs` fail-closed no-bypass), so the per-task execution principal reuses existing code with no wave dependency; (2) `workflows.instance.completed`/`.failed` are **declared but not emitted to the bus**, making the prerequisite spec `next/2026-06-26-workflows-emit-instance-lifecycle-events.md` a **hard gate on the workflow-target path (Phase 3)** while the agent-target path (Phases 1–2) is unblocked today. Added a Dependencies & Prerequisites section, gated Phase 3 on the prerequisite, and reframed the workflow-completion risk from a hypothetical bug to a managed sequencing prerequisite.
