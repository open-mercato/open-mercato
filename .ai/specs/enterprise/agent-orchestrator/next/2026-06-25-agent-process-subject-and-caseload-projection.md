# Agent Process — Subject Reference & Caseload Projection

> **Status:** Draft (gap delta — not started) · **Owner:** Patryk Lewczuk (Comerito) · **Created:** 2026-06-25
> **Module:** `agent_orchestrator` (enterprise) · **subdomain:** cockpit / processes
> **Builds on:** `2026-06-19-agent-operations-ui.md` (cockpit, 🟡 partial), `2026-06-19-agent-trace-eval-capture.md` (✅ runs/cost), `2026-06-20-agent-eval-harness-and-metrics.md` (✅ corrections/metrics), the orchestration disposition contract in `00-IMPLEMENTED-BASELINE.md` §8.
> **Conventions:** Governed by `2026-06-19-agent-orchestrator-conventions.md` — where an entity/layout/naming detail conflicts, that document wins.
> **Depends:** `workflows` (instance = process, USER_TASK gate, SLA/assignment), `@open-mercato/events`, `@open-mercato/ui`.

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

1. **Subject reference (the "what is this about" handle).** Workflow definitions that invoke agents declare a `subject` descriptor; the `INVOKE_AGENT` executor stamps it into the agent layer alongside the existing `processId`/`stepId`. The subject is `{ subjectType, subjectId, subjectLabel, subjectTitle, facets }` — e.g. `{ subjectType: 'claim', subjectId: '…', subjectLabel: 'CLM-2026-04417', subjectTitle: 'Motor collision — payout adjudication', facets: { type: 'Motor', valueMinor: 1840000, currency: 'PLN', fraud: false } }`. Referenced by **value/id only** (conventions §9 — no cross-module ORM relation to a `claims`/`workflows` entity).

2. **`AgentProcess` projection (the indexable row).** A new entity, **one row per `(tenant, org, processId)`**, maintained by an event subscriber. It materializes the subject, the derived display `status`, `currentStage`, the participating `agentIds`, summed `costMinor`, `openedAt`/`lastActivityAt`, the pending-decision/assignment/SLA flags, and `waitingSince`. The Processes list and the Process-detail **header** read this projection; the detail **timeline** continues to read existing per-`processId` proposal/run APIs (unchanged). The projection is a cache: it can be fully rebuilt from `workflows` + proposals + runs by a backfill command, and it is never the authority for disposition or workflow state.

### Why a projection rather than denormalizing onto every run/proposal

Stamping `subject` + status onto every `AgentRun`/`AgentProposal` row (the lighter alternative) duplicates the subject across the many rows of a process and still leaves the list doing a `GROUP BY process_id` over the whole table per page. The projection pays one denormalized row per process, indexed for exactly the mockup's filters/sorts, and keeps proposals/runs lean. Subject is therefore carried **into** the projection (and onto the run/proposal only as the transient `ctx` that the subscriber reads), not persisted on every row.

### How "this is one agentic + human work item" is decided

Intrinsically, not heuristically: a process exists the moment an `INVOKE_AGENT` step runs under a workflow instance. That instance **is** the agentic+human unit — agents emit `AgentRun`/`AgentProposal` (propose / *perception*), and the `DispositionService` either auto-approves or raises a `USER_TASK` for a human (dispose / *adjudication*), both keyed to the same `processId` ([`00-IMPLEMENTED-BASELINE.md` §8](../00-IMPLEMENTED-BASELINE.md)). The projection row is **created on the first proposal/run** for a `processId` and **closed** when the workflow instance reaches a terminal state. No record is "promoted" into a process by inference; it is one because a subject-bearing workflow orchestrates it.

## Architecture

- **Workflows instance = the process; `AgentProcess` = its index.** The projection never decides disposition or advances steps; those stay with `workflows` + the orchestration disposition API. Writes to the projection are derived, idempotent, and replaceable by backfill.
- **Subject flows one way.** Workflow definition/instance context → `INVOKE_AGENT` `ctx.subject` → subscriber → `AgentProcess`. The agent runtime stays subject-agnostic (subject is opaque metadata it forwards, not something it interprets).
- **Event-maintained, fail-open.** A subscriber on the events the trace/orchestration specs already emit (`run.ingested`, `proposal.created`/`proposal.disposed`/`proposal.corrected`) plus a workflow instance lifecycle signal upserts the projection. If the projection is stale/missing, the list degrades to showing the process by `processId` + workflow name (no facets) rather than failing.
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

