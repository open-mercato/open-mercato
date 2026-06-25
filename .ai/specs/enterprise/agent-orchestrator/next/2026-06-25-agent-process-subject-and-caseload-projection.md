# Agent Process — Subject Reference & Caseload Projection

> **Status:** Draft (gap delta — not started) · **Owner:** Patryk Lewczuk (Comerito) · **Created:** 2026-06-25
> **Module:** `agent_orchestrator` (enterprise) · **subdomain:** cockpit / processes
> **Builds on:** `2026-06-19-agent-operations-ui.md` (cockpit, 🟡 partial), `2026-06-19-agent-trace-eval-capture.md` (✅ runs/cost), `2026-06-20-agent-eval-harness-and-metrics.md` (✅ corrections/metrics), the orchestration disposition contract in `00-IMPLEMENTED-BASELINE.md` §8.
> **Conventions:** Governed by `2026-06-19-agent-orchestrator-conventions.md` — where an entity/layout/naming detail conflicts, that document wins.
> **Depends:** `workflows` (instance = process, USER_TASK gate, SLA/assignment), `@open-mercato/events`, `@open-mercato/ui`.
> **Prerequisite (blocking for Phase B):** `workflows` must actually **emit** its already-declared `workflows.instance.*` lifecycle events — see [`next/2026-06-26-workflows-emit-instance-lifecycle-events.md`](./2026-06-26-workflows-emit-instance-lifecycle-events.md). They exist in `workflows/events.ts` but are never published to the bus today, so terminal status, non-agent stage transitions, and assignment-driven filters are unbuildable from agent events alone.

> 🔎 **Pre-implementation analysis (2026-06-26):** [`.ai/specs/analysis/ANALYSIS-2026-06-25-agent-process-subject-and-caseload-projection.md`](../../../analysis/ANALYSIS-2026-06-25-agent-process-subject-and-caseload-projection.md). Verdict was "needs spec updates first" (no BC violations; design sound). This revision folds in every fix: **phasing** (agent-event subset ships before the workflow-event prerequisite), the **encryption-vs-filtering column split**, the **ACL-id correction** (`proposals.dispose`; new `processes.view`), and the **`makeCrudRoute` list-route** mechanism.

## TLDR

The "Processes" list and "Process detail" mockups render a **claim-anchored** view: one row per business record (`CLM-2026-04417`, type "Motor", stage "Adjudication"), filterable by *Needs decision / Stuck >24h / High value / Fraud flagged / My team*, with TYPE / STAGE / AGENTS / STATUS / AGE / COST columns. The shipped module has **no business-entity reference** on any agent entity and **no per-process aggregate** — a "Process" today is only the implicit set of `AgentProposal`/`AgentRun` rows sharing a `process_id` (the workflow instance id). This delta closes that gap with two additive changes: **(1) a `subject` reference** carried from the workflow into the agent layer so processes are claim-centric, and **(2) an `AgentProcess` read-model projection** (one row per process) that materializes subject + derived status + cost/agent/age aggregates so the list is filterable and sortable at the mockup's scale without per-row joins. It adds **no new source of truth** — the `workflows` instance stays authoritative; the projection is a denormalized, event-maintained index.

## Overview

What the mockups need that does **not** exist today:

| Mockup element | Backed by today? | Gap |
|---|---|---|
| Row identity = a **claim** (`CLM-2026-04417`), TYPE column ("Motor"), title ("Motor collision — payout adjudication") | ❌ | No `subject` field on `AgentProposal`/`AgentRun` ([`entities.ts:888`](../../../../packages/enterprise/src/modules/agent_orchestrator/data/entities.ts)); case identity lives only inside `WorkflowInstance.context`. |
| **STATUS** chips ("Waiting on you", "Auto-completing", "Fraud hold", "Docs requested", "Question open") | 🟡 partial | `disposition` exists; the rest are not modeled or derived. |
| Filters: **High value**, **Fraud flagged** | ❌ | No business facets (value, fraud signal) reachable from the agent layer. |
| Filters: **Needs decision**, **My team**, **Stuck >24h** | 🟡 partial | Assignment/SLA owned by `workflows`; no agent-side projection to filter/sort on. |
| **AGENTS** avatar stack (AD/DM/FR/CV…) | 🟡 derivable | `agent_id` per run, but only by scanning all runs of a process. |
| **COST** per row, **AGE** | 🟡 derivable | `cost_minor` per run; summing per process per page is an N-row aggregate. |
| List of **4,180** rows, paged + filtered + sorted | ❌ | No per-process row to index. |

