# Agentic Task capability — analysis

**Analysis date:** 2026-07-03
**Scope:** How to add a user-creatable "Agentic Task" to `packages/enterprise/src/modules/agent_orchestrator/` — a task a user (or an **external system calling the API**) can define and run against **either** a single AI agent **or** a workflow definition that itself invokes one or more agents (via `INVOKE_AGENT`), creatable from the backend UI.
**Status:** Analysis only — no code written. Design decisions below are confirmed with the requester; written to inform a spec (`om-spec-writing`) before implementation.

## Confirmed decisions (superseding the "Open questions" section below where they overlap)

1. **Naming** — `AgentTaskDefinition` / `AgentTaskRun` (tables `agent_task_definitions` / `agent_task_runs`), distinct from the unbuilt dispatch spec's `AgentTask`. "Agentic Tasks" is the UI/nav label.
2. **Trigger contract is always async** — `POST /tasks/:id/run` always returns immediately with `{ taskRunId, status: 'running' }` for both target types; the caller observes completion via `agent_orchestrator.task_run.completed/failed` (`clientBroadcast: true`) or by polling `/task-runs/:id`. This applies uniformly whether the caller is a human (UI) or an external system (API key) — see next point.
3. **A task can be triggered by an external system, not only a human via the UI.** This is a first-class trigger path, not an afterthought — see §2.3a.
4. **Execution identity is always the task's own dedicated principal, never "the triggering user."** Every `AgentTaskDefinition` gets its own `executionPrincipalId`, auto-provisioned once at creation by reusing the existing `provisionAgentPrincipal()` helper with a synthetic id (`agentDefinitionId: 'task:<taskDefinitionId>'`) — no new identity code. "Who asked for this run" (a human or an API key) is recorded separately, as pure provenance, on `AgentTaskRun.triggeredBy`. See §2.3a for the full reasoning.
5. **Idempotency** — `POST /tasks/:id/run` accepts an optional client-supplied `idempotencyKey`; a repeat call with the same key returns the existing `AgentTaskRun` instead of starting a second one. Matters for external callers retrying after a network timeout.
6. **Scheduling and domain-event triggers are in scope for v1**, not deferred — see §2.3b. Both reuse existing platform primitives with no new infrastructure: `@open-mercato/scheduler`'s `schedulerService.register()` (the same one `agent_orchestrator/setup.ts` already uses for its metric-rollup job) for cron schedules, and the `workflows` module's wildcard event-trigger subscriber pattern (`WorkflowEventTrigger`) for domain events. A task can support any combination of manual, scheduled, event-triggered, and API-triggered — they all converge on the same `run()` path.
7. **Schema-driven input form is in scope for v1**, scoped specifically to the cross-module launch surface (§2.4, the generalized claims-sandbox row/bulk action) where a non-technical end user triggers a task — see §2.4a. An optional `inputSchema` on `AgentTaskDefinition` drives a real form there instead of a JSON textarea, with the same schema doubling as server-side input validation for every trigger source (including API calls). Tasks without an `inputSchema` keep the JSON textarea (backward-compatible, zero cost for admin/engineer-only tasks).

## TLDR

Everything needed to *execute* "one agent" or "many agents chained/parallel for one task" already exists and works today:

- Single agent → `agentRuntime.run()` (exercised ad hoc by the **Playground**, `/api/agent_orchestrator/agents/:id/run`).
- Multiple agents for one task → a `workflows` **WorkflowDefinition** with one or more `INVOKE_AGENT` steps (sequential, or parallel via `PARALLEL_FORK`/`PARALLEL_JOIN`), started via `workflowExecutor.startWorkflow()` (exercised today via **Backend → Workflows → Definitions → Start**, `POST /api/workflows/instances`).

What's **missing** is a first-class, persisted, UI-creatable object that a non-technical user can point at either target, name, save, re-run with friendly inputs, and see a unified run history for — instead of engineers pasting raw JSON into the Playground or the workflow "Start instance" dialog. That's the actual gap this analysis proposes closing: a thin **launcher + run-history** layer, not a new execution engine.

## 1. What already exists (verified in code)