@Entity({ tableName: 'agent_processes' })
@Index({ name: 'agent_processes_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_processes_process_uq', properties: ['tenantId', 'organizationId', 'processId'] }) // unique
@Index({ name: 'agent_processes_status_idx', properties: ['organizationId', 'status', 'lastActivityAt'] })
@Index({ name: 'agent_processes_assignee_idx', properties: ['organizationId', 'assigneeUserId'] })
export class AgentProcess {
  [OptionalProps]?: 'status' | 'currentStage' | 'subjectTitle' | 'subjectFacets'
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
  subjectLabel?: string | null        // e.g. 'CLM-2026-04417'

  @Property({ name: 'subject_title', type: 'varchar', length: 300, nullable: true })
  subjectTitle?: string | null        // e.g. 'Motor collision — payout adjudication'

  /** Filter/sort facets (type, valueMinor, currency, fraud, …). Zod-validated. */
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

### Additive `ctx` extension (no schema change)

The `INVOKE_AGENT` executor passes an optional `ctx.subject` (the descriptor above) into `agentRuntime.run`. The runtime forwards it to the persistence/event boundary so the subscriber can read it; it is **not** a new column on `AgentRun`/`AgentProposal`. Source of the descriptor: a `subject` block in the workflow definition's `INVOKE_AGENT` node config (static or a context-path expression resolved against `WorkflowInstance.context`).

### Status derivation (precedence — first match wins)

Computed by the subscriber on every relevant event; stored in `AgentProcess.status`:

1. instance terminal `failed`/`cancelled` → `failed`/`cancelled`
2. fraud facet/guard verdict set and process parked → `fraud_hold`
3. open document-request task → `docs_requested`
4. open informative clarification USER_TASK → `question_open`
5. pending actionable proposal with a USER_TASK → `waiting_on_you`
6. instance terminal, all dispositions `auto_approved` → `auto_completed`
7. instance terminal, ≥1 human disposition → `completed`
8. latest disposition `auto_approved`, instance still advancing → `auto_completing`
9. otherwise → `running`

SLA countdown badges ("SLA 4h12m") are **not** stored — they render client-side from the workflows task SLA already surfaced on the disposition card.

## API Contracts

Two new read routes (list + header). The timeline, disposition, and trace reads are unchanged (sibling specs).

**`GET /api/agent_orchestrator/processes`** — paged, faceted list (powers the Processes table).
- Query: `scope` (`all` | `needs_decision` | `stuck_24h` | `high_value` | `fraud_flagged` | `my_team`), `q` (subjectLabel/title search), `subjectType`, `status`, `sort` (`age` | `cost` | `value` | `lastActivity`), `page`, `pageSize` (≤ 100).
- `high_value` threshold and `stuck_24h` window are tenant settings (defaults: value ≥ configurable; age ≥ 24h on `waitingSince`).
- Returns projection rows + `total`. Filtered by `organization_id`; `my_team`/`needs_decision` additionally scope to the operator's assignment.

**`GET /api/agent_orchestrator/processes/:id`** — single projection row for the Process-detail header (subject, stages, aggregates, assignment/SLA). The detail page composes this with the existing `GET /proposals?processId=…` + `GET /runs/:id` for the three-lane timeline.

**Actions (Pause / Reassign / Take over)** proxy `workflows` instance/task APIs — they are **not** new agent routes. "Take over" = claim the parked USER_TASK to the current operator (and, where supported, set remaining steps to manual review). If `workflows` lacks a needed verb, that is a `workflows` dependency to raise separately (out of scope here). All writes go through `useGuardedMutation(...).runMutation(...)`; 409s via `surfaceRecordConflict(err, t)`.

**Backfill CLI:** `yarn mercato agent_orchestrator rebuild-processes [--tenant …]` reconstructs `agent_processes` from `workflows` instances + proposals + runs (idempotent upsert), for first rollout and drift repair.

## Events

Consumes (no new emissions required): `agent_orchestrator.run.ingested`, `agent_orchestrator.proposal.created`, `agent_orchestrator.proposal.disposed`, `agent_orchestrator.proposal.corrected` (verify exact ids against `events.ts` at implementation), plus a `workflows` instance lifecycle signal for open/stage/terminal transitions. Optionally emits `agent_orchestrator.process.updated` (`clientBroadcast: true`) so the open list refetches a changed row; degrade to poll if not added.

## Access Control

Additive ACL features in `acl.ts` + `setup.ts` `defaultRoleFeatures`, synced via `yarn mercato auth sync-role-acls`:
- `agent_orchestrator.process.view` — read the Processes list + detail header.
- Disposition reuses the existing `agent_orchestrator.proposal.dispose`; Pause/Reassign/Take-over reuse the relevant `workflows` features (never role names — feature-gated, immutable ids).

## Phases

1. **Subject plumbing.** `subject` descriptor convention in `INVOKE_AGENT` config; forward `ctx.subject` through `agentRuntime.run` to the persistence/event boundary. No schema change. Example wired into `agent_examples`.
2. **`AgentProcess` projection + subscriber + backfill.** Entity + migration + snapshot; event subscriber implementing the derivation table; `rebuild-processes` CLI. Unit tests on derivation precedence and idempotent upsert.
3. **List + header APIs.** `GET /processes` (filters/sort/pagination, tenant + assignment scoping) and `GET /processes/:id`; ACL feature; OpenAPI specs.
4. **Cockpit wiring.** Point the Processes list + Process-detail header at the new APIs (replacing any live cross-join compute); keep the timeline on existing proposal/run reads; status chips/filters via DS status tokens; all strings i18n.

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual |
|---|---|---|---|---|
| Projection drifts from `workflows`/proposals (missed event) | Medium | List correctness | Idempotent upsert keyed on `processId`; `rebuild-processes` backfill; list degrades to processId+name when a row is missing | Low |
| Subject absent on legacy/3rd-party workflows | Medium | Claim-centric list | Subject is optional; processes without it still list by workflow name (no facets); document the `subject` convention for workflow authors | Low |
| Denormalized facets (value/fraud) go stale vs the source record | Medium | High value / Fraud flagged filters | Facets are a point-in-time snapshot stamped at run time; re-stamped on each new run; treat as advisory triage signal, not authority | Medium |
| Cross-tenant / cross-operator leakage in list | High | RBAC/tenancy | All reads filter `organization_id`; `my_team`/`needs_decision` scope to assignment; explicit tenant-isolation tests | Low |
| Projection treated as a second source of truth | High | Architecture | Spec + code comments: read-model only; disposition/workflow writes never touch it directly; rebuildable cache | Low |
| `status` taxonomy diverges from real business states | Low | Display | Precedence table is the contract; `fraud_hold`/`docs_requested` driven by facets/task-kind so new states extend the facet vocabulary, not the enum churn | Low |

## Migration & Backward Compatibility

Fully **additive** per `BACKWARD_COMPATIBILITY.md`:
- New table `agent_processes` (new entity) + migration + `migrations/.snapshot-open-mercato.json` update. No change to existing tables.
- No change to `AgentRun`/`AgentProposal` columns (subject travels as transient `ctx`, not a column).
- New, optional `ctx.subject` on the `INVOKE_AGENT` boundary — absent means today's behavior, unchanged.
- New read-only API routes + new ACL feature (adding routes/features is additive).
- New optional `process.updated` event (additive emission).
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
- **Optimistic locking:** `agent_processes` is a derived projection (not user-edited), so list/detail are reads; the process **actions** (dispose/takeover) lock the underlying proposal/workflow task they target, not the projection.
- **BC:** Additive only — new entity/table/routes/feature/event; nothing removed or changed.

## Changelog

- **2026-06-25:** Initial draft. Filed as the gap delta behind the "Processes" / "Process detail" mockups: adds a `subject` reference convention (workflow → `INVOKE_AGENT` `ctx.subject` → agent layer) and a new `AgentProcess` read-model projection (one row per `processId`) with a status-derivation precedence table, faceted list + header APIs, an event-maintained subscriber, and a `rebuild-processes` backfill. Explicitly additive; positioned as the claim-centric backing the UI-only operations cockpit (`2026-06-19-agent-operations-ui.md`) cannot provide on its own.
