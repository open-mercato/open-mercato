> 🗂️ **Reorg 2026-06-22 · Status: NOT STARTED (roadmap overlay).** Build this ON TOP of the implemented Agent Orchestrator. Treat the in-process + OpenCode runtimes, the registry/SDK, proposal/disposition, and the data model as already-shipped substrate — align new entities/APIs/events with the live module before implementing. Baseline: `.ai/specs/enterprise/agent-orchestrator/00-IMPLEMENTED-BASELINE.md` · live OpenCode spec: `.ai/specs/2026-06-22-opencode-file-defined-agents.md` · code: `packages/enterprise/src/modules/agent_orchestrator/`.

# Agent Task Dispatch & Connectivity

> **Status:** Draft · **Owner:** Patryk Lewczuk (Comerito) · **Created:** 2026-06-19
> **Module:** `agent_orchestrator` (core module, `packages/enterprise/src/modules/agent_orchestrator/`) · **subdomain:** `dispatch`
> **Depends:** `workflows`, `packages/queue`, `packages/scheduler`, `storage-s3`, `api_keys`, `webhooks`, orchestration spec (`2026-06-19-agent-orchestration-step-and-proposal.md`), trace spec (`2026-06-19-agent-trace-eval-capture.md`)
> **Conventions:** `2026-06-19-agent-orchestrator-conventions.md` is normative — where an entity sketch here conflicts with it, the conventions doc wins.

## TLDR

The connectivity layer that gets one unit of agent work to a capable agent — **internal** (OM-hosted via `workflows`/`packages/queue`), **pull** (firewalled / bring-your-own-compute workers that reach out over HTTP), or **A2A push** (callable external/partner agents on any runtime) — behind one `AgentTask` contract. Dispatch is invoked by the orchestration layer (an `EXECUTE_FUNCTION` workflow step in Phase 1, a first-class `INVOKE_AGENT` activity later) that calls `DispatchService.enqueue`; results hand off to the trace spec. The queue is *transport over typed task records*, not the source of truth — `AgentTask` is. Queue notification is advisory; the **lease is authoritative**. Lease expiry is swept by a `packages/scheduler` job. **Runtime-agnostic:** an `AgentBinding` names its `runtime` and the dispatcher picks the matching adapter — no runtime is hard-wired.