The operations-UI overlay deliberately owns **no entities** and reads case context from `workflows` ([`2026-06-19-agent-operations-ui.md:11`](./2026-06-19-agent-operations-ui.md)). That is correct for the *disposition card* and *trace inspector*, which key off a single proposal/run. It is **insufficient** for a claim-centric, multi-thousand-row, faceted **list** — that needs an indexed projection and a subject the agent layer can see.

## Problem Statement

A "Process" in the mockup is a first-class operator object — a claim being worked jointly by agents (propose) and humans (dispose). In the code it is an emergent grouping with no handle: you cannot ask "give me page 2 of high-value motor claims stuck >24h, sorted by cost" without (a) a business-entity reference the agent layer doesn't store and (b) an aggregate row the schema doesn't have. Rendering the list by fanning out across `workflows` instance context + every proposal + every run per page does not scale and couples the cockpit to workflow internals. We need the Process to be **addressable and indexable** without making it a second source of truth.

## Proposed Solution

Two additive layers, no behavior change to existing runtime or disposition:

1. **Subject reference (the "what is this about" handle).** Workflow definitions that invoke agents declare a `subject` descriptor; the `INVOKE_AGENT` boundary reads it from `WorkflowInstance.context` and **adds it to the `agent_orchestrator.proposal.created` event payload** (additive) so the projection subscriber receives it without coupling to `workflows`. The descriptor is `{ subjectType, subjectId, subjectLabel, subjectTitle, valueMinor, currency, fraud }` — e.g. `{ subjectType: 'claim', subjectId: '…', subjectLabel: 'CLM-2026-04417', subjectTitle: 'Motor collision — payout adjudication', valueMinor: 1840000, currency: 'PLN', fraud: false }`. Referenced by **value/id only** (conventions §9 — no cross-module ORM relation to a `claims`/`workflows` entity).

   **Filter-driving facets are first-class typed columns, not a single jsonb blob.** Because the list must SQL-filter/sort by High value / Fraud flagged / TYPE, those facets land in dedicated **plaintext** columns (`subject_value_minor`, `subject_fraud`, `subject_type`) that Postgres can index and range-query — encrypted columns are not queryable. The only free-text, person-readable field, `subject_title`, is **encrypted** via the module's `encryption.ts` (`defaultEncryptionMaps`), matching the precedent that `agent_proposal.payload` / `agent_run.input` are encrypted. A residual `subject_facets` jsonb remains for non-filterable display extras only.

2. **`AgentProcess` projection (the indexable row).** A new entity, **one row per `(tenant, org, processId)`**, maintained by an idempotent event subscriber. It materializes the subject, the derived display `status`, `currentStage`, the participating `agentIds`, summed `costMinor`, `openedAt`/`lastActivityAt`, the pending-decision/assignment/SLA flags, and `waitingSince`. The Processes list and the Process-detail **header** read this projection; the detail **timeline** continues to read existing per-`processId` proposal/run APIs (unchanged). The projection is a cache: it can be fully rebuilt from `workflows` + proposals + runs by a backfill command, and it is never the authority for disposition or workflow state.

### Why a projection rather than denormalizing onto every run/proposal

Stamping `subject` + status onto every `AgentRun`/`AgentProposal` row (the lighter alternative) duplicates the subject across the many rows of a process and still leaves the list doing a `GROUP BY process_id` over the whole table per page. The projection pays one denormalized row per process, indexed for exactly the mockup's filters/sorts, and keeps proposals/runs lean. Subject is therefore carried **into** the projection (and onto the run/proposal only as the transient `ctx` that the subscriber reads), not persisted on every row.

### How "this is one agentic + human work item" is decided

Intrinsically, not heuristically: a process exists the moment an `INVOKE_AGENT` step runs under a workflow instance. That instance **is** the agentic+human unit — agents emit `AgentRun`/`AgentProposal` (propose / *perception*), and the `DispositionService` either auto-approves or raises a `USER_TASK` for a human (dispose / *adjudication*), both keyed to the same `processId` ([`00-IMPLEMENTED-BASELINE.md` §8](../00-IMPLEMENTED-BASELINE.md)). The projection row is **created on the first proposal/run** for a `processId` and **closed** when the workflow instance reaches a terminal state. No record is "promoted" into a process by inference; it is one because a subject-bearing workflow orchestrates it.

## Architecture