### 1.1 Single-agent execution
- `agent_orchestrator/backend/playground/page.tsx` — pick an agent from `/api/agent_orchestrator/agents`, paste/generate JSON input, `POST /api/agent_orchestrator/agents/:id/run`. One-shot, not persisted beyond the resulting `AgentRun`/`AgentProposal` row. No "save this as a reusable task" concept.
- Agents are authored two ways (both already registered in one runtime-agnostic registry): in-process (`defineAgent` in `ai-agents.ts`) or file-defined (`agents/<id>/` on OpenCode). Both are addressable by a stable string `agentId`.
- Every run still goes through the existing propose-only pipeline: `agentRuntime.run()` → `AgentRun` → (if actionable) `AgentProposal` → `DispositionService` (auto-approve or `USER_TASK`) → effector command. An Agentic Task targeting a single agent gets this for free — nothing to reinvent.

### 1.2 Multi-agent / chained execution
- `workflows` already supports a step type vocabulary (`START/END/USER_TASK/AUTOMATED/SUB_WORKFLOW/WAIT_FOR_SIGNAL/WAIT_FOR_TIMER/PARALLEL_FORK/PARALLEL_JOIN`) and an activity type `INVOKE_AGENT` (added as an extension on top of the base `ActivityType` enum — not in the base activity table in `workflows/AGENTS.md`, confirmed present via `agent_orchestrator/examples/deals-health-check-workflow.json`).
- A single `WorkflowDefinition` can contain **multiple `INVOKE_AGENT` activities** — sequential steps, or parallel branches joined by `PARALLEL_JOIN` — each with its own `onResult.autoApproveThreshold` disposition gate, each producing its own `AgentRun`/`AgentProposal`, each capable of parking the whole instance at a `USER_TASK`/`WAIT_FOR_SIGNAL` for human review before continuing.
- The demo definition (`examples/deals-health-check-workflow.json`) shows the concrete `INVOKE_AGENT` step config shape:
  ```json
  {
    "activityType": "INVOKE_AGENT",
    "config": {
      "agentId": "deals.health_check_file",
      "input": { "deal": "{{context.deal}}" },
      "onResult": { "autoApproveThreshold": 0.8 }
    }
  }
  ```
- A visual editor already exists (`workflows/backend/definitions/visual-editor`, React Flow) with a draggable **Invoke Agent** node — so composing a multi-agent workflow is already a no-code(-ish) authoring flow, just not aimed at "run this now with these inputs" end users.
- Manual instance start already exists: **Backend → Workflows → Definitions → open → Start**, calling `POST /api/workflows/instances` (`startWorkflowInputSchema`: `{ workflowId, context, metadata }`) → `workflowExecutor.startWorkflow()`. ACL feature: `workflows.instances.create` ("Start workflow instances"). Lifecycle events already declared: `workflows.instance.started/completed/failed/cancelled/paused/resumed`.

### 1.3 The gap
Nothing persists "I want to run agent X (or workflow Y) repeatedly, with this label, these default inputs, gated by this ACL, and I want to see all its runs in one place" as a first-class, named, UI-creatable object. Today that requires either:
- knowing the agent id and pasting JSON into the Playground each time (single-agent case), or
- knowing the workflow id and pasting JSON into the workflow "Start instance" dialog each time (multi-agent case) — and workflow definitions are authored by whoever built the visual graph, which is a different persona than "someone who wants to launch a preconfigured task."

### 1.4 There's already a live, module-local prototype of exactly this — `claims`

This branch (`feat/agentic-claims-branch`) already contains a hackathon-quality version of the multi-agent case, scoped to one module:

- **`apps/mercato/src/modules/claims/examples/workflows/claims-resolution-process.json`** — a *parent* workflow with four `SUB_WORKFLOW` steps (liability / value / beneficiary / decision), each itself a workflow definition whose `AUTOMATED` step runs an `INVOKE_AGENT` activity against a specific file-defined agent (`claims.decision.proposal`, etc.), each with its own `onResult` disposition gate and `agent_orchestrator.proposal.ready` park/resume. This *is* "a workflow that invokes multiple agents for one task," already built and running, just for the claims domain specifically.
- **`apps/mercato/src/modules/claims/backend/claims/sandbox/page.tsx`** — literally the UI shape being asked for, but claims-only and explicitly labeled a hackathon sandbox: pick an enabled workflow from `GET /api/workflows/definitions?kind=workflow`, multi-select claim rows in a `DataTable`, then a **bulk action** ("Start workflow for selected") calls `POST /api/workflows/instances` once per selected row with `initialContext: { claimId: row.id }`, and renders per-row result links to `/backend/instances/:id`.
- This confirms `GET/POST /api/workflows/instances` already supports `entityType`/`entityId` correlation filters, i.e. "which instances were started for claim X" is already a first-class query on the `workflows` side.

