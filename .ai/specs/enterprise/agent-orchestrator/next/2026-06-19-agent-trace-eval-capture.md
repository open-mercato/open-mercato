> 🗂️ **Status update 2026-06-24 · ✅ IMPLEMENTED (PR #3532)** on `feat/agent-orchestrator-mvp`. The trace · evaluation · correction capture described here is shipped: `AgentSpan`/`AgentToolCall`/`AgentRunSession` entities, `lib/trace/*`, `POST /api/agent_orchestrator/trace/ingest`, `GET /runs/:id`, the `backend/traces/*` inspector, and the `run.ingested`/`run.evaluated` events. Deferred infra (S3 artifact offload, metric rollups, span partitioning) + hardening items are tracked in [`2026-06-24-trace-eval-pr4b-and-followups.md`](./2026-06-24-trace-eval-pr4b-and-followups.md). Code-grounded status matrix: [`IMPLEMENTATION-TRACE.md`](./IMPLEMENTATION-TRACE.md).

# Agent Trace, Evaluation & Correction Capture

> **Status:** Implemented (PR #3532, 2026-06-24) · **Owner:** Patryk Lewczuk (Comerito) · **Created:** 2026-06-19
> **Module:** `agent_orchestrator` (core; `packages/enterprise/src/modules/agent_orchestrator/`) · **subdomain:** `trace` (`lib/trace/`)
> **Depends:** `workflows`, `audit_logs`, `storage-s3`, `packages/queue`, `ai_assistant`, dispatch spec (`2026-06-19-agent-dispatch.md`), orchestration spec (`2026-06-19-agent-orchestration-step-and-proposal.md`)
> **Conventions:** governed by `2026-06-19-agent-orchestrator-conventions.md` (normative; wins on any entity/structure conflict).

## TLDR

The runtime trace + evaluation + correction plane — the "learning loop". It captures every production agent run (`AgentRun` → `AgentSpan` → `AgentToolCall`), evaluates each run against assertions, records mandatory human **corrections**, and promotes corrections + golden runs into a regression **eval set**.

This module **builds its own minimal eval harness** (deterministic assertions now, an optional `ai_assistant`-backed `llm_judge` tier) and **owns the eval-case export format** (the *agent_orchestrator eval-case export*) that the lifecycle spec consumes to gate deployments. There is **no pre-existing offline eval harness to reuse** in Open Mercato — the scoring/regression stage is net-new and owned here.

## Overview

`workflows` event sourcing audits the *process*; `audit_logs` records explicit mutations. Neither captures agent-level detail (spans, tokens, cost, confidence, tool I/O), scores runs, or turns operator overrides into regression tests. This spec adds the plane that does, and the flywheel that converts everyday human corrections into durable quality gates.

The capture surface and the eval/correction surface are deliberately separate from audit: trace capture is high-volume telemetry; `audit_logs` is the legal mutation record. They complement each other and must not be conflated.

## Problem Statement

- The trace inspector (cockpit) has nothing to read — no per-run spans, tool I/O, or eval verdicts.
- Agent degradation is invisible: no per-agent override rate, eval pass rate, latency, or cost over time.
- Operator overrides evaporate instead of becoming regression cases, so the same agent mistake recurs.
- EU AI Act Art. 12 (record-keeping) and Art. 14 (human oversight effectiveness) are unmet without durable, queryable run/correction/eval records.
- There is **no offline eval harness** in the codebase to lean on; without one, "regression gating" in the lifecycle spec has no source of truth.

## Proposed Solution

1. **Capture.** Runtime adapters (dispatch spec) normalize each runtime's trace and POST it to an HMAC-verified ingestion webhook, idempotent by `(runtime, externalRunId)`. The `TraceIngestionService` upserts `AgentRun`, appends `AgentSpan`/`AgentToolCall`, and offloads large payloads to `storage-s3`.
2. **Evaluate.** A deterministic `EvalRuntimeService` runs `AgentEvalAssertion`s (schema/threshold/PII) inline and writes `AgentEvalResult`s. An optional async `llm_judge` tier (queue worker, `ai_assistant` `AiModelFactory`) scores a sample and emits `warn`-severity results that never block production.
3. **Correct.** A human override on a proposal calls `CorrectionService`, which writes an append-only `AgentCorrection` with a **mandatory reason**, then auto-drafts an `AgentEvalCase`.
4. **Gate.** An engineer approves the drafted case; `EvalCaseExporter` emits the *agent_orchestrator eval-case export*, which the lifecycle spec runs as a regression gate before promoting a new agent version.
5. **Watch the watchers.** Anti-rubber-stamp signals (approve-unchanged rate, sampled re-review of auto-approved runs) are computed from this module's own tables and surfaced to the cockpit.

## Architecture

```
runtime adapter (dispatch) ──HMAC──▶ POST /trace/ingest
                                        │ idempotent (runtime, externalRunId)
                                        ▼
                              TraceIngestionService
                       ┌──────────────┼───────────────┐
                       ▼              ▼                ▼
                   AgentRun       AgentSpan        storage-s3
                  (upsert)     AgentToolCall    (prompts/req/resp/
                                (append)         outputs by key)
                                        │
                                        ▼
                          EvalRuntimeService (deterministic, inline)
                                        │ writes AgentEvalResult (gate|warn)
                                        ▼
                       packages/queue ──▶ llm_judge worker (ai_assistant)
                                        │ sampled, warn-only
                                        ▼
operator override ──▶ CorrectionService ──▶ AgentCorrection (append-only, reason required)
                                        │ auto-draft
                                        ▼
                                  AgentEvalCase (draft)
                                        │ engineer approve
                                        ▼
                             EvalCaseExporter ──▶ agent_orchestrator eval-case export
                                        │ (consumed by lifecycle spec CI gate)
                                        ▼
                       metrics rollups (this module's tables) ──▶ cockpit
```

- **No cross-module ORM relations.** Other modules are referenced by FK id only (`processId`, `stepId`, `proposalId`, `agentRunId`).
- **Metrics are computed from this module's tables** (override rate, eval pass rate, latency, cost). `telemetry-and-otel` does not exist; OTel GenAI semantic conventions are a *normalization target* for span attributes, not a dependency.

## Data Models

All entities live in `data/entities.ts`; Zod shapes in `data/validators.ts`. Table prefix `agent_`. Every row carries both `tenant_id` and `organization_id`, indexed `['tenantId','organizationId']`; all queries filter by `organizationId`. Editable entities expose `updated_at`; append-only logs omit `updated_at`/`deleted_at`.

### `AgentRun` (`agent_runs`) — editable (optimistic lock)

```typescript
import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

export type AgentRunStatus = 'running' | 'ok' | 'error' | 'cancelled'

@Entity({ tableName: 'agent_runs' })
@Index({ name: 'agent_runs_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_runs_runtime_external_uq', properties: ['runtime', 'externalRunId'] })
@Index({ name: 'agent_runs_agent_def_idx', properties: ['agentDefinitionId', 'createdAt'] })
export class AgentRun {
  [OptionalProps]?:
    | 'status' | 'currency' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'process_id', type: 'uuid', nullable: true })
  processId?: string | null // FK id → workflows instance

  @Property({ name: 'step_id', type: 'varchar', length: 100, nullable: true })
  stepId?: string | null

  @Property({ name: 'proposal_id', type: 'uuid', nullable: true })
  proposalId?: string | null // FK id → agent_proposals (orchestration spec)

  @Property({ name: 'agent_definition_id', type: 'varchar', length: 100 })
  agentDefinitionId!: string

  @Property({ name: 'agent_version', type: 'varchar', length: 50 })
  agentVersion!: string

  @Property({ name: 'model', type: 'varchar', length: 100, nullable: true })
  model?: string | null

  @Property({ name: 'runtime', type: 'varchar', length: 50 })
  runtime!: string // part of idempotency key

  @Property({ name: 'external_run_id', type: 'varchar', length: 200 })
  externalRunId!: string // part of idempotency key

  @Property({ name: 'status', type: 'varchar', length: 20, default: 'running' })
  status: AgentRunStatus = 'running'

  @Property({ name: 'confidence', type: 'float', nullable: true })
  confidence?: number | null

  @Property({ name: 'input_tokens', type: 'integer', nullable: true })
  inputTokens?: number | null

  @Property({ name: 'output_tokens', type: 'integer', nullable: true })
  outputTokens?: number | null

  @Property({ name: 'cost_minor', type: 'bigint', nullable: true })
  costMinor?: number | null

  @Property({ name: 'currency', type: 'varchar', length: 3, default: 'USD' })
  currency: string = 'USD'

  @Property({ name: 'latency_ms', type: 'integer', nullable: true })
  latencyMs?: number | null

  @Property({ name: 'eval_score', type: 'float', nullable: true })
  evalScore?: number | null

  @Property({ name: 'eval_passed', type: 'boolean', nullable: true })
  evalPassed?: boolean | null

  @Property({ name: 'context_routing', type: 'jsonb', nullable: true })
  contextRouting?: any | null // TDCR routed vs pruned (context spec)

  @Property({ name: 'output_artifact_key', type: 'varchar', length: 500, nullable: true })
  outputArtifactKey?: string | null // storage-s3 key

  @Property({ name: 'human_confirmed_at', type: Date, nullable: true })
  humanConfirmedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
```

### `AgentCorrection` (`agent_corrections`) — append-only

```typescript
export type CorrectionAction = 'edit' | 'reject' | 'override' | 'answer'

@Entity({ tableName: 'agent_corrections' })
@Index({ name: 'agent_corrections_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_corrections_run_idx', properties: ['agentRunId'] })
@Index({ name: 'agent_corrections_proposal_idx', properties: ['proposalId'] })
export class AgentCorrection {
  [OptionalProps]?: 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'process_id', type: 'uuid', nullable: true })
  processId?: string | null // FK id → workflows instance

  @Property({ name: 'step_id', type: 'varchar', length: 100, nullable: true })
  stepId?: string | null

  @Property({ name: 'agent_run_id', type: 'uuid', nullable: true })
  agentRunId?: string | null // FK id → agent_runs

  @Property({ name: 'proposal_id', type: 'uuid' })
  proposalId!: string // FK id → agent_proposals

  @Property({ name: 'corrected_by_user_id', type: 'uuid' })
  correctedByUserId!: string // FK id → auth user

  @Property({ name: 'action', type: 'varchar', length: 20 })
  action!: CorrectionAction

  @Property({ name: 'proposed_value', type: 'jsonb' })
  proposedValue!: any // the agent's original proposal payload

  @Property({ name: 'corrected_value', type: 'jsonb', nullable: true })
  correctedValue?: any | null // human-supplied corrected payload (null on reject)

  @Property({ name: 'reason', type: 'text' })
  reason!: string // MANDATORY, non-empty — enforced by Zod + command

  @Property({ name: 'eval_case_id', type: 'uuid', nullable: true })
  evalCaseId?: string | null // FK id → agent_eval_cases (auto-drafted)

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}
```

### Abbreviated entities (all fields listed; full bodies follow the same standard as above)

> Each is a real MikroORM v7 `/legacy` entity with explicit `@Property`, the dual `tenant_id`/`organization_id` columns + index, UUID PK, and the audit-column rules. Append-only logs omit `updated_at`/`deleted_at`.

- **`AgentSpan` (`agent_spans`, append-only):** `id`, `tenantId`, `organizationId`, `agentRunId` (FK id), `parentSpanId?`, `sequence` (int), `name`, `kind` (`'llm' | 'tool' | 'system'`), `startedAt`, `endedAt?`, `durationMs?`, `status` (`'ok' | 'error'`), `attributes?` (jsonb; OTel GenAI naming target), `createdAt`. **Partitioned by `created_at`** (see Constraints).
- **`AgentToolCall` (`agent_tool_calls`, append-only):** `id`, `tenantId`, `organizationId`, `spanId` (FK id), `agentRunId` (FK id), `toolName`, `requestSummary?` (jsonb, redacted), `responseSummary?` (jsonb, redacted), `requestArtifactKey?`, `responseArtifactKey?` (storage-s3 keys), `status` (`'ok' | 'error'`), `latencyMs?`, `errorMessage?`, `createdAt`.
- **`AgentEvalAssertion` (`agent_eval_assertions`, editable):** `id`, `tenantId`, `organizationId`, `key`, `title`, `description?`, `appliesTo` (agentDefinitionId or `'*'`), `type` (`'deterministic' | 'llm_judge'`), `severity` (`'gate' | 'warn'`), `config` (jsonb), `version` (int), `enabled` (bool), `createdAt`, `updatedAt`, `deletedAt?`.
- **`AgentEvalResult` (`agent_eval_results`, append-only):** `id`, `tenantId`, `organizationId`, `agentRunId` (FK id), `assertionId` (FK id), `assertionKey`, `passed` (bool), `score?` (float), `severity` (`'gate' | 'warn'`), `evidence?` (jsonb), `evaluatedAt`, `createdAt`.
- **`AgentEvalCase` (`agent_eval_cases`, editable):** `id`, `tenantId`, `organizationId`, `sourceType` (`'correction' | 'golden_run'`), `sourceId` (FK id → correction or run), `agentDefinitionId`, `processType?`, `input` (jsonb), `expected` (jsonb), `assertions?` (jsonb — assertion keys to apply), `status` (`'draft' | 'approved' | 'archived'`), `approvedByUserId?`, `createdAt`, `updatedAt`, `deletedAt?`.

`AgentProposal` itself is **owned by the orchestration spec**; this module references it by FK id only.

## Assertions & The Correction Flywheel

**Two-tier assertions.**
- **Deterministic gate (inline).** Schema validation, numeric thresholds, PII detection. Fast, runs in `EvalRuntimeService` at ingest time, may carry `severity: 'gate'`. Failing a `gate` marks `evalPassed = false` and is the signal the lifecycle gate reads.
- **`llm_judge` warn (sampled, async).** Rubric scoring via the `ai_assistant` `AiModelFactory`, executed in a `packages/queue` worker on a sampled subset. Always `severity: 'warn'` — it **never blocks production**, only flags runs for review and feeds quality trends.

**The flywheel.**

```
human override → AgentCorrection (mandatory reason)
              → auto-draft AgentEvalCase(input = run input, expected = correctedValue, status='draft')
              → engineer approval (status='approved')
              → EvalCaseExporter → agent_orchestrator eval-case export
              → lifecycle spec regression gate on next agent version
```

Ingestion + corrections + export (Phases 1 → 2 → 5 → 6) is the minimum that makes the loop spin.

**Anti-rubber-stamp signals** (computed from this module's tables, surfaced to the cockpit; AI Act Art. 14):
- **approve-unchanged rate** — fraction of proposals auto/human-approved with no edit.
- **sampled re-review** — randomly re-queue a slice of auto-approved runs for a second human look.
- **persistent warns** — surface `warn`-severity eval results even on human-approved runs.

## API Contracts

Routes are mounted under the underscore module id: `/api/agent_orchestrator/...`.

**Custom write (Command + mutation guard + HMAC):**
- `POST /api/agent_orchestrator/trace/ingest` — runtime/dispatch webhook. HMAC-verified, idempotent by `(runtime, externalRunId)`. Upserts the run, appends spans/tool calls, offloads large payloads to `storage-s3`, triggers deterministic eval.

**Reads (`makeCrudRoute` + `indexer` + `export const openApi`):**
- `GET /api/agent_orchestrator/runs` — filter by `overridden | low-confidence | eval-fail | agentDefinitionId | window`.
- `GET /api/agent_orchestrator/runs/:id` — full run with spans, tool calls, context routing, eval results, artifact links.
- `GET /api/agent_orchestrator/agents/:id/metrics` — override rate, eval pass rate, latency, cost over a window.

**Custom writes (Command + mutation guard; optimistic lock where the target is editable):**
- `POST /api/agent_orchestrator/corrections` — from the disposition flow; writes `AgentCorrection` (reason required) and auto-drafts an `AgentEvalCase`.
- `POST /api/agent_orchestrator/eval-cases/:id/approve` — engineer approval (`AgentEvalCase` is editable → enforce optimistic lock + surface 409 via `surfaceRecordConflict`).
- `GET /api/agent_orchestrator/eval-cases/export` — emits the agent_orchestrator eval-case export for the lifecycle CI gate.

**Events** (`createModuleEvents`, `module.entity.action`, past tense, declared `as const` in `events.ts`):
- `agent_orchestrator.run.ingested`
- `agent_orchestrator.run.evaluated`
- `agent_orchestrator.proposal.corrected`
- `agent_orchestrator.eval_case.created`
- `agent_orchestrator.eval_case.approved`

**ACL** (in `acl.ts` + `setup.ts` `defaultRoleFeatures`): `agent_orchestrator.trace.view`, `agent_orchestrator.trace.correct`, `agent_orchestrator.eval.manage`, `agent_orchestrator.eval.export`.

## Constraints

- **Volume.** At thousands of runs/week, spans reach ~9M rows/yr. **Partition `agent_spans` by `created_at`** and tier retention (hot N days → archive). `AgentToolCall` follows the same tiering.
- **High-value, low-volume.** `AgentEvalResult`, `AgentCorrection`, `AgentEvalCase` are append-only and retained **≥ 6 years** (AI Act Art. 12 record-keeping).
- **PII.** Sensitive prompts/req/resp/outputs are stored in `storage-s3` by key and **encrypted at rest via `TenantDataEncryptionService`**; row-level summaries are redacted. GDPR erasure is handled by **tombstoning the artifact** while preserving the audit/correction row (the legal record survives; the payload does not).
- **Idempotency & ordering.** Upsert on `(runtime, externalRunId)`. Out-of-order spans are tolerated: `sequence` + `parentSpanId` rebuild the tree regardless of arrival order.
- **Capture ≠ audit.** `audit_logs` writes are explicit/Command-path, not automatic; trace spans are *not* covered by audit and must be persisted by this module independently.

## Phases

1. Entities + migrations + Zod for `AgentRun`/`AgentSpan`/`AgentToolCall`.
2. `TraceIngestionService` + `POST /trace/ingest` (HMAC, idempotent) + `storage-s3` offloading.
3. Read API for the trace inspector + run list (cockpit).
4. `AgentEvalAssertion`/`AgentEvalResult` + deterministic `EvalRuntimeService` (inline gate tier).
5. `AgentCorrection` (append-only, reason required) + `CorrectionService` + disposition hook (orchestration spec).
6. `AgentEvalCase` auto-draft + approval + `EvalCaseExporter` (agent_orchestrator eval-case export).
7. `llm_judge` async tier on `packages/queue` via `ai_assistant` `AiModelFactory` + sampling.
8. Trust-metric rollups + anti-rubber-stamp signals + retention/partitioning.

**Critical path for the flywheel:** 1 → 2 → 5 → 6.

## Acceptance

- Every production run is queryable within ≤ 5s p95, with spans, tool I/O, context routing, and eval results.
- Every human override writes an `AgentCorrection` with a non-empty `reason` and auto-drafts an `AgentEvalCase`.
- Approved eval cases export in the agent_orchestrator eval-case format and are consumed by the lifecycle spec's regression gate.
- Per-agent override rate and eval pass rate are computable over any window from this module's tables.
- `AgentEvalResult`/`AgentCorrection`/`AgentEvalCase` are append-only and retained ≥ 6 years.
- Deterministic `gate` assertions can fail a run; `llm_judge` `warn` assertions never block production.

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual |
|------|----------|---------------|------------|----------|
| **Eval harness assumed to be reuse, but is net-new.** Earlier drafts cited `eval-runner`/Inspect AI/`x_om` as existing consumers; none exist. | High | Scope, schedule | This spec scopes the harness (deterministic + optional `llm_judge`) and the export format as net-new owned work; lifecycle spec consumes *this* export. | Build cost lands on this module; mitigated by phasing (deterministic first). |
| Span volume overwhelms primary DB. | High | DB, query latency | Partition `agent_spans` by `created_at`; tier retention; artifacts to storage-s3. | Archive query path slower; acceptable for cold data. |
| PII leakage in summaries/artifacts. | High | Compliance, GDPR | Encrypt artifacts (`TenantDataEncryptionService`); redact row summaries; tombstone erasure. | Residual exposure window before redaction; minimized at ingest. |
| Rubber-stamp approvals defeat oversight. | Medium | AI Act Art. 14 | approve-unchanged rate, sampled re-review, persistent warns surfaced. | Detective not preventive; relies on cockpit follow-up. |
| `llm_judge` cost/latency. | Medium | Cost, queue | Sampled, async, warn-only; never on critical path. | Sampling may miss issues; tunable rate. |
| Duplicate/out-of-order ingestion. | Medium | Data integrity | Idempotent upsert on `(runtime, externalRunId)`; `sequence`+`parentSpanId` tree rebuild. | Late spans appear after first render; re-query resolves. |
| OTel GenAI conventions treated as a dependency. | Low | Naming | Used only as a normalization target for span `attributes`; no runtime dependency. | None. |

## Integration Coverage

> Per repo rule, this feature ships executable Playwright integration tests with the change.
> Location: `packages/enterprise/src/modules/agent_orchestrator/__integration__/TC-AGENT-TRACE-<NNN>.spec.ts`
> Helpers: `@open-mercato/core/helpers/integration/{auth,api,authFixtures,generalFixtures}` (+ this module's
> `__integration__/helpers/agentFixtures.ts`). All fixtures created in setup (prefer API), cleaned in `finally`/teardown.
> No seeded/demo data; deterministic across retries; rely on global config (`timeout 10s`, `expect.timeout 10s`, `retries 1`).
>
> Eval harness + scoring detail (deterministic assertions, `llm_judge` tier, eval-case export, per-agent metrics) now lives in
> the consolidating spec `2026-06-20-agent-eval-harness-and-metrics.md`; cross-ref it for the eval-runtime/export behavior the
> tests below exercise.

| API path / UI flow | Method | Must-have tests |
|--------------------|--------|-----------------|
| `/api/agent_orchestrator/trace/ingest` | `POST` | **HMAC-verified** (bad/missing signature → 401); **idempotent by `(runtime, externalRunId)`** — same payload POSTed twice upserts exactly one `AgentRun` and appends spans/tool-calls **once** (duplicate ingest is a no-op); out-of-order spans rebuild via `sequence`+`parentSpanId`; large payloads offloaded to `storage-s3` by key; tenant-isolation (org B signature/credentials cannot ingest into org A) |
| `/api/agent_orchestrator/runs` | `GET` | **production run queryable within p95 ≤ 5s** of ingest; filter by `overridden \| low-confidence \| eval-fail \| agentDefinitionId \| window`; list returns `updatedAt`; org-scoped; RBAC/feature-gate (403 without `agent_orchestrator.trace.view`); tenant-isolation (org B cannot list org A runs) |
| `/api/agent_orchestrator/runs/:id` | `GET` | full run returns **spans, tool-calls, context-routing, and eval results** + artifact links; RBAC (`agent_orchestrator.trace.view`); tenant-isolation (org B 404 on org A run) |
| `/api/agent_orchestrator/agents/:id/metrics` | `GET` | **per-agent override-rate + eval-pass-rate computable over a window** (plus latency/cost) from this module's tables; RBAC; org-scoped |
| `/api/agent_orchestrator/corrections` | `POST` | **human override writes an append-only `AgentCorrection` with a mandatory non-empty `reason`** (empty/missing reason → 422) **and auto-drafts an `AgentEvalCase` (status `draft`)**; RBAC (`agent_orchestrator.trace.correct`); tenant-isolation |
| `/api/agent_orchestrator/eval-cases/:id/approve` | `POST` | engineer approval flips status `draft → approved`; **optimistic-lock 409** on stale `updatedAt` surfaced via `surfaceRecordConflict`; RBAC (`agent_orchestrator.eval.manage`); tenant-isolation |
| `/api/agent_orchestrator/eval-cases/export` | `GET` | **approved eval cases export in the agent_orchestrator eval-case format** (drafts/archived excluded); versioned envelope; RBAC (`agent_orchestrator.eval.export`); org-scoped; feeds the lifecycle/eval-harness gate |

**Append-only enforcement (mandatory):** assert that `AgentCorrection`, `AgentEvalResult`, and `AgentEvalCase` (post-approval) rows **cannot be mutated** through any route — there is no update/delete surface, raw mutation attempts are rejected, and the rows expose no `updated_at`/`deleted_at` for append-only logs. The legal record survives even when a PII artifact is tombstoned.

**Domain E2E `ingest → query → correct → export`:** HMAC-ingest a production run → re-POST the identical payload and assert a single run with spans appended once (idempotency) → query the run within the ≤5s budget and verify spans/tool-calls/context-routing/eval results → record a human override (mandatory reason) and assert the `AgentCorrection` + auto-drafted `AgentEvalCase` → approve the case → export and assert the approved case appears in the eval-case format. The headline E2E.

**Tenant-isolation harness (mandatory for every entity surface):** create two orgs/tenants
(`createUserFixture` per org), seed a run/correction/eval-case in org A, assert org B's token gets 404/403 (never the row)
on `trace/ingest`, every `GET` read, `corrections`, `eval-cases/:id/approve`, and `eval-cases/export`. Cleanup both in teardown.

## Migration & Backward Compatibility

- All entities are **net-new** (`agent_*` tables) — additive, no changes to existing module schemas.
- The agent_orchestrator eval-case export is a **new contract surface** owned by this module; once published it follows `BACKWARD_COMPATIBILITY.md` (STABLE/ADDITIVE-ONLY). Version the export envelope from day one.
- New events, ACL features, and API routes are additive. Migrations ship with `.snapshot-open-mercato.json`.
- No reuse of, or dependency on, any `eval-runner`/Inspect/`x_om` artifact — those do not exist in the codebase and are removed from this spec's assumptions.

## Final Compliance Report

- **Tenancy:** every entity carries `tenant_id` + `organization_id`; all reads filter by `organizationId`. ✓
- **ORM:** MikroORM v7 `/legacy`, explicit `@Property`, UUID PK `gen_random_uuid()`, no cross-module relations (FK ids only). ✓
- **Optimistic locking:** `AgentRun`/`AgentEvalAssertion`/`AgentEvalCase` expose `updated_at`; approve route enforces command-level lock + `surfaceRecordConflict`. Append-only logs exempt. ✓
- **Writes:** ingestion/corrections/approve via Command + mutation guard; reads via `makeCrudRoute` + indexer + `openApi`. ✓
- **Events/ACL:** `module.entity.action` past tense in `events.ts`; `agent_orchestrator.*` features in `acl.ts` + `setup.ts`. ✓
- **i18n/DS:** cockpit strings via `i18n/` + `useT`/`resolveTranslations`; status via DS tokens. ✓
- **AI Act:** Art. 12 (≥6yr append-only records), Art. 14 (anti-rubber-stamp oversight signals). ✓

## Changelog

- **2026-06-20:** Added the `## Integration Coverage` section (per GAP-17): Playwright tests for HMAC-verified + idempotent `(runtime, externalRunId)` ingest (duplicate ingest is a no-op), ≤5s p95 run queryability with spans/tool-calls/context-routing/eval results, mandatory-reason `AgentCorrection` + auto-drafted `AgentEvalCase`, approved eval-case export, per-agent override-rate + eval-pass-rate over a window, append-only enforcement, RBAC/feature-gate on trace reads, and per-surface tenant-isolation, with a headline `ingest → query → correct → export` E2E; anchored fixtures/cleanup/placement to `.ai/qa/AGENTS.md` + `om-integration-tests`. Cross-referenced the consolidating eval-harness/metrics spec `2026-06-20-agent-eval-harness-and-metrics.md` for the eval-runtime/export detail.
- **2026-06-19:** Rewrite to real OM conventions and verified architecture. Removed all `eval-runner`/Inspect AI/`x_om`/SWE-bench reuse claims (absent from codebase) and reframed the eval harness + eval-case export as net-new work owned by this module; removed `telemetry-and-otel` as a dependency (does not exist) and recast OTel GenAI as a naming target. Converted entity sketches to MikroORM v7 `/legacy` with dual `tenant_id`/`organization_id`, explicit `@Property`, optimistic-lock/append-only split. Renamed entities to `Agent*` with `agent_` table prefix, events to `agent_orchestrator.*` past tense, routes to `/api/agent_orchestrator/...`. Clarified deterministic-gate vs sampled `llm_judge`-warn tiers and the correction flywheel. Added scoping risk row for the net-new harness.