- **Workflows instance = the process; `AgentProcess` = its index.** The projection never decides disposition or advances steps; those stay with `workflows` + the orchestration disposition API. Writes to the projection are derived, idempotent, and replaceable by backfill. The subscriber upserts via a plain DI service (not an undoable command — there is no user-facing mutation to undo).
- **Subject flows one way, through the event bus.** `WorkflowInstance.context.subject` → `INVOKE_AGENT` boundary → added to the `proposal.created` payload → subscriber → `AgentProcess`. The agent runtime stays subject-agnostic (subject is opaque metadata it forwards, not something it interprets), and the subscriber never reads a `workflows` entity.
- **Event-maintained, fail-open, in two tiers.** The subscriber consumes the **already-emitted** agent events (`proposal.created`/`proposal.disposed` — both carry `processId` and are `clientBroadcast`; `run.ingested`/`run.completed`/`proposal.corrected` once `processId` is added to their payloads). These alone drive the **Phase A** fields: subject, cost, `agentIds`, `currentStage` (from `stepId`), `pendingProposalCount`, and the disposition-derived statuses. The **Phase B** fields — terminal status (`auto_completed`/`completed`/`failed`/`cancelled`), stage transitions on non-agent steps, and `assigneeUserId`/`teamId`/`waitingSince` (assignment/SLA) — require the `workflows.instance.*` (and task-assignment) events the prerequisite spec adds. If the projection is stale/missing, the list degrades to showing the process by `processId` + workflow name (no facets) rather than failing.
- **No new SSE channel.** Live list updates ride existing `clientBroadcast` events; the cockpit refetches the affected projection row.
- **Tenant-scoped everywhere.** Every projection read/write filters `organization_id`; the list never crosses tenant or (for *My team*) the operator's assignment scope.

## Data Models

### New entity — `AgentProcess` (read-model projection)

One row per process. Mutable (carries `updated_at`), soft-deletable, optimistic-lock-eligible per the project default. Other modules referenced by FK id only.