**Position:** `workflows` decides work is needed → orchestration creates an `AgentTask` via `DispatchService.enqueue` → **dispatch** routes/leases/transports it → an agent runs → the result becomes an `AgentRun`/`AgentProposal` (orchestration + trace). Dispatch does **not** sequence work (that's the workflow), run agent business logic, or store traces. **Side effects always gate through OM** ("LLM proposes, OM disposes") — dispatch never executes business effects.

## Overview

Open Mercato already orchestrates long-running work with `workflows` (async activities, `WAIT_FOR_SIGNAL` park/resume via `lib/signal-handler.ts`). What it lacks is a uniform way to hand a typed unit of agent work to a *heterogeneous fleet*: OM-hosted agents, firewalled/BYO agents that can only pull, and callable external agents reachable over a standard wire protocol. Dispatch supplies that single abstraction — capability routing, leasing, heartbeat/retry, human-input pauses, dead-lettering — on top of OM-native infrastructure (`packages/queue`, `packages/scheduler`, `storage-s3`, `api_keys`, `webhooks`).

The external wire standard is **A2A** (Agent2Agent, Linux Foundation, Apache-2.0): capability discovery via an Agent Card, task delegation, and artifact return. A2A is adopted, not invented. Non-A2A runtimes (OpenAI, custom) are wrapped by net-new **provider adapters** that we build. MCP (agent→tools) is out of scope here.

## Problem Statement

The orchestration layer must dispatch to agents that differ in *where they run* and *how they are reachable*: OM-hosted, firewalled/BYO (pull-only, no inbound connectivity), and callable external agents on arbitrary runtimes. There is no uniform abstraction that can queue work, capability-route it, lease it to exactly one worker, survive long-running tasks plus worker death plus human-input pauses, keep every task auditable, and guarantee tenant isolation so a worker can never read another tenant's task or payload.

## Proposed Solution

A single `AgentTask` record is the durable source of truth for every unit of agent work, regardless of transport. Around it:

- **`DispatchService.enqueue`** — the one entry point; creates the `AgentTask`, dedupes on `idempotencyKey`, persists payload-by-reference, emits `agent_orchestrator.task.created`.
- **`TaskRouter`** — matches `requiredCapability` against enabled `AgentBinding`s, respects per-binding concurrency, priority, and health; resolves the `transport` (`internal | pull | a2a`). **Canary/percentage gating of binding selection is computed *inside* the router**, not delegated to `feature_toggles`: the existing `feature_toggles` store only persists per-`(toggle, tenantId)` boolean/string/number/json overrides (`FeatureTogglesService.getNumberConfig`/`getBoolConfig`) — it has **no native percentage-rollout bucketing**. The router reads the toggle value as the canary *percentage*, then derives the deterministic split itself by hashing a stable key (task `idempotencyKey` / correlation id) into a bucket and comparing against that percentage (cross-ref GAP-14). The toggle store supplies the knob; the router does the bucketing.
- **Transport adapters** — `internal`, `pull`, `a2a push` (OM as A2A client), `a2a server` (OM as A2A node). One interface, swappable impls.
- **Runtime adapters** — selected by `AgentBinding.runtime`; `a2a` covers any A2A-compliant runtime, thin `provider` adapters wrap non-A2A runtimes.
- **`AgentTaskLease`** — the authoritative claim. A worker holds exactly one active lease; heartbeats extend it; expiry re-queues the task.
- **Lease sweeper** — a `packages/scheduler` DB-managed scheduled job that expires stale leases and re-dispatches (or dead-letters at `maxAttempts`).
- **`AgentTaskEvent`** — append-only transition log; every status change writes one.

Reads (`/tasks`, `/bindings`, `/metrics`) go through `makeCrudRoute` + `indexer`. Writes that mutate task state (worker claim/heartbeat/result/input, A2A inbound) go through the **Command pattern + mutation-guard contract**, with **optimistic locking** wherever they edit `AgentTask`.

## Architecture

```
workflows step (EXECUTE_FUNCTION → later INVOKE_AGENT activity)
        │ DispatchService.enqueue({ capability, payload, idempotencyKey, … })
        ▼
   AgentTask (source of truth) ──writes──▶ AgentTaskEvent (append-only)
        │
   TaskRouter  ── capability match → AgentBinding (transport + runtime)
        │
   ┌────┴───────────────┬─────────────────────────┐
 internal             pull                       a2a push / a2a server
 (packages/queue)   (HTTP claim/heartbeat       (OM A2A client + OM A2A node;
  worker            /result over scoped          callbacks via webhooks
  reports → trace)  agent-principal auth)        outbound delivery)
        │
   AgentTaskLease (authoritative) ◀── packages/scheduler lease sweeper
```

- **Queue is transport, not truth.** A queue message is a pointer to an `AgentTask` row; losing the message never loses the work — the sweeper re-dispatches from the table.
- **Lease authoritative.** Two workers may both receive a notification; only one can hold the active `AgentTaskLease`. Result writes for an expired/superseded lease are rejected.
- **Payload by reference.** Large inputs/outputs live in `storage-s3`; the task carries `payloadArtifactKey` + `payloadSummary`. Workers fetch via time-limited, scoped pre-signed URLs and never see more than their own task envelope.

## Data Models

All entities follow the conventions doc: MikroORM v7 `/legacy` decorators, explicit `@Property`, `tenant_id` **and** `organization_id` on every row (filter by `organization_id`), UUID PK `defaultRaw 'gen_random_uuid()'`, JSON→`jsonb` (shape enforced by Zod in `data/validators.ts`), enums→`varchar` + TS union, no cross-module ORM relations (FK ids only). Editable entities expose `updated_at` (optimistic lock); append-only logs omit `updated_at`/`deleted_at`.

### `AgentTask` (`agent_tasks`) — editable, single source of truth

```typescript
import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

export type AgentTaskStatus =
  | 'queued' | 'claimed' | 'running' | 'input_required'
  | 'completed' | 'failed' | 'cancelled' | 'dead_letter'

export type AgentTaskTransport = 'internal' | 'pull' | 'a2a'
export type AgentTaskOrigin = 'orchestration' | 'inbound_a2a'

@Entity({ tableName: 'agent_tasks' })
@Index({ name: 'agent_tasks_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_tasks_capability_status_idx', properties: ['organizationId', 'requiredCapability', 'status'] })
@Index({ name: 'agent_tasks_idempotency_uq', properties: ['organizationId', 'idempotencyKey'], options: { unique: true } })
export class AgentTask {
  [OptionalProps]?:
    | 'status' | 'priority' | 'attempts' | 'maxAttempts' | 'origin'
    | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'process_id', type: 'uuid', nullable: true })
  processId?: string | null // FK id → workflows instance; NOT an ORM relation

  @Property({ name: 'step_id', type: 'varchar', length: 100, nullable: true })
  stepId?: string | null

  @Property({ name: 'parent_task_id', type: 'uuid', nullable: true })
  parentTaskId?: string | null // FK id → agent_tasks (sub-task fan-out)

  @Property({ name: 'required_capability', type: 'varchar', length: 100 })
  requiredCapability!: string // e.g. "damage.estimate"

  @Property({ name: 'status', type: 'varchar', length: 20, default: 'queued' })
  status: AgentTaskStatus = 'queued'

  @Property({ name: 'priority', type: 'int', default: 0 })
  priority: number = 0

  @Property({ name: 'idempotency_key', type: 'varchar', length: 200 })
  idempotencyKey!: string // unique per org — dedupe at-least-once delivery

  @Property({ name: 'payload_artifact_key', type: 'varchar', length: 500, nullable: true })
  payloadArtifactKey?: string | null // storage-s3 object key (payload by reference)

  @Property({ name: 'payload_summary', type: 'jsonb', nullable: true })
  payloadSummary?: any | null // small inline envelope; full payload by reference

  @Property({ name: 'context_ref', type: 'varchar', length: 500, nullable: true })
  contextRef?: string | null // FK id → context bundle (context spec)

  @Property({ name: 'sla_ms', type: 'int', nullable: true })
  slaMs?: number | null

  @Property({ name: 'deadline_at', type: Date, nullable: true })
  deadlineAt?: Date | null

  @Property({ name: 'assigned_binding_id', type: 'uuid', nullable: true })
  assignedBindingId?: string | null // FK id → agent_bindings

  @Property({ name: 'transport', type: 'varchar', length: 20, nullable: true })
  transport?: AgentTaskTransport | null // resolved at routing

  @Property({ name: 'current_lease_id', type: 'uuid', nullable: true })
  currentLeaseId?: string | null // FK id → agent_task_leases

  @Property({ name: 'attempts', type: 'int', default: 0 })
  attempts: number = 0

  @Property({ name: 'max_attempts', type: 'int', default: 3 })
  maxAttempts: number = 3

  @Property({ name: 'origin', type: 'varchar', length: 20, default: 'orchestration' })
  origin: AgentTaskOrigin = 'orchestration'

  @Property({ name: 'external_task_id', type: 'varchar', length: 200, nullable: true })
  externalTaskId?: string | null // A2A task id (inbound or outbound)

  @Property({ name: 'result_run_id', type: 'uuid', nullable: true })
  resultRunId?: string | null // FK id → agent_runs (trace spec)

  @Property({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason?: string | null

  @Property({ name: 'claimed_at', type: Date, nullable: true })
  claimedAt?: Date | null

  @Property({ name: 'completed_at', type: Date, nullable: true })
  completedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
```

### `AgentTaskEvent` (`agent_task_events`) — append-only transition log

```typescript
@Entity({ tableName: 'agent_task_events' })
@Index({ name: 'agent_task_events_task_idx', properties: ['taskId', 'at'] })
export class AgentTaskEvent {
  [OptionalProps]?: 'at'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'task_id', type: 'uuid' })
  taskId!: string // FK id → agent_tasks

  @Property({ name: 'from_status', type: 'varchar', length: 20, nullable: true })
  fromStatus?: AgentTaskStatus | null

  @Property({ name: 'to_status', type: 'varchar', length: 20 })
  toStatus!: AgentTaskStatus

  @Property({ name: 'actor', type: 'varchar', length: 100 })
  actor!: string // 'system' | 'worker:<id>' | 'agent-principal:<id>' | 'rule:<id>' | userId

  @Property({ name: 'detail', type: 'jsonb', nullable: true })
  detail?: any | null

  @Property({ name: 'at', type: Date, onCreate: () => new Date() })
  at: Date = new Date()
}
```

### `AgentBinding` (`agent_bindings`) — editable capability registry (abbreviated)

Full house-style entity (two-column tenancy, explicit `@Property`, `updated_at`, soft-delete). Columns:
`id`, `tenantId`, `organizationId`, `agentDefinitionId` (FK id), `displayName`,
`capabilities` (`jsonb` — `string[]`), `transportMode` (`varchar`: `internal|pull|a2a`),
`runtime` (`varchar`: `internal|a2a|foundry|bedrock|openai|vertex|custom` — selects the adapter),
`agentCardUrl` (`varchar`, nullable — A2A discovery), `authCredentialRef` (`varchar`, nullable — secret *reference*, never the secret),
`concurrencyLimit` (`int`), `slaMs` (`int`, nullable), `enabled` (`boolean`),
`healthStatus` (`varchar`: `healthy|degraded|unreachable`), `lastSeenAt` (`Date`, nullable),
`createdAt`/`updatedAt`/`deletedAt`. Indexed `['tenantId','organizationId']` and `['organizationId','enabled']`.

### `AgentTaskLease` (`agent_task_leases`) — editable, authoritative claim (abbreviated)

Columns: `id`, `tenantId`, `organizationId`, `taskId` (FK id), `bindingId` (FK id), `workerId` (the agent-principal/worker identity),
`status` (`varchar`: `active|released|expired|completed`), `leasedAt` (`Date`), `expiresAt` (`Date`), `heartbeatAt` (`Date`, nullable),
`createdAt`/`updatedAt`/`deletedAt`. Unique partial index on `(taskId)` where `status='active'` (at most one active lease per task). Indexed `['organizationId','status','expiresAt']` for the sweeper.

## Lifecycle

```
                ┌──────────────────────────── lease expired ───────────────────────┐
                │                              (attempts++; if ≥ maxAttempts → dead_letter)
                ▼                                                                    │
  queued ─route/claim▶ claimed ─start▶ running ─┬─▶ completed                        │
    ▲                                            ├─▶ failed ─(retryable & < max)─────┘
    │                                            └─▶ input_required ─answer▶ running
  any active state ─cancel▶ cancelled
  dead_letter ▶ surfaces for triage (caseload), never silently dropped
```

- `input_required` maps to a `USER_TASK` (Decide/Answer) in `workflows`; A2A's `input-required` / `auth-required` external states map here.
- The lease sweeper (`packages/scheduler`) re-queues tasks whose lease expired without heartbeat; **stale results for an expired/superseded lease are rejected.**
- Every transition writes an `AgentTaskEvent` and emits the matching canonical event.

## Transport & Runtime Adapters

**Transport adapters** (one interface, four impls):

- **internal** — enqueue to the `workflows`/`packages/queue` worker; the worker runs the OM-hosted agent and reports the result to the trace spec.
- **pull** — task published to a capability-scoped queue/view; firewalled/BYO workers `claim`/`heartbeat`/`result` over HTTP (they reach out — OM needs no inbound connectivity to them).
- **a2a push** — OM as A2A **client**: resolve the partner Agent Card, delegate the task, receive artifacts via a push-notification **webhook** delivered through the `webhooks` module's outbound delivery (resilient for long-running work — no held connection); map A2A states → `AgentTask` states.
- **a2a server** — OM as A2A **node**: OM publishes `/.well-known/agent-card.json`; an inbound A2A task becomes an `AgentTask` (`origin='inbound_a2a'`), runs via the internal/pull path, and returns artifacts. This makes OM a first-class node in the mesh.

**Runtime adapters** sit behind the push transports and are selected by `AgentBinding.runtime`: the single `a2a` adapter covers any A2A-compliant runtime (Foundry, Bedrock, Vertex …); thin `provider` adapters wrap non-A2A runtimes (OpenAI, custom). Each provider adapter maps the runtime's invoke + trace API to the `AgentTask`/`AgentRun` contract and normalizes spans to OM's trace model. Adding a runtime = adding one adapter; nothing else changes. Provider adapters are net-new build.

## API Contracts

All paths under `/api/agent_orchestrator/` (underscore module id).

- **Worker (authenticated as an agent principal — see Security):**
  - `POST .../dispatch/claim` — long-poll claim of the next matching task; issues an `AgentTaskLease`.
  - `POST .../tasks/:id/heartbeat` — extend the active lease.
  - `POST .../tasks/:id/result` — submit result; rejected if the lease is not active. Optimistic-locked.
  - `POST .../tasks/:id/input` — answer an `input_required` task (HITL bridge to `USER_TASK`).
- **A2A:**
  - `GET /.well-known/agent-card.json` — OM's Agent Card (a2a server).
  - `POST .../a2a/tasks` — inbound A2A task → `AgentTask` (`origin='inbound_a2a'`).
  - `POST .../a2a/callbacks/:id` — intake of A2A client push-notification callbacks.
- **Admin / read (`makeCrudRoute` + `indexer: { entityType: 'agent_orchestrator:<entity>' }`, each route exports `openApi`):**
  - `/tasks`, `/tasks/:id`, `/bindings`, `/metrics` (queue depth, per-capability backlog, per-binding concurrency/health — read from **this module's own tables + queue depth**, not a telemetry module).
- **Internal:** `DispatchService.enqueue(task)` — called by the orchestration workflow step.
- **Events** (`createModuleEvents`, `module.entity.action`, past tense): `agent_orchestrator.task.created`, `.task.claimed`, `.task.running`, `.task.input_required`, `.task.completed`, `.task.failed`, `.task.dead_lettered`, `agent_orchestrator.binding.health_changed`.

Custom write endpoints (`claim`, `heartbeat`, `result`, `input`, A2A inbound/callbacks) run domain writes through the **Command pattern** with `validateCrudMutationGuard` before and `runCrudMutationGuardAfterSuccess` after; writes that edit `AgentTask` enforce optimistic locking (`enforceCommandOptimisticLock` / `createCommandOptimisticLockGuardService`) and surface 409s via `surfaceRecordConflict`.

## Security & Constraints

- **Worker auth = agent principals, not bespoke tokens.** External/pull workers authenticate as agent principals via standard non-interactive credentials (**OAuth client-credentials**; later ID-JAG-style delegation). Credentials are scoped **per capability + tenant** and revocable. A2A auth is negotiated via Agent Card schemes; every external action is attributed to the agent principal with an on-behalf-of delegation grant (identity spec). **Dependency (explicit):** `api_keys` does **not** today expose an OAuth client-credentials endpoint — external/pull worker auth depends on the **net-new OAuth client-credentials token server defined in the identity spec** (built on the existing `signAudienceJwt` + session-token precedent), not on an existing `api_keys` route. This is a hard prerequisite for the `pull` and `a2a` transports (cross-ref GAP-16 / `2026-06-19-agent-identity-and-on-behalf-of.md`).
- **Lease/heartbeat is app-modeled, not a scheduler feature.** `packages/scheduler` has **no native lease or heartbeat primitive**; the authoritative claim is this module's own `AgentTaskLease` (the unique partial active-lease index) plus a scheduler-*driven* sweeper job that expires stale leases and re-dispatches. The scheduler only supplies the periodic trigger — the leasing semantics live entirely in `agent_orchestrator` tables and Commands.
- **Tenancy.** `AgentTask`, `AgentBinding`, `AgentTaskLease`, and `AgentTaskEvent` all carry `tenant_id` + `organization_id`; all reads/claims filter by `organization_id`. A worker can **never** read another tenant's task or payload — this is an acceptance test.
- **Payload by reference.** Inputs/outputs over the inline-summary threshold live in `storage-s3`; workers fetch via time-limited, scoped pre-signed URLs. A worker never sees more than its own task envelope.
- **At-least-once + idempotency.** `idempotencyKey` (unique per org) dedupes delivery; result writes are idempotent. **Side-effect execution still gates through OM** — dispatch transports proposals/artifacts; it never executes business effects ("LLM proposes, OM disposes").
- **Long-running.** Lease + heartbeat/extension; A2A via push-notification callbacks (webhooks outbound delivery), not held connections. Dead-letter never silently drops; it surfaces for triage.

## Open Questions

1. **Queue backend.** Postgres `SKIP LOCKED` (keeps `AgentTask` the single source of truth, no new infra, leverages the unique active-lease index) vs **BullMQ** (already present in `packages/queue`). **Lean `SKIP LOCKED` for v1**; both are real and available. Decide before Phase 4.
2. **Capability ownership.** `AgentDefinition` (orchestration) declares *intended* capabilities; `AgentBinding` declares *deployed/reachable* ones. Confirm the boundary and which one `TaskRouter` trusts.
3. **A2A TS SDK maturity** (client + server) at the target version — real risk; may require a thin in-house protocol shim for v1.

## Phases

1. `AgentTask` + `AgentTaskEvent` + state machine + `DispatchService.enqueue` (idempotency, payload-by-reference, events).
2. `AgentBinding` registry + `TaskRouter` (capability match, concurrency, priority, health).
3. **internal** adapter + result → trace ingestion (the original ask, end-to-end OM-hosted).
4. **pull** adapter: `claim`/`heartbeat`/`result`/`input` + `AgentTaskLease` + `packages/scheduler` sweeper + agent-principal scoped credentials.
5. **A2A client** (Agent Card resolution, delegation, artifact mapping, callbacks via webhooks).
6. **A2A server** (OM Agent Card, inbound → `AgentTask`).
7. HITL bridge (`input_required` ↔ `USER_TASK`), dead-letter → caseload, fairness, binding health, `/metrics`.

**Critical path (internal + pull — the original ask):** 1→2→3→4. A2A (5/6) layers external callable agents on without changing the task contract.

## Acceptance

- Any registered agent (internal/pull/a2a) claims and completes a task through the one `AgentTask` contract.
- An external A2A agent integrates via its Agent Card with no bespoke connector code.
- A task whose worker dies is re-dispatched after lease expiry (sweeper); a stale result for the expired lease is rejected.
- A task needing a human transitions to `input_required`, surfaces as a `USER_TASK`, and resumes on response.
- **An external worker can never access another tenant's task or payload** (explicit cross-tenant denial test).
- `/metrics` reports queue depth + per-capability backlog + per-binding health sourced from this module's tables and the queue — no dependency on a nonexistent telemetry module.

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual |
|------|----------|---------------|------------|----------|
| Cross-tenant task/payload leak to a worker | High | Worker auth, storage-s3 URLs | Two-column tenancy + `organization_id` filter on every claim/read; scoped, time-limited pre-signed URLs; cross-tenant denial test | Low |
| Duplicate execution under at-least-once delivery | Medium | Dispatch, side effects | Unique `idempotencyKey` per org; authoritative active-lease index; idempotent result writes; OM gates side effects | Low |
| Lost work if a queue message is dropped | Medium | Transport | `AgentTask` is source of truth; sweeper re-dispatches from the table; queue is advisory | Low |
| Stale result from an expired lease overwrites state | Medium | Result endpoint | Reject results whose lease is not `active`; optimistic lock on `AgentTask` | Low |
| A2A TS SDK immature at target version | Medium | A2A client/server | Treat as open question; thin in-house protocol shim fallback for v1 | Medium |
| Worker credential leakage / over-scope | High | Agent principals | Net-new OAuth client-credentials server (identity spec) scoped per capability+tenant, revocable; secret *references* only on `AgentBinding` | Low |
| Pull/A2A transport blocked by missing auth server | Medium | Worker auth | `api_keys` has no client-credentials endpoint today; depends on the identity spec's net-new OAuth client-credentials server (GAP-16). Sequence identity ahead of dispatch Phase 4 | Low |
| Dead-lettered tasks silently lost | Medium | Lifecycle | Dead-letter surfaces for triage (caseload) + event; never auto-dropped | Low |

## Integration Coverage

> Per repo rule, this feature ships executable Playwright integration tests with the change.
> Location: `packages/enterprise/src/modules/agent_orchestrator/__integration__/TC-AGENT-DISP-<NNN>.spec.ts`
> Helpers: `@open-mercato/core/helpers/integration/{auth,api,authFixtures,generalFixtures}` (+ this module's
> `__integration__/helpers/agentFixtures.ts` — principal/grant/binding/task/lease fixtures + two-org isolation helper).
> All fixtures created in setup (prefer API), cleaned in `finally`/teardown. No seeded/demo data; deterministic across
> retries; rely on global config (`timeout 10s`, `expect.timeout 10s`, `retries 1`). See `.ai/qa/AGENTS.md` +
> `.ai/skills/om-integration-tests/SKILL.md`. Cross-ref GAP-17 (`gap-analysis/gap-17-integration-test-coverage.md`).

| API path / UI flow | Method | Must-have tests |
|--------------------|--------|-----------------|
| `DispatchService.enqueue` → `POST .../dispatch/claim` | internal | A registered **internal** agent claims and completes a task through the one `AgentTask` contract (enqueue → routed to internal binding → result → trace handoff); RBAC; org-scoped. |
| `POST .../dispatch/claim` | `POST` | Long-poll claim of next matching task issues exactly one `AgentTaskLease`; RBAC (`agent_orchestrator.task.worker`); only enabled/healthy bindings matched. |
| `POST .../tasks/:id/heartbeat` | `POST` | Active lease extended (`expiresAt`/`heartbeatAt` advance); rejected for a non-active/foreign lease. |
| `POST .../tasks/:id/result` | `POST` | Accepted **only** with the active lease; **optimistic-lock 409** on stale `updatedAt` (`surfaceRecordConflict`); result for an **expired/superseded lease is rejected**; `idempotencyKey` dedupe (duplicate enqueue upserts one `AgentTask`, double-result is idempotent). |
| **Worker E2E `claim→heartbeat→result`** (pull) | E2E | Full pull cycle over scoped agent-principal auth: claim → heartbeat → input (where required) → result; lease lifecycle asserted via `AgentTaskEvent`. |
| **Dead-worker re-dispatch** | E2E | A task whose worker dies (no heartbeat) is re-dispatched after lease expiry by the scheduler sweeper (`attempts++`; `dead_letter` at `maxAttempts`); a **stale result for the expired lease is rejected**. |
| `POST .../tasks/:id/input` | `POST` | `input_required` ↔ `USER_TASK` round-trip: task parks at `input_required`, surfaces as a `USER_TASK`, answer resumes to `running`; RBAC; **optimistic-lock 409** on stale. |
| `POST .../a2a/tasks`, `POST .../a2a/callbacks/:id`, `GET /.well-known/agent-card.json` | `POST`/`GET` | *(if A2A in scope)* Inbound A2A task → `AgentTask(origin='inbound_a2a')`; HMAC/scheme auth (bad signature → 401); OM Agent Card published with the declared capabilities; callback intake maps A2A → `AgentTask` states. |
| `GET .../tasks`, `GET .../tasks/:id`, `GET .../bindings`, `GET .../metrics` | `GET` | CRUD reads return `updatedAt` (editable); org-scoped; RBAC; `/metrics` sourced from this module's tables + queue depth. |
| **Tenant isolation (Critical, mandatory)** | all | A worker/token authenticated for **org B can never claim, read, heartbeat, result, or fetch the payload of org A's task** — explicit cross-tenant denial test on every claim/read/write surface (org B gets 404/403, never the row or a pre-signed URL); two-org setup via `createUserFixture` per org, both cleaned in teardown. |

**Tenant-isolation harness (mandatory for every entity surface):** create two orgs/tenants, seed an `AgentTask`/`AgentBinding`/`AgentTaskLease` in org A, assert org B's agent-principal token gets 404/403 (never the row or its `payloadArtifactKey` pre-signed URL) on claim, read, custom write, and CRUD list. Cleanup both in teardown.

## Migration & Backward Compatibility

- **All net-new tables** (`agent_tasks`, `agent_task_events`, `agent_bindings`, `agent_task_leases`) in the `agent_orchestrator` module — no changes to existing schemas, so no backward-compat surface is touched by dispatch itself.
- New API routes live under `/api/agent_orchestrator/` — additive; no existing route changes.
- New events under `agent_orchestrator.*` — additive; declared `as const` in `events.ts`.
- New ACL features (`agent_orchestrator.*` for view/worker/binding-manage/a2a-inbound) added to `acl.ts` + `setup.ts` `defaultRoleFeatures`; run `yarn mercato auth sync-role-acls`.
- The orchestration spec's `INVOKE_AGENT` activity is a *later* first-class addition; Phase 1 uses an existing `EXECUTE_FUNCTION` step because `workflows` activities are a **fixed enum** (no pluggable registry) — no `workflows` contract change required for v1.
- **Cross-spec sequencing:** the `pull` and `a2a` transports (Phases 4–6) depend on the identity spec's **net-new OAuth client-credentials token server** (`api_keys` exposes no such endpoint today). The internal path (Phases 1–3, the original ask) needs no external auth and can land first; the identity spec MUST land before dispatch Phase 4 (cross-ref GAP-16).
- Run `yarn generate && yarn db:generate` (review SQL + snapshot) before `yarn typecheck && yarn lint && yarn test`.

## Final Compliance Report

- **Module placement:** core module `packages/enterprise/src/modules/agent_orchestrator/`; subdomain code under `lib/dispatch/`. ✓
- **Entities:** MikroORM v7 `/legacy`, explicit `@Property`, two-column tenancy, UUID PK `gen_random_uuid()`, `jsonb`+Zod, `varchar`+TS-union enums, no cross-module ORM relations, editable entities expose `updated_at`, append-only log omits `updated_at`/`deleted_at`. ✓
- **Reads:** `makeCrudRoute` + `indexer` + `openApi`. **Writes:** Command pattern + mutation guard + optimistic lock on `AgentTask`. ✓
- **Events:** `createModuleEvents`, `module.entity.action` past tense. **ACL:** `agent_orchestrator.*` in `acl.ts` + `setup.ts`. ✓
- **Reuse, not reinvention:** `packages/queue` (transport), `packages/scheduler` (sweeper), `storage-s3` (payload), `api_keys`/identity (auth), `webhooks` (A2A callbacks), `workflows` (internal path + HITL). No invented scheduler, no nonexistent telemetry/eval/health modules referenced. ✓
- **Tenancy + security:** cross-tenant denial test; scoped revocable agent-principal credentials; payload-by-reference with scoped URLs; OM gates all side effects. ✓

## Changelog

- **2026-06-20:** Added the `## Integration Coverage` section (per GAP-17) enumerating the dispatch test surface — internal/pull claim+complete through the one `AgentTask` contract, the `claim→heartbeat→result→input` worker cycle, dead-worker re-dispatch after lease expiry with stale-result rejection, the `input_required ↔ USER_TASK` round-trip, `idempotencyKey` dedupe, A2A inbound→`AgentTask` + Agent Card (if in scope), and the mandatory cross-tenant denial harness; anchored to the `.ai/qa` Playwright harness with self-contained fixtures + teardown. Cross-cutting corrections: clarified that **canary/percentage gating is computed inside `TaskRouter`** (deterministic hash-bucket on a stable key) because `feature_toggles` only stores per-`(toggle, tenantId)` overrides and has **no native %-rollout bucketing** (cross-ref GAP-14); made the **net-new OAuth client-credentials dependency explicit** — `api_keys` has no client-credentials endpoint today, so pull/A2A worker auth depends on the identity spec's net-new token server (cross-ref GAP-16) and the identity spec must precede dispatch Phase 4; and confirmed lease/heartbeat is **app-modeled** (the `AgentTaskLease` unique-active-lease index + a scheduler-driven sweeper), not a `packages/scheduler` feature. Added matching Risks rows and a cross-spec sequencing note.
- **2026-06-19:** Rewrote `SPEC-DISPATCH-01` to real OM conventions and the verified 2026-06-19 architecture. Renamed to `2026-06-19-agent-dispatch.md`. Set module id `agent_orchestrator` (core module, not a standalone package); promoted entities to full MikroORM v7 (`AgentTask`, `AgentTaskEvent` complete; `AgentBinding`/`AgentTaskLease` abbreviated with house-style notes), two-column tenancy, `agent_` table prefix. Corrected: lease sweeper uses `packages/scheduler`; A2A push callbacks via the `webhooks` module; worker auth via agent-principal OAuth client-credentials (not bespoke tokens); `/metrics` reads this module's tables + queue depth (telemetry-and-otel does not exist); orchestration drives dispatch via an `EXECUTE_FUNCTION` step in Phase 1 because `workflows` activities are a fixed enum; canonical `agent_orchestrator.*` events and `/api/agent_orchestrator/` paths. Kept the strong original intent: `AgentTask` single source of truth, queue-as-transport, authoritative lease, `idempotencyKey`, payload-by-reference, internal/pull/A2A transports, OM as A2A mesh node, "LLM proposes, OM disposes".