**Read on this repo:** the "Agentic Task" ask is very likely "take the pattern already proven in `claims/backend/claims/sandbox` and lift it out of the claims module into `agent_orchestrator` as a reusable, cross-module, persisted capability" rather than a green-field concept. Section 2 below is written with that lift-and-generalize framing, not a from-scratch design.

## 2. Proposed design — "Agentic Task" as a launcher + run-history layer

**Principle:** reuse, don't reinvent. The new surface adds *zero* new execution logic — it is a thin, permissioned pointer to an existing `agentId` or `workflowId`, plus a persisted run ledger. All propose-only, disposition, guardrail, trace, and multi-agent orchestration behavior is inherited unchanged from `agentRuntime`/`workflows`.

### 2.1 Naming collision to resolve first (needs a decision)

The **not-yet-built** `agent-dispatch` spec (`.ai/specs/enterprise/agent-orchestrator/next/2026-06-19-agent-dispatch.md`) already reserves the name `AgentTask` / table `agent_tasks` for a different concept: routing one unit of work to a heterogeneous **external worker fleet** (internal/pull/A2A transports, leases, heartbeats). That is infrastructure for *connecting to other agents' compute*, not what's being asked for here (a UI-creatable launcher for *this* system's own agents/workflows).

To avoid a future collision (and reader confusion — "AgentTask" would mean two unrelated things), recommend naming this new pair:
- **`AgentTaskDefinition`** (table `agent_task_definitions`) — the saved, editable launcher.
- **`AgentTaskRun`** (table `agent_task_runs`) — one execution of a definition.

This keeps `agent_tasks`/`agent_task_events` free for dispatch if that spec is ever built, and keeps the two concepts visually distinct in code (`AgentTaskDefinition`/`Run` vs dispatch's `AgentTask`). Flag this naming choice explicitly in the spec so it's a deliberate call, not an accident.

### 2.2 Data model (follows the module's conventions doc: MikroORM v7 `/legacy`, two-column tenancy, `agent_` table prefix, FK-ids only, no cross-module ORM relations)

**`AgentTaskDefinition`** (`agent_task_definitions`) — editable, user-editable ⇒ carries `updated_at` (optimistic locking, default ON):
- `id`, `tenantId`, `organizationId`
- `name` (varchar), `description` (text, nullable)
- `targetType`: `'agent' | 'workflow'` (varchar + TS union)
- `targetAgentId` (varchar, nullable) — stable `agentId` string when `targetType='agent'`
- `targetWorkflowId` (varchar, nullable) — `WorkflowDefinition.workflowId` when `targetType='workflow'` (FK id only — no ORM relation into `workflows`)
- `inputDefaults` (jsonb, nullable) — seed input merged with per-run overrides at trigger time
- `inputSchema` (jsonb, nullable) — optional JSON-Schema, restricted to the **same supported subset already used for agent `OUTCOME.md`** (`object`/`array`/`string`/`number`/`integer`/`boolean`/`nullable`/`const`, per `agent_orchestrator/AGENTS.md` rule 6). When set, drives both the dynamic input form (§2.4a) and server-side validation of incoming `input` on every trigger source, including API calls. When absent, `/run` accepts any JSON and the UI falls back to a textarea.
- `executionPrincipalId` (uuid) — FK id → `agent_principals`; **mandatory**, auto-provisioned at creation (see §2.3a). Every action the task takes — starting a workflow instance, running an agent — is attributed to this principal, never to whoever/whatever triggered the run.
- `enabled` (boolean, default true)
- `createdByUserId` (uuid)
- `createdAt`/`updatedAt`/`deletedAt`

> Per §1.4, `sourceEntityType`/`sourceEntityId` on **`AgentTaskRun`** below (not the definition) is what generalizes the claims sandbox's `initialContext: { claimId: row.id }` pattern into a cross-module capability: any module's `DataTable` can inject a "Run agentic task" row/bulk action (spot `data-table:<tableId>:row-actions` / `:bulk-actions`) that calls `/tasks/:id/run` with the row's id pre-filled into the input and recorded as the source correlation, without the task definition itself needing to know about claims/deals/whatever-entity.

**`AgentTaskRun`** (`agent_task_runs`) — mirrors `AgentRun`'s lifecycle treatment (system-transitioned, not user-editable via a form, so no optimistic-lock UI surface needed even though it moves through statuses internally):
- `id`, `tenantId`, `organizationId`
- `taskDefinitionId` (FK id → `agent_task_definitions`)
- `targetType`, `targetAgentId`/`targetWorkflowId` — **denormalized snapshot** at trigger time (so history survives the definition being edited/deleted)
- `status`: `'running' | 'completed' | 'failed'`
- `agentRunId` (uuid, nullable) — FK id → `agent_runs`, set when `targetType='agent'`
- `workflowInstanceId` (uuid, nullable) — FK id → `workflows` instance, set when `targetType='workflow'`
- `input` (jsonb) — the resolved input actually used
- `sourceEntityType` / `sourceEntityId` (varchar, nullable) — generalizes the claims sandbox's `{ claimId: row.id }` correlation to any module/entity (FK id only, no ORM relation); the `workflow`-target path can also cross-check this against the started instance's own `entityType`/`entityId` filtering (already supported by `GET /api/workflows/instances`)
- `triggeredBy` (varchar) — **provenance only**, never an ACL identity: `'user:<userId>'` for a human caller, `'api_key:<apiKeyId>'` for an external system (mirrors the `sub: 'api_key:<id>'` shape the shared auth resolver already produces for API-key calls)
- `idempotencyKey` (varchar, nullable) — client-supplied on `/run`; unique per `(organizationId, taskDefinitionId, idempotencyKey)` where not null, so a retried external call resolves to the same row instead of starting a duplicate run
- `startedAt`, `completedAt` (nullable), `failureReason` (text, nullable)
- `createdAt` (append-only style; index `['taskDefinitionId', 'createdAt']` and `['sourceEntityType', 'sourceEntityId']` for history queries)

### 2.3 Execution flow

Because the trigger contract is always async (confirmed decision #2) for **both** target types, execution happens in a **queue worker**, not inline in the API handler — matching this codebase's own rule (`packages/core/AGENTS.md` → Operation Progress: "MUST use `@open-mercato/queue` workers for work that should continue after navigation or retry after process failure"). This also means a slow LLM call, a worker restart, or a parked workflow all behave identically from the caller's point of view: a `taskRunId` back immediately, then an event.

**`POST /tasks/:id/run` (API handler, fast path):**
1. Validate ACL (`agent_orchestrator.tasks.run`) and the mutation-guard contract.
2. If `idempotencyKey` is present and already recorded for this `(organizationId, taskDefinitionId)`, return the existing `AgentTaskRun` — no new row, no new job.
3. Load `AgentTaskDefinition` scoped by `organizationId`; merge `inputDefaults` + request `input`.
4. Insert `AgentTaskRun { status: 'running', triggeredBy, idempotencyKey }`; emit `agent_orchestrator.task_run.started` (`clientBroadcast: true`); enqueue a job (`agent-task-runs` queue) carrying `{ taskRunId }`.
5. Return `202 { taskRunId, status: 'running' }` immediately.

**Worker (`workers/task-run-executor.ts`, DI-resolved services, idempotent per `packages/queue/AGENTS.md`):**
1. Load the `AgentTaskRun` + its `AgentTaskDefinition`, and resolve the definition's `executionPrincipalId` → the acting `userId` (see §2.3a).
2. **`targetType === 'agent'`** → `container.resolve('agentRuntime').run({ agentId: targetAgentId, input, actorUserId: <principal's userId> })` (same call the Playground makes, just attributed to the task's own principal instead of an interactive session). On return, update `AgentTaskRun` with `agentRunId`, `status: 'completed'|'failed'`, `completedAt`, and emit the matching lifecycle event. Disposition (auto-approve vs `USER_TASK`/Caseload) proceeds exactly as it already does for any agent run — the task adds no new gating.
3. **`targetType === 'workflow'`** → `container.resolve('workflowExecutor').startWorkflow(em, { workflowId: targetWorkflowId, context: input, actorUserId: <principal's userId> })` (the same call `POST /api/workflows/instances` makes). This can be long-running/parked (`USER_TASK`, `WAIT_FOR_SIGNAL`), so the `AgentTaskRun` stays `'running'` with `workflowInstanceId` set, and a **subscriber** on the already-declared `workflows.instance.completed` / `workflows.instance.failed` events resolves it once the instance actually finishes (mirrors the existing pattern where `agent_orchestrator` already reacts to workflow signals for `proposal.ready`). No polling needed.
4. Every multi-agent case (parallel `INVOKE_AGENT` branches, sequential chains, human-approval gates mid-chain) is handled entirely by the `workflows` engine, unchanged — the worker just started the instance.

### 2.3a Execution identity — why every task gets its own principal

A task can be triggered by a person clicking "Run" in the UI, **or by an external system calling the API directly** (confirmed decision #3) — e.g. another service posting to `/tasks/:id/run` with an `ApiKey`. The platform already resolves an API-key call to a full `AuthContext` (`packages/shared/src/lib/auth/server.ts::resolveApiKeyAuth`) with `roles` from the key's `rolesJson`, but `userId` **only if** the key has one attached (`sessionUserId` or `createdBy`); a bare service key resolves to **no user identity at all**. So "run as whoever triggered it" has no answer for that case — there may be no "whoever."

The fix: decouple **"who may ask this task to run"** from **"who the task acts as."**

- The caller (human session or API key) only ever needs the `agent_orchestrator.tasks.run` ACL feature — checked identically for both, since API-key roles and human roles flow through the same RBAC path already.
- The **acting identity** is always the task's own `AgentTaskDefinition.executionPrincipalId` — provisioned once, at task-creation time, by reusing the *existing* `provisionAgentPrincipal(container, scope, { agentDefinitionId: 'task:<taskDefinitionId>', ... })` helper (already used to give every real agent a non-interactive `kind='agent'` `auth.User` + scoped `auth.Role`). No new identity code — just a synthetic id so the existing per-agent provisioning path treats a task definition as a "virtual agent" for identity purposes. The Create Task form needs one new bit of UI: a features/role picker so the admin scopes this principal to least privilege (e.g. `workflows.instances.create` for a workflow target, plus whatever ACL features the target agent's own tools require, e.g. `customers.deals.view` for `deals.health_check`).
- `AgentTaskRun.triggeredBy` records **who asked** (`'user:<id>'` / `'api_key:<id>'`) purely as provenance/audit trail — it never gates anything and is never the actor stamped on the resulting `AgentRun`/workflow instance.

This keeps the audit trail uniform regardless of trigger source, and means adding "trigger via API" required zero new authentication mechanism — it's the existing `api_keys` module, used exactly as it already is for any other protected route.

### 2.3b Scheduling and domain-event triggers

Four trigger sources now converge on the same `run()` entry point: **manual** (human, UI), **API** (external system, §2.3a), **scheduled** (cron), **event-triggered** (a domain event fires). The last two need no new mechanism — they reuse what already exists:

**Scheduling** — `@open-mercato/scheduler`'s `schedulerService.register()` is already used inside this exact module (`agent_orchestrator/setup.ts` registers its own metric-rollup job this way: `scopeType: 'organization'`, `scheduleType: 'interval'`, `targetType: 'queue'`, `targetQueue`, `targetPayload`, idempotent upsert on a deterministic uuid). `AgentTaskDefinition` gets three more optional columns:
- `scheduleCron` (varchar, nullable) — a cron expression
- `scheduleTimezone` (varchar, nullable, default `'UTC'`)
- `scheduleEnabled` (boolean, default `true`) — pause a schedule without deleting it

When a definition is created/updated with `scheduleCron` set, the command calls `schedulerService.register({ id: stableUuid('agent_orchestrator:task-schedule:<taskDefinitionId>'), scopeType: 'organization', scheduleType: 'cron', scheduleValue: scheduleCron, timezone, targetType: 'queue', targetQueue: 'agent-task-runs', targetPayload: { taskDefinitionId, triggeredBy: 'schedule' }, sourceType: 'user', isEnabled: scheduleEnabled })` — same idempotent upsert pattern, just user-owned (`sourceType: 'user'`) instead of module-owned. Clearing `scheduleCron` unregisters it. No admin ever types JSON at trigger time here — the run always uses `inputDefaults` as-is.

**Event triggers** — mirrors `workflows`' own `WorkflowEventTrigger` entity + its wildcard subscriber (`subscribers/event-trigger.ts`, `event: '*'`, evaluates every trigger row against every non-excluded event). New entity **`AgentTaskEventTrigger`** (`agent_task_event_triggers`), one-to-many per definition (a task can react to more than one event):
- `id`, `tenantId`, `organizationId`, `taskDefinitionId` (FK id)
- `eventPattern` (varchar) — e.g. `claims.claim.reported`
- `config` (jsonb) — same shape as `WorkflowEventTriggerConfig`: `filterConditions?`, `contextMapping?` (event payload fields → task input fields — this is what fills in the input, since again no human is present), `debounceMs?`, `maxConcurrentInstances?`
- `enabled` (boolean, default true), `priority` (int, default 0)
- `createdAt`/`updatedAt`/`deletedAt`

A new wildcard subscriber (`subscribers/task-event-trigger.ts`, `event: '*'`, same excluded-prefix list as the workflows one) evaluates `AgentTaskEventTrigger` rows the same way the workflows subscriber evaluates `WorkflowEventTrigger` rows, and on a match enqueues a run with `input` built from `contextMapping` and `triggeredBy: 'event:<eventName>'`.

**Net effect on `AgentTaskRun.triggeredBy`:** four possible provenance shapes — `'user:<id>'`, `'api_key:<id>'`, `'schedule:<scheduleId>'`, `'event:<eventName>'` — all just audit trail, never an ACL identity (§2.3a still applies: the *acting* identity is always the task's own `executionPrincipalId`, regardless of which of the four triggered it).

### 2.4 UI (backend pages, following the `customers` CRUD reference pattern already used elsewhere in this module)

- **`agent_orchestrator/backend/tasks`** — `DataTable` list of `AgentTaskDefinition`: name, target (badge: "Agent: deals.health_check" / "Workflow: Deal Health Check (Agent)"), enabled, last-run status. Row actions: **Run**, Edit, Delete.
  - *Naming note:* `workflows` already has its own `backend/tasks` (the `USER_TASK` human inbox) — different module route (`/backend/workflows/tasks` vs `/backend/agent_orchestrator/tasks`), no URL collision, but the sidebar label should say **"Agentic Tasks"**, not bare "Tasks", to avoid confusing the two concepts for operators who see both modules' nav entries.
- **Create/Edit** — a `CrudForm`: `name`, `description`, `targetType` (select), then conditionally either `targetAgentId` (select, sourced from `/api/agent_orchestrator/agents`) or `targetWorkflowId` (select, sourced from `/api/workflows/definitions`), `inputDefaults` (JSON textarea — reuse the Playground's "insert sample" pattern: agents already ship `sampleInput`), and a **"Permissions for this task"** features picker that scopes the auto-provisioned `executionPrincipalId`'s role (§2.3a) — least-privilege by default, e.g. pre-check `workflows.instances.create` when `targetType='workflow'`.
- **Run action** — a dialog (Cmd/Ctrl+Enter submit, Escape cancel) with the input JSON prefilled from `inputDefaults`, calling `POST /api/agent_orchestrator/tasks/:id/run` via `useGuardedMutation(...).runMutation(...)`. The call returns immediately (`{ taskRunId, status: 'running' }`); the dialog closes and the new row appears at the top of the run-history table, live-updating to `completed`/`failed` via the `clientBroadcast` event rather than the dialog blocking on the result. Clicking the row deep-links to the Playground-style `ProposalCard`/`JsonDisplay` for an `agent` target, or the existing **Workflows → Instances → :id** detail page for a `workflow` target.
- **Detail page `agent_orchestrator/backend/tasks/:id`** — definition summary + "Run now" + a `DataTable` of `AgentTaskRun` history (status, started/completed, deep link into the underlying `AgentRun` or workflow instance).
- **Cross-module row/bulk action (the generalized claims-sandbox flow)** — any module's `DataTable` (claims, deals, orders, …) injects a "Run agentic task" action at `data-table:<tableId>:row-actions` or `:bulk-actions`, offering the caller's enabled `AgentTaskDefinition`s and calling `/tasks/:id/run` once per selected row with the row's id as `sourceEntityId`. This *is* the claims sandbox page's bulk action, minus the module-specific hardcoding — claims (or any module) keeps a thin injected widget instead of a bespoke page.
  - **Scale caveat:** the claims sandbox loops `runMutation` client-side per selected row — fine for a hackathon, but per `packages/core/src/modules/progress/AGENTS.md` a production bulk action over more than a handful of rows MUST go through a `ProgressJob` + queue worker (server-side loop, resumable, progress-tracked), not a client-side `for` loop. Carry this forward when generalizing the pattern.

### 2.4a Schema-driven input form (v1, scoped to the cross-module launch surface)

A new, narrow UI component — call it `SchemaDrivenTaskInputForm` — renders form fields from `AgentTaskDefinition.inputSchema` when present: text/number/boolean inputs, a `select` for a `const`-enum string, nested groups for `object`, repeaters for `array`. Because `inputSchema` is restricted to the exact same subset already used for OUTCOME (§ data model above), this is new **rendering** code only — the **validation** side reuses the existing subset→Zod compiler (`lib/sdk/outcomeSchema.ts`) as-is, just pointed at input instead of output.

- **Where it renders:** the cross-module row/bulk-action dialog (this is the surface that motivated it — a non-technical end user, e.g. a claims handler, filling in one or two extra fields beyond the auto-filled `sourceEntityId`). The auto-filled field (e.g. `claimId`) is excluded from the rendered form (hidden/read-only) and merged back in before the `/run` call.
- **Where it does NOT render:** the task owner's own "Run now" dialog on `agent_orchestrator/backend/tasks/:id` keeps the JSON textarea regardless — that's an admin/engineer surface where raw JSON is fine and `inputDefaults`/"insert sample" already cover the need. (If a task has no `inputSchema`, the cross-module launcher also falls back to the same JSON textarea — the form is opt-in, not mandatory.)
- **Server-side validation applies everywhere**, independent of whether a form rendered: `/tasks/:id/run` compiles `inputSchema` → Zod once (cached per definition) and validates incoming `input` for **every** trigger source — manual, cross-module, and API. An external system now gets a real 400 with field-level errors on a malformed payload instead of a confusing runtime failure deep inside the agent/workflow.
- Building the definition's `inputSchema` itself (at task-creation time, by the admin) stays JSON-authored for now — reusing `SchemaDrivenTaskInputForm` to build a schema-*authoring* UI is a natural later step, not needed for v1.

### 2.5 API (`/api/agent_orchestrator/`)

| Route | Method | Feature | Notes |
|---|---|---|---|
| `/tasks`, `/tasks/:id` | GET/POST/PUT/DELETE | `agent_orchestrator.tasks.view` / `.tasks.manage` | `makeCrudRoute` + `indexer: { entityType: 'agent_orchestrator:agent_task_definition' }`; optimistic-locked on `updatedAt`; `POST`/`PUT` provisions/re-scopes the `executionPrincipalId` |
| `/tasks/:id/run` | POST | `agent_orchestrator.tasks.run` | Custom write, always async — mutation-guard contract; body accepts `{ input?, idempotencyKey? }`; enqueues to the `agent-task-runs` queue; returns **`202 { taskRunId, status: 'running' }`** immediately (or the existing run if `idempotencyKey` matches). Callable by a human session **or** an `ApiKey` bearer whose role grants `agent_orchestrator.tasks.run` — no separate machine-auth path needed. |
| `/task-runs`, `/task-runs/:id` | GET | `agent_orchestrator.tasks.view` | Read-only history, filterable by `taskDefinitionId`/`status`; `:id` is what the UI polls/subscribes on after a `run` call |
| `/tasks/:id/event-triggers`, `/tasks/:id/event-triggers/:triggerId` | GET/POST/PUT/DELETE | `agent_orchestrator.tasks.manage` | CRUD on `AgentTaskEventTrigger` rows for a definition; mirrors `workflows`' `WorkflowEventTrigger` shape (`eventPattern`, `config.filterConditions`/`contextMapping`) |

### 2.6 ACL (`acl.ts`) — mirrors the existing `agents.view`/`agents.run` split

- `agent_orchestrator.tasks.view`
- `agent_orchestrator.tasks.manage` (create/edit/delete definitions) — `dependsOn: ['tasks.view']`
- `agent_orchestrator.tasks.run` (trigger a run without edit rights — e.g. an operator, or an external system's API key, that should launch but not reconfigure) — `dependsOn: ['tasks.view']`

Add all three to `setup.ts` `defaultRoleFeatures` and run `yarn mercato auth sync-role-acls`. Per §2.3a, the caller only ever needs `tasks.run` — `workflows.instances.create` (or any tool-scoped feature the target agent needs) is granted to the task's own `executionPrincipalId` role instead, not required of the caller.

### 2.7 Events (`events.ts`)

- `agent_orchestrator.task.created` / `.task.updated` / `.task.deleted` (CRUD, standard)
- `agent_orchestrator.task_run.started` / `.task_run.completed` / `.task_run.failed` (lifecycle, `clientBroadcast: true` so the detail page's run-history table live-updates)

## 3. Open questions

None remaining — naming, sync/async contract, execution identity, idempotency, scheduling/event triggers, and input UX are all resolved (§ "Confirmed decisions", §2.3b, §2.4a). The claims-sandbox retirement question is moot — that page doesn't exist on the target base branch this work will land on, so there's nothing to deprecate.

## 4. Suggested phasing

1. `AgentTaskDefinition` + `AgentTaskRun` entities (including `inputSchema`, `executionPrincipalId`, `sourceEntityType`/`sourceEntityId`, `triggeredBy`, `idempotencyKey`), migrations, CRUD API + ACL + events; the `agent-task-runs` queue + worker skeleton.
2. Execution-principal provisioning (synthetic-id reuse of `provisionAgentPrincipal`) + the "Permissions for this task" features picker in the Create Task form.
3. `agent`-target execution path end-to-end (worker → `agentRuntime.run()` → status/event) + backend list/create/detail UI + "Run now" for agents (JSON textarea). Manual + API triggers both land here (they share the same `/tasks/:id/run` entry point); `inputSchema`, if set, already validates server-side even though no form renders yet.
4. `workflow`-target execution path (worker → `workflowExecutor.startWorkflow()` → async completion subscriber on `workflows.instance.completed/failed`) + UI target-type picker + deep link into Workflows → Instances.
5. Scheduling (`scheduleCron`/`scheduleTimezone`/`scheduleEnabled` + `schedulerService.register()` wiring) and event triggers (`AgentTaskEventTrigger` entity + wildcard subscriber) — both converge on the same `run()` path from steps 3–4, so this is additive once it exists.
6. Cross-module row/bulk-action injection (`data-table:<tableId>:row-actions`/`:bulk-actions`) so any module (e.g. claims) can launch a task pre-filled with a `sourceEntityId`; bulk launches go through the progress-job pattern, not a client-side loop.
7. `SchemaDrivenTaskInputForm` (§2.4a) wired into the cross-module launch dialog from step 6, rendering from `inputSchema` when present and falling back to the JSON textarea otherwise.
8. i18n, DS-token compliance, `__integration__` Playwright coverage (CRUD, run-and-dispose for both target types, tenant isolation, RBAC `tasks.view`/`.manage`/`.run` split, API-key-triggered run, idempotency-key dedupe, scheduled run fires, event-trigger fires and respects `filterConditions`, schema-form renders + validates, malformed API payload returns field-level 400) per `.ai/qa/AGENTS.md`.

## 5. Why this is minimal-risk

- No new execution primitives, no new disposition logic, no new agent runtime code — every run still flows through the existing propose-only pipeline (`agentRuntime.run()` or `workflowExecutor.startWorkflow()`), so guardrails, trace capture, evals, and the Caseload disposition flow all keep working unchanged.
- No cross-module ORM relations — `targetAgentId`/`targetWorkflowId` are plain FK-id strings, consistent with the module's existing conventions.
- Purely additive: new tables, new routes under `/api/agent_orchestrator/`, new ACL features, new events — nothing existing changes shape.