```typescript
export type AgentProcessStatus =
  | 'running'           // instance active; latest agent step executing; no pending decision
  | 'waiting_on_you'    // a pending proposal raised a USER_TASK assigned to viewer / their team
  | 'question_open'     // agent raised an informative clarification USER_TASK
  | 'docs_requested'    // a document-request task is open (facet/task-kind driven)
  | 'fraud_hold'        // a fraud signal/guard parked the process
  | 'auto_completing'   // proposal(s) auto_approved; workflow advancing unattended
  | 'auto_completed'    // instance completed with all-auto dispositions
  | 'completed'         // instance completed with ≥1 human disposition
  | 'failed' | 'cancelled'

// One LIVE projection per (tenant, org, process) is enforced by a PARTIAL unique
// index over live rows (`WHERE deleted_at IS NULL`). The `@Unique` decorator cannot
// express a WHERE clause, so that index is hand-written in the migration (precedent:
// `agent_principals_org_agent_uq`, Migration20260625050000). The composite index
// below covers the common lookup; the partial unique is added by raw SQL.
@Entity({ tableName: 'agent_processes' })
@Index({ name: 'agent_processes_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_processes_process_idx', properties: ['tenantId', 'organizationId', 'processId'] })
@Index({ name: 'agent_processes_status_idx', properties: ['organizationId', 'status', 'lastActivityAt'] })
@Index({ name: 'agent_processes_assignee_idx', properties: ['organizationId', 'assigneeUserId'] })
@Index({ name: 'agent_processes_value_idx', properties: ['organizationId', 'subjectValueMinor'] })
export class AgentProcess {
  [OptionalProps]?: 'status' | 'currentStage' | 'subjectTitle' | 'subjectFacets'
    | 'subjectValueMinor' | 'subjectFraud' | 'subjectType'
    | 'agentIds' | 'costMinor' | 'currency' | 'runCount' | 'pendingProposalCount'
    | 'assigneeUserId' | 'teamId' | 'waitingSince' | 'lastActivityAt'
    | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** FK id → workflows instance; NOT an ORM relation. Unique per (tenant, org). */
  @Property({ name: 'process_id', type: 'uuid' })
  processId!: string

  @Property({ name: 'workflow_id', type: 'varchar', length: 200, nullable: true })
  workflowId?: string | null

  @Property({ name: 'workflow_version', type: 'varchar', length: 50, nullable: true })
  workflowVersion?: string | null

  // ── Subject (business record this process is about) ─────────────────────────
  @Property({ name: 'subject_type', type: 'varchar', length: 100, nullable: true })
  subjectType?: string | null         // e.g. 'claim'

  @Property({ name: 'subject_id', type: 'varchar', length: 200, nullable: true })
  subjectId?: string | null           // business record id (opaque)

  @Property({ name: 'subject_label', type: 'varchar', length: 200, nullable: true })
  subjectLabel?: string | null        // e.g. 'CLM-2026-04417' (claim ref — low sensitivity, kept plaintext for `q` search)

  /**
   * Free-text, person-readable subject. The ONLY subject field encrypted at rest
   * (declared in encryption.ts → defaultEncryptionMaps for 'agent_orchestrator:agent_process').
   * Not used by SQL filters; rendered only in the detail header / row title.
   */
  @Property({ name: 'subject_title', type: 'varchar', length: 300, nullable: true })
  subjectTitle?: string | null        // e.g. 'Motor collision — payout adjudication'

  // ── Filter-driving facets: PLAINTEXT typed columns (must be SQL-queryable) ───
  @Property({ name: 'subject_type', type: 'varchar', length: 100, nullable: true })
  subjectType?: string | null         // e.g. 'Motor' (TYPE column + filter)

  @Property({ name: 'subject_value_minor', type: 'bigint', nullable: true })
  subjectValueMinor?: number | null   // claim value in minor units (High value filter / value sort)

  @Property({ name: 'subject_fraud', type: 'boolean', nullable: true })
  subjectFraud?: boolean | null       // fraud signal (Fraud flagged filter)

  /** Non-filterable display extras only (never queried in SQL). Zod-validated. */
  @Property({ name: 'subject_facets', type: 'jsonb', nullable: true })
  subjectFacets?: unknown | null

  // ── Derived display + aggregates ────────────────────────────────────────────
  @Property({ name: 'status', type: 'varchar', length: 30, default: 'running' })
  status: AgentProcessStatus = 'running'

  @Property({ name: 'current_stage', type: 'varchar', length: 100, nullable: true })
  currentStage?: string | null

  /** Distinct agent ids that have run under this process (AGENTS column). */
  @Property({ name: 'agent_ids', type: 'jsonb', nullable: true })
  agentIds?: string[] | null

  @Property({ name: 'cost_minor', type: 'bigint', nullable: true })
  costMinor?: number | null

  @Property({ name: 'currency', type: 'varchar', length: 3, nullable: true })
  currency?: string | null

  @Property({ name: 'run_count', type: 'integer', default: 0 })
  runCount = 0

  @Property({ name: 'pending_proposal_count', type: 'integer', default: 0 })
  pendingProposalCount = 0

  // ── Routing / SLA (mirrored from workflows for fast filtering) ───────────────
  @Property({ name: 'assignee_user_id', type: 'uuid', nullable: true })
  assigneeUserId?: string | null

  @Property({ name: 'team_id', type: 'uuid', nullable: true })
  teamId?: string | null

  @Property({ name: 'waiting_since', type: Date, nullable: true })
  waitingSince?: Date | null          // when it entered a human-waiting state (Stuck >24h)

  @Property({ name: 'opened_at', type: Date })
  openedAt!: Date                     // = workflow instance start (AGE)

  @Property({ name: 'last_activity_at', type: Date, onCreate: () => new Date() })
  lastActivityAt: Date = new Date()

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
```

### Additive event-payload changes (no schema change to runs/proposals)

Subject and correlation reach the subscriber through **additive event-payload fields** — `AgentRun`/`AgentProposal` gain **no** new columns:

| Event | Add | Why |
|---|---|---|
| `agent_orchestrator.proposal.created` | `subject` (the descriptor object) | Subscriber populates the projection's subject without reading `workflows`. Already carries `processId`/`stepId`. |
| `agent_orchestrator.proposal.corrected` | `processId` | Correction events can be joined to a process (missing today). |
| `agent_orchestrator.run.ingested` | `processId` | Run-cost rollup can be joined to a process (missing today). |

All three are additive optional payload fields (BC §5 — allowed). Source of the descriptor: a `subject` block in the workflow definition's `INVOKE_AGENT` node config (static or a context-path expression resolved against `WorkflowInstance.context`), read at the bridge boundary. Run `yarn generate` after editing `events.ts` payload docs.

**bigint serialization:** `cost_minor` / `subject_value_minor` are `bigint` columns, but the list/detail routes read the **projection entity** (MikroORM hydrates bigint → JS `number`), so `NextResponse.json` serializes them as plain numbers — no boundary normalization needed (cf. lessons.md "bigint at the JSON boundary", which bites only raw-SQL aggregate routes). The **backfill**, if it sums cost via raw SQL, must coerce the `::bigint` result to `number` before writing the projection.

### Status derivation (precedence — first match wins)

Computed by the subscriber on every relevant event; stored in `AgentProcess.status`. The right column marks which tier the branch belongs to — **A** = derivable from agent events alone (ships first); **B** = needs the `workflows.instance.*` prerequisite:

| # | Condition | → status | Tier |
|---|---|---|---|
| 1 | instance terminal `failed`/`cancelled` | `failed`/`cancelled` | **B** |
| 2 | fraud facet/guard verdict set and process parked | `fraud_hold` | A |
| 3 | open document-request task | `docs_requested` | A |
| 4 | open informative clarification USER_TASK | `question_open` | A |
| 5 | pending actionable proposal with a USER_TASK | `waiting_on_you` | A |
| 6 | instance terminal, all dispositions `auto_approved` | `auto_completed` | **B** |
| 7 | instance terminal, ≥1 human disposition | `completed` | **B** |
| 8 | latest disposition `auto_approved`, instance still advancing | `auto_completing` | A |
| 9 | otherwise | `running` | A |

Until Phase B lands, a process that has stopped producing agent events but whose instance terminal signal is unavailable stays at its last A-tier status (e.g. `auto_completing`) rather than flipping to `auto_completed`; the backfill can reconcile terminal states from `workflows` on demand. SLA countdown badges ("SLA 4h12m") are **not** stored — they render client-side from the workflows task SLA already surfaced on the disposition card.

## API Contracts

Two new read routes (list + header). The timeline, disposition, and trace reads are unchanged (sibling specs).

**`GET /api/agent_orchestrator/processes`** — paged, faceted list (powers the Processes table). Built with **`makeCrudRoute`** (`indexer: { entityType: 'agent_orchestrator:agent_process' }`), modeled on the shipped `api/proposals/route.ts` — `list: { schema, entityId, fields, sortFieldMap, buildFilters }`. Per-method `metadata`: `{ GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.processes.view'] } }`. Response envelope is the CRUD-factory standard **`{ items, total, page, pageSize, totalPages }`** (raw — no `{ data }` wrapper), matching every other list route in the module.
- Query (Zod, `pageSize` ≤ 100): `scope` (`all` | `needs_decision` | `stuck_24h` | `high_value` | `fraud_flagged` | `my_team`), `q` (subjectLabel/title search), `subjectType`, `status`, `sort` (`age` | `cost` | `value` | `lastActivity`), `page`, `pageSize`.
- `buildFilters` maps facet filters to plaintext columns: `high_value` → `subject_value_minor ≥ threshold`, `fraud_flagged` → `subject_fraud = true`, `subjectType` → `subject_type = …`, `stuck_24h` → `waiting_since ≤ now-24h`. `high_value` threshold and `stuck_24h` window are tenant settings (defaults: value ≥ configurable; age ≥ 24h).
- `my_team` / `needs_decision` need the caller's identity, which `buildFilters(query)` lacks — resolve `assigneeUserId`/`teamId` from auth in the route and pass them into the filter. **Note:** these scopes depend on `assignee_user_id`/`team_id` being populated, which is a **Phase B** (workflow-event) field; pre-Phase-B they return empty/degraded and the UI hides those tabs.
- Filtered by `organization_id` (+ `tenant_id`) always.

**`GET /api/agent_orchestrator/processes/:id`** — single projection row for the Process-detail header (subject, stages, aggregates, assignment/SLA), read via `findOneWithDecryption` (so `subject_title` decrypts) with `{ ...scope, deletedAt: null }`. The detail page composes this with the existing `GET /proposals?processId=…` + `GET /runs/:id` for the three-lane timeline. Returns 404 (never the row) cross-tenant.

**Actions (Pause / Reassign / Take over)** proxy `workflows` instance/task APIs — they are **not** new agent routes. "Take over" = claim the parked USER_TASK to the current operator (and, where supported, set remaining steps to manual review). If `workflows` lacks a needed verb, that is a `workflows` dependency to raise separately (out of scope here). All writes go through `useGuardedMutation(...).runMutation(...)`; 409s via `surfaceRecordConflict(err, t)`.

**Backfill CLI:** `yarn mercato agent_orchestrator rebuild-processes [--tenant …]` reconstructs `agent_processes` from `workflows` instances + proposals + runs (idempotent upsert), for first rollout and drift repair.

## Events

**Confirmed against `events.ts`:** all four agent events exist and use `createModuleEvents(... as const)`. `agent_orchestrator.proposal.created` and `…proposal.disposed` are `clientBroadcast` **and already carry `processId`** — they are the projection's primary drivers. `agent_orchestrator.run.ingested` and `…proposal.corrected` exist but **lack `processId`** today → this spec adds it (additive, see the event-payload table above), and adds `subject` to `proposal.created`.

**The blocking gap:** `workflows/events.ts` **declares** `workflows.instance.{created,started,completed,failed,cancelled,paused,resumed}` but **no code emits them** — they are not on the bus. The projection's terminal/stage/assignment fields therefore depend on the prerequisite spec [`2026-06-26-workflows-emit-instance-lifecycle-events.md`](./2026-06-26-workflows-emit-instance-lifecycle-events.md) actually publishing them (plus a task-assignment signal). This is additive in `workflows` (the IDs already exist) but is a **core-module change** — "Ask First" per root `AGENTS.md`.

Optionally emits `agent_orchestrator.process.updated` (`clientBroadcast: true`) so the open list refetches a changed row; degrade to poll if not added.

## Access Control

Additive ACL features in `acl.ts` + `setup.ts` `defaultRoleFeatures`, synced via `yarn mercato auth sync-role-acls`:
- **New:** `agent_orchestrator.processes.view` — read the Processes list + detail header. (Plural `processes`, matching the existing `agent_orchestrator.proposals.*` / `agent_orchestrator.agents.*` convention.)
- Mirror the new feature in `setup.ts` `defaultRoleFeatures`: granted to `superadmin`/`admin` via the existing `agent_orchestrator.*` wildcard, and added to the `operator`/`engineer`/`employee` grant sets alongside `agent_orchestrator.proposals.view`.
- Disposition reuses the **existing** `agent_orchestrator.proposals.dispose` (note: **plural** `proposals` — the singular `agent_orchestrator.proposal.dispose` does not exist; correct any sibling spec that references it). Pause/Reassign/Take-over reuse the relevant `workflows` features (never role names — feature-gated, immutable ids).

## Phases

Split so the agent-event-derivable value ships **without** waiting on the core `workflows` change; the workflow-dependent fields follow as Phase B once the prerequisite lands.

**Phase 0 (prerequisite, separate spec/PR, Ask First):** `workflows` emits its declared `workflows.instance.*` lifecycle events + a task-assignment signal. Not part of this module's PR; tracked by `2026-06-26-workflows-emit-instance-lifecycle-events.md`.

1. **Subject plumbing.** `subject` descriptor convention in `INVOKE_AGENT` config; read it at the bridge boundary and add it to the `proposal.created` payload; add `processId` to `proposal.corrected` + `run.ingested`. `yarn generate`. Example wired into `agent_examples`.
2. **`AgentProcess` projection + subscriber + backfill (Phase A fields).** Entity + migration (incl. hand-written partial unique index) + snapshot; `encryption.ts` map for `subject_title`; idempotent subscriber→service upsert implementing the **A-tier** derivation branches (subject, cost, `agentIds`, stepId-stage, disposition statuses, `pendingProposalCount`); `rebuild-processes` CLI (first command in a new `cli.ts`). Unit tests on derivation precedence and idempotent upsert.
3. **List + header APIs.** `GET /processes` via `makeCrudRoute` (filters/sort/pagination, tenant scoping, auth-scoped `my_team`/`needs_decision`) and `GET /processes/:id` via `findOneWithDecryption`; ACL feature `processes.view` + role grants; OpenAPI specs.
4. **Cockpit wiring.** Point the Processes list + Process-detail header at the new APIs (replacing the caseload's live cross-join compute); keep the timeline on existing proposal/run reads; status chips/filters via DS status tokens; all strings i18n. Hide `Stuck >24h`/`My team` tabs until Phase B.
5. **Phase B (after Phase 0 lands).** Consume `workflows.instance.*` + assignment events to populate terminal status, non-agent stage transitions, and `assigneeUserId`/`teamId`/`waitingSince`; enable the deferred filters; extend the subscriber's B-tier branches.

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual |
|---|---|---|---|---|
| `workflows.instance.*` declared but never emitted | High | Terminal status, non-agent stages, assignment filters | Phased: ship Phase A from agent events; gate Phase B on the prerequisite spec emitting the (already-declared) events; backfill reconciles terminal states from `workflows` on demand | Medium until Phase 0 lands |
| Encryption vs SQL filtering on subject facets | High | High value / Fraud / TYPE filters | Split: plaintext typed columns (`subject_value_minor`/`subject_fraud`/`subject_type`) for filtering+sort; encrypt only free-text `subject_title` via `encryption.ts` | Low |
| Subject not on `proposal.created` payload today | Medium | Subject population | Add `subject` to the payload (additive); subscriber stays decoupled from `workflows` | Low |
| Projection drifts from `workflows`/proposals (missed event) | Medium | List correctness | Idempotent upsert keyed on `processId`; `rebuild-processes` backfill; list degrades to processId+name when a row is missing | Low |
| Subject absent on legacy/3rd-party workflows | Medium | Claim-centric list | Subject is optional; processes without it still list by workflow name (no facets); document the `subject` convention for workflow authors | Low |
| Denormalized facets (value/fraud) go stale vs the source record | Medium | High value / Fraud flagged filters | Facets are a point-in-time snapshot stamped at run time; re-stamped on each new run; treat as advisory triage signal, not authority | Medium |
| Cross-tenant / cross-operator leakage in list | High | RBAC/tenancy | All reads filter `organization_id`; `my_team`/`needs_decision` scope to assignment; explicit tenant-isolation tests | Low |
| Projection treated as a second source of truth | High | Architecture | Spec + code comments: read-model only; disposition/workflow writes never touch it directly; rebuildable cache | Low |
| `status` taxonomy diverges from real business states | Low | Display | Precedence table is the contract; `fraud_hold`/`docs_requested` driven by facets/task-kind so new states extend the facet vocabulary, not the enum churn | Low |

## Migration & Backward Compatibility

Fully **additive** per `BACKWARD_COMPATIBILITY.md`:
- New table `agent_processes` (new entity) + migration (incl. a hand-written partial unique index over live rows) + `migrations/.snapshot-open-mercato.json` update. No change to existing tables.
- No change to `AgentRun`/`AgentProposal` columns (subject travels in event payloads, not as a column).
- New optional payload fields: `subject` on `proposal.created`; `processId` on `proposal.corrected` + `run.ingested` (BC §5 — adding optional payload fields is non-breaking; existing subscribers ignore them).
- New read-only API routes + new ACL feature `agent_orchestrator.processes.view` (adding routes/features is additive).
- New optional `process.updated` event (additive emission).
- **Cross-module (Phase 0):** emitting the already-declared `workflows.instance.*` events is additive (no new IDs, no rename) but is a change to a core module — handled in the separate prerequisite spec, "Ask First".
No FROZEN/STABLE surface is modified; nothing is removed, so no deprecation bridge is required.

## Integration Coverage

> Ships executable Playwright integration tests with the change.
> Location: `packages/enterprise/src/modules/agent_orchestrator/__integration__/TC-AGENT-PROCESS-<NNN>.spec.ts`.
> Helpers: `@open-mercato/core/helpers/integration/{auth,api,authFixtures,generalFixtures}` + this module's `__integration__/helpers/agentFixtures.ts` (proposal/run/process fixtures). All fixtures created in setup (prefer API), cleaned in `finally`/teardown; no seeded/demo data; deterministic across retries.

| API path / flow | Method | Must-have tests |
|---|---|---|
| Subscriber builds a process row | (event) | Creating a subject-bearing run+proposal upserts exactly one `agent_processes` row with subject, `agentIds`, `costMinor`, `openedAt`; a second run on the same `processId` updates (not duplicates) it |
| Status derivation | (event) | Each precedence branch (`running`→`waiting_on_you`→`auto_completing`→`auto_completed`/`completed`, plus `fraud_hold`/`docs_requested`/`question_open`) resolves to the documented status |
| Processes list — filters | `GET /processes` | `needs_decision`, `stuck_24h`, `high_value`, `fraud_flagged`, `my_team` each return the right subset; `pageSize` ≤ 100 enforced; sort by age/cost/value stable |
| Processes list — search | `GET /processes?q=` | Matches `subjectLabel`/`subjectTitle`; empty result renders empty (no error) |
| Process detail header | `GET /processes/:id` | Returns subject + stage + aggregates; the page composes it with existing proposal/run timeline reads (same `processId`) |
| Backfill | CLI | `rebuild-processes` reconstructs rows from workflows+proposals+runs idempotently; re-running is a no-op |
| Subject absent | `GET /processes` | A process with no `subject` still lists (by workflow name), with null facets and no crash |
| RBAC | `GET /processes` | A user without `agent_orchestrator.process.view` is denied list + detail |
| **Tenant isolation (Critical)** | `GET /processes`, `/processes/:id` | Org B never sees org A's process rows; opening org A's `:id` from org B's token returns 404/403, never the row |
| DS-token / i18n | UI | Status chips use DS status tokens (`text-status-*` / `bg-status-*`) only; all strings from `i18n/<locale>.json` |

**Tenant-isolation harness (mandatory):** two orgs; seed a subject-bearing process in org A; assert org B sees an empty list and 404/403 on org A's `:id`; cleanup both in teardown.

## Final Compliance Report

- **Architecture:** Read-model projection only; `workflows` instance stays authoritative; cross-module refs by FK id (no ORM relations); rebuildable from source.
- **Tenancy:** All reads/writes filter `organization_id`; assignment-scoped `my_team`/`needs_decision`; explicit cross-tenant denial tests.
- **HTTP/UI:** `apiCall*` only; non-`CrudForm` writes via `useGuardedMutation(...).runMutation(...)` with `retryLastMutation`; 409 via `surfaceRecordConflict`; `LoadingMessage`/`ErrorMessage` boundaries.
- **Design system:** Status chips use DS status tokens; no raw Tailwind status colors, no arbitrary values, no `dark:` on status tokens.
- **i18n:** No hard-coded user-facing strings; `useT()`/`resolveTranslations()`.
- **Data:** Zod validators for `subject_facets` + list query; types via `z.infer`; no `any`.
- **Encryption:** free-text `subject_title` declared in `encryption.ts` `defaultEncryptionMaps` (`agent_orchestrator:agent_process`) and read via `findWithDecryption`/`findOneWithDecryption`, matching the module precedent (`agent_proposal.payload`, `agent_run.input/output`). Filter-driving facets (`subject_value_minor`/`subject_fraud`/`subject_type`) are deliberately plaintext typed columns because they must be SQL-queryable — documented as advisory triage data, not the authoritative business record (which stays in the source module).
- **Optimistic locking:** `agent_processes` is a derived projection (not user-edited), maintained by a subscriber→service upsert (not an undoable command); list/detail are reads. The process **actions** (dispose/takeover) lock the underlying proposal/workflow task they target, not the projection.
- **bigint:** projection columns are read as entity fields (hydrated to JS `number`); only the raw-SQL backfill coerces `::bigint`. No JSON-boundary serialization issue.
- **BC:** Additive only — new entity/table/routes/feature/event + optional payload fields; nothing removed or changed.

## Changelog

- **2026-06-26:** Folded in the pre-implementation analysis ([`ANALYSIS-2026-06-25-…`](../../../analysis/ANALYSIS-2026-06-25-agent-process-subject-and-caseload-projection.md)). Changes: (1) **phasing** — Phase A (subject, cost, agents, stepId-stage, disposition statuses, pending count) is built from the agent events that already carry `processId`; Phase B (terminal status, non-agent stages, assignment/SLA filters) is gated on a new Phase-0 prerequisite spec that makes `workflows` actually emit its declared `workflows.instance.*` events. (2) **Encryption/filter split** — filter-driving facets become plaintext typed columns (`subject_value_minor`/`subject_fraud`/`subject_type`); only free-text `subject_title` is encrypted via `encryption.ts`. (3) **ACL fix** — new feature is `agent_orchestrator.processes.view` (plural); disposition reuses the real `agent_orchestrator.proposals.dispose` (the singular id referenced earlier does not exist). (4) **Subject now travels via additive event-payload fields** (`subject` on `proposal.created`; `processId` added to `proposal.corrected`/`run.ingested`) rather than a vague transient `ctx`, keeping the subscriber decoupled from `workflows`. (5) **List route pinned to `makeCrudRoute`** with the `{ items, total, page, pageSize, totalPages }` envelope; detail read via `findOneWithDecryption`. (6) `@Unique` partial index via hand-written migration; bigint read as entity field (no JSON-boundary issue).
- **2026-06-25:** Initial draft. Filed as the gap delta behind the "Processes" / "Process detail" mockups: adds a `subject` reference convention and a new `AgentProcess` read-model projection (one row per `processId`) with a status-derivation precedence table, faceted list + header APIs, an event-maintained subscriber, and a `rebuild-processes` backfill. Explicitly additive; positioned as the claim-centric backing the UI-only operations cockpit (`2026-06-19-agent-operations-ui.md`) cannot provide on its own.
