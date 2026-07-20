import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

export type AgentRunStatus = 'running' | 'ok' | 'error' | 'cancelled'

/** Span kinds; OTel GenAI semantic conventions are the naming target for span attributes. */
export type AgentSpanKind = 'llm' | 'tool' | 'system'
export type AgentSpanStatus = 'ok' | 'error'
export type AgentToolCallStatus = 'ok' | 'error'

@Entity({ tableName: 'agent_runs' })
@Index({ name: 'agent_runs_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_runs_agent_idx', properties: ['organizationId', 'agentId'] })
@Unique({ name: 'agent_runs_runtime_external_uq', properties: ['runtime', 'externalRunId'] })
@Index({ name: 'agent_runs_agent_def_idx', properties: ['agentId', 'createdAt'] })
@Index({ name: 'agent_runs_org_status_created_idx', properties: ['organizationId', 'status', 'createdAt'] })
@Index({
  name: 'agent_runs_eval_failed_idx',
  expression:
    `create index "agent_runs_eval_failed_idx" on "agent_runs" ("organization_id", "created_at") where "eval_passed" = false`,
})
export class AgentRun {
  [OptionalProps]?:
    | 'status'
    | 'output'
    | 'resultKind'
    | 'errorMessage'
    | 'parentRunId'
    | 'processId'
    | 'stepId'
    | 'proposalId'
    | 'agentVersion'
    | 'model'
    | 'runtime'
    | 'externalRunId'
    | 'confidence'
    | 'inputTokens'
    | 'outputTokens'
    | 'costMinor'
    | 'currency'
    | 'latencyMs'
    | 'evalScore'
    | 'evalPassed'
    | 'contextRouting'
    | 'outputArtifactKey'
    | 'humanConfirmedAt'
    | 'flaggedAt'
    | 'flaggedBy'
    | 'rerunOfRunId'
    | 'completedAt'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'agent_id', type: 'varchar', length: 100 })
  agentId!: string

  /**
   * Parent run that delegated to this one as a sub-agent (Phase 4 nested trace).
   * Nullable + additive: top-level runs leave it null. Populated for the
   * in-process `delegate_agent` path; OpenCode-NATIVE `task` delegation runs
   * sub-agents inside OpenCode (not via our runner), so per-sub-agent rows are a
   * documented follow-up for that path.
   */
  @Property({ name: 'parent_run_id', type: 'uuid', nullable: true })
  parentRunId?: string | null

  // ── Trace correlation (additive; trace-eval overlay) ───────────────────────
  /** FK id → workflows process instance (no cross-module ORM relation). */
  @Property({ name: 'process_id', type: 'uuid', nullable: true })
  processId?: string | null

  @Property({ name: 'step_id', type: 'varchar', length: 100, nullable: true })
  stepId?: string | null

  /** FK id → agent_proposals (orchestration). */
  @Property({ name: 'proposal_id', type: 'uuid', nullable: true })
  proposalId?: string | null

  @Property({ name: 'agent_version', type: 'varchar', length: 50, nullable: true })
  agentVersion?: string | null

  @Property({ name: 'model', type: 'varchar', length: 100, nullable: true })
  model?: string | null

  /** Runtime that produced the run; part of the ingestion idempotency key. */
  @Property({ name: 'runtime', type: 'varchar', length: 50, nullable: true })
  runtime?: string | null

  /** Runtime-native run id; part of the ingestion idempotency key. */
  @Property({ name: 'external_run_id', type: 'varchar', length: 200, nullable: true })
  externalRunId?: string | null

  @Property({ name: 'confidence', type: 'float', nullable: true })
  confidence?: number | null

  @Property({ name: 'input_tokens', type: 'integer', nullable: true })
  inputTokens?: number | null

  @Property({ name: 'output_tokens', type: 'integer', nullable: true })
  outputTokens?: number | null

  @Property({ name: 'cost_minor', type: 'bigint', nullable: true })
  costMinor?: number | null

  @Property({ name: 'currency', type: 'varchar', length: 3, nullable: true })
  currency?: string | null

  @Property({ name: 'latency_ms', type: 'integer', nullable: true })
  latencyMs?: number | null

  @Property({ name: 'eval_score', type: 'float', nullable: true })
  evalScore?: number | null

  @Property({ name: 'eval_passed', type: 'boolean', nullable: true })
  evalPassed?: boolean | null

  /** TDCR routed-vs-pruned context summary (context overlay). */
  @Property({ name: 'context_routing', type: 'jsonb', nullable: true })
  contextRouting?: unknown | null

  /** storage-s3 key for the offloaded, encrypted full output payload. */
  @Property({ name: 'output_artifact_key', type: 'varchar', length: 500, nullable: true })
  outputArtifactKey?: string | null

  @Property({ name: 'human_confirmed_at', type: Date, nullable: true })
  humanConfirmedAt?: Date | null

  /** Operator triage flag (trace inspector); null = unflagged. */
  @Property({ name: 'flagged_at', type: Date, nullable: true })
  flaggedAt?: Date | null

  /** FK id → auth.users; the operator who flagged the run. */
  @Property({ name: 'flagged_by', type: 'uuid', nullable: true })
  flaggedBy?: string | null

  /** FK id → agent_runs; the source run this run is a re-run of (trace inspector "Re-run"). Distinct from `parentRunId` (sub-agent delegation). */
  @Property({ name: 'rerun_of_run_id', type: 'uuid', nullable: true })
  rerunOfRunId?: string | null

  @Property({ name: 'status', type: 'varchar', length: 20, default: 'running' })
  status: AgentRunStatus = 'running'

  /**
   * Forensic completion timestamp: stamped once at the terminal transition
   * (`runs.complete`/`runs.fail`; trace ingest sets it null-only from span end
   * times) and never mutated afterwards — unlike `updatedAt`, which later
   * writes (e.g. flagging) legitimately bump.
   */
  @Property({ name: 'completed_at', type: Date, nullable: true })
  completedAt?: Date | null

  @Property({ name: 'input', type: 'jsonb' })
  input!: unknown

  @Property({ name: 'output', type: 'jsonb', nullable: true })
  output?: unknown | null

  @Property({ name: 'result_kind', type: 'varchar', length: 20, nullable: true })
  resultKind?: 'informative' | 'actionable' | null

  @Property({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * One step in an agent run's execution trace (an LLM call, a tool invocation, or
 * a system step). Append-only telemetry: omits `updated_at`/`deleted_at`. High
 * volume — partitioned by `created_at` and tiered to archive in a later phase.
 * Out-of-order ingestion is tolerated: `sequence` + `parentSpanId` rebuild the
 * tree regardless of arrival order. Other modules referenced by FK id only.
 */
@Entity({ tableName: 'agent_spans' })
@Index({ name: 'agent_spans_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_spans_run_idx', properties: ['agentRunId', 'sequence'] })
@Unique({ name: 'agent_spans_run_external_uq', properties: ['agentRunId', 'externalSpanId'] })
export class AgentSpan {
  [OptionalProps]?: 'parentSpanId' | 'endedAt' | 'durationMs' | 'status' | 'attributes' | 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** FK id → agent_runs. */
  @Property({ name: 'agent_run_id', type: 'uuid' })
  agentRunId!: string

  /**
   * Adapter-native span id. The dedupe + parent-link key: re-ingesting the same
   * trace is a no-op (unique per run), and children resolve their `parentSpanId`
   * by matching the parent's `externalSpanId` regardless of arrival order.
   */
  @Property({ name: 'external_span_id', type: 'varchar', length: 200 })
  externalSpanId!: string

  /** FK id → agent_spans (parent step); null for root spans. */
  @Property({ name: 'parent_span_id', type: 'uuid', nullable: true })
  parentSpanId?: string | null

  @Property({ name: 'sequence', type: 'integer' })
  sequence!: number

  @Property({ name: 'name', type: 'varchar', length: 200 })
  name!: string

  @Property({ name: 'kind', type: 'varchar', length: 20 })
  kind!: AgentSpanKind

  @Property({ name: 'started_at', type: Date })
  startedAt!: Date

  @Property({ name: 'ended_at', type: Date, nullable: true })
  endedAt?: Date | null

  @Property({ name: 'duration_ms', type: 'integer', nullable: true })
  durationMs?: number | null

  @Property({ name: 'status', type: 'varchar', length: 20, default: 'ok' })
  status: AgentSpanStatus = 'ok'

  /** OTel GenAI naming target. */
  @Property({ name: 'attributes', type: 'jsonb', nullable: true })
  attributes?: unknown | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

/**
 * A single tool invocation within a span. Append-only telemetry: omits
 * `updated_at`/`deleted_at`. Request/response summaries are redacted and stored
 * inline; full payloads are offloaded to storage-s3 by key, encrypted at rest.
 * Other modules referenced by FK id only.
 */
@Entity({ tableName: 'agent_tool_calls' })
@Index({ name: 'agent_tool_calls_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_tool_calls_span_idx', properties: ['spanId'] })
@Index({ name: 'agent_tool_calls_run_idx', properties: ['agentRunId'] })
export class AgentToolCall {
  [OptionalProps]?:
    | 'requestSummary' | 'responseSummary' | 'requestArtifactKey' | 'responseArtifactKey'
    | 'status' | 'latencyMs' | 'errorMessage' | 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** FK id → agent_spans. */
  @Property({ name: 'span_id', type: 'uuid' })
  spanId!: string

  /** FK id → agent_runs (denormalized for direct run-scoped queries). */
  @Property({ name: 'agent_run_id', type: 'uuid' })
  agentRunId!: string

  @Property({ name: 'tool_name', type: 'varchar', length: 200 })
  toolName!: string

  @Property({ name: 'request_summary', type: 'jsonb', nullable: true })
  requestSummary?: unknown | null

  @Property({ name: 'response_summary', type: 'jsonb', nullable: true })
  responseSummary?: unknown | null

  @Property({ name: 'request_artifact_key', type: 'varchar', length: 500, nullable: true })
  requestArtifactKey?: string | null

  @Property({ name: 'response_artifact_key', type: 'varchar', length: 500, nullable: true })
  responseArtifactKey?: string | null

  @Property({ name: 'status', type: 'varchar', length: 20, default: 'ok' })
  status: AgentToolCallStatus = 'ok'

  @Property({ name: 'latency_ms', type: 'integer', nullable: true })
  latencyMs?: number | null

  @Property({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

export type CorrectionAction = 'edit' | 'reject' | 'override' | 'answer'

/**
 * A human correction of an agent proposal — the flywheel's entry point. Append-only
 * (omits `updated_at`/`deleted_at`): the legal/oversight record must never mutate.
 * `reason` is mandatory and enforced by Zod + the command. Other modules referenced
 * by FK id only.
 */
@Entity({ tableName: 'agent_corrections' })
@Index({ name: 'agent_corrections_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_corrections_run_idx', properties: ['agentRunId'] })
@Index({ name: 'agent_corrections_proposal_idx', properties: ['proposalId'] })
export class AgentCorrection {
  [OptionalProps]?: 'processId' | 'stepId' | 'agentRunId' | 'correctedValue' | 'evalCaseId' | 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'process_id', type: 'uuid', nullable: true })
  processId?: string | null

  @Property({ name: 'step_id', type: 'varchar', length: 100, nullable: true })
  stepId?: string | null

  /** FK id → agent_runs. */
  @Property({ name: 'agent_run_id', type: 'uuid', nullable: true })
  agentRunId?: string | null

  /** FK id → agent_proposals. */
  @Property({ name: 'proposal_id', type: 'uuid' })
  proposalId!: string

  /** FK id → auth user who recorded the correction. */
  @Property({ name: 'corrected_by_user_id', type: 'uuid' })
  correctedByUserId!: string

  @Property({ name: 'action', type: 'varchar', length: 20 })
  action!: CorrectionAction

  /** The agent's original proposal payload. */
  @Property({ name: 'proposed_value', type: 'jsonb' })
  proposedValue!: unknown

  /** Human-supplied corrected payload; null on a plain reject. */
  @Property({ name: 'corrected_value', type: 'jsonb', nullable: true })
  correctedValue?: unknown | null

  /** Mandatory, non-empty — enforced by Zod + command. */
  @Property({ name: 'reason', type: 'text' })
  reason!: string

  /** FK id → agent_eval_cases (the auto-drafted case). */
  @Property({ name: 'eval_case_id', type: 'uuid', nullable: true })
  evalCaseId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

export type AgentEvalCaseSourceType = 'correction' | 'golden_run'
export type AgentEvalCaseStatus = 'draft' | 'approved' | 'archived'

/**
 * A regression eval case promoted from a correction or a golden run. Editable
 * (carries `updated_at` → optimistic lock); an engineer approves a draft before
 * it is exported to the lifecycle gate. Other modules referenced by FK id only.
 */
@Entity({ tableName: 'agent_eval_cases' })
@Index({ name: 'agent_eval_cases_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_eval_cases_agent_status_idx', properties: ['organizationId', 'agentDefinitionId', 'status'] })
export class AgentEvalCase {
  [OptionalProps]?:
    | 'processType' | 'expected' | 'assertions' | 'status' | 'approvedByUserId'
    | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'source_type', type: 'varchar', length: 20 })
  sourceType!: AgentEvalCaseSourceType

  /** FK id → agent_corrections or agent_runs (per sourceType). */
  @Property({ name: 'source_id', type: 'uuid' })
  sourceId!: string

  @Property({ name: 'agent_definition_id', type: 'varchar', length: 100 })
  agentDefinitionId!: string

  @Property({ name: 'process_type', type: 'varchar', length: 100, nullable: true })
  processType?: string | null

  @Property({ name: 'input', type: 'jsonb' })
  input!: unknown

  /** Expected output (the corrected value); null when sourced from a plain reject. */
  @Property({ name: 'expected', type: 'jsonb', nullable: true })
  expected?: unknown | null

  /** Assertion keys to apply when this case runs. */
  @Property({ name: 'assertions', type: 'jsonb', nullable: true })
  assertions?: unknown | null

  @Property({ name: 'status', type: 'varchar', length: 20, default: 'draft' })
  status: AgentEvalCaseStatus = 'draft'

  @Property({ name: 'approved_by_user_id', type: 'uuid', nullable: true })
  approvedByUserId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

export type AgentEvalAssertionType = 'deterministic' | 'llm_judge'
export type AgentEvalSeverity = 'gate' | 'warn'

/**
 * A configured assertion applied to agent runs during evaluation. Editable
 * (carries `updated_at` → optimistic lock). `key` selects the shared pure-function
 * scorer; `config` parameterizes it. Only `deterministic` assertions may carry
 * `severity: 'gate'` (the gate tier must be reproducible); `llm_judge` is always `warn`.
 */
@Entity({ tableName: 'agent_eval_assertions' })
@Index({ name: 'agent_eval_assertions_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_eval_assertions_applies_idx', properties: ['organizationId', 'appliesTo', 'enabled'] })
@Unique({ name: 'agent_eval_assertions_key_uq', properties: ['organizationId', 'appliesTo', 'key'] })
export class AgentEvalAssertion {
  [OptionalProps]?:
    | 'description' | 'config' | 'version' | 'enabled' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'key', type: 'varchar', length: 100 })
  key!: string

  @Property({ name: 'title', type: 'varchar', length: 200 })
  title!: string

  @Property({ name: 'description', type: 'text', nullable: true })
  description?: string | null

  /** Target agent definition id, or `'*'` to apply to every agent. */
  @Property({ name: 'applies_to', type: 'varchar', length: 100 })
  appliesTo!: string

  @Property({ name: 'type', type: 'varchar', length: 20 })
  type!: AgentEvalAssertionType

  @Property({ name: 'severity', type: 'varchar', length: 20 })
  severity!: AgentEvalSeverity

  @Property({ name: 'config', type: 'jsonb', nullable: true })
  config?: unknown | null

  @Property({ name: 'version', type: 'integer', default: 1 })
  version: number = 1

  @Property({ name: 'enabled', type: 'boolean', default: true })
  enabled: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * The verdict of one assertion against one run. Append-only (omits
 * `updated_at`/`deleted_at`) — eval results are legal records retained ≥6 years.
 * A failing `gate` result marks the run `evalPassed = false`; `warn` never blocks.
 */
@Entity({ tableName: 'agent_eval_results' })
@Index({ name: 'agent_eval_results_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_eval_results_run_idx', properties: ['agentRunId'] })
@Index({ name: 'agent_eval_results_assertion_idx', properties: ['assertionId'] })
export class AgentEvalResult {
  [OptionalProps]?: 'score' | 'evidence' | 'evaluatedAt' | 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** FK id → agent_runs. */
  @Property({ name: 'agent_run_id', type: 'uuid' })
  agentRunId!: string

  /** FK id → agent_eval_assertions. */
  @Property({ name: 'assertion_id', type: 'uuid' })
  assertionId!: string

  @Property({ name: 'assertion_key', type: 'varchar', length: 100 })
  assertionKey!: string

  @Property({ name: 'passed', type: 'boolean' })
  passed!: boolean

  @Property({ name: 'score', type: 'float', nullable: true })
  score?: number | null

  @Property({ name: 'severity', type: 'varchar', length: 20 })
  severity!: AgentEvalSeverity

  @Property({ name: 'evidence', type: 'jsonb', nullable: true })
  evidence?: unknown | null

  @Property({ name: 'evaluated_at', type: Date, onCreate: () => new Date() })
  evaluatedAt: Date = new Date()

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

/**
 * A precomputed per-agent KPI window (F2 metric rollups). Append-only (omits
 * `updated_at`/`deleted_at`): each row is an immutable snapshot of an agent's
 * metrics over a fixed `[windowStart, windowEnd)`. The rollup worker recomputes
 * and re-stamps a row idempotently per `(organizationId, agentId, windowStart)`
 * so the metrics endpoint reads a stable window with a live fallback instead of
 * a capped live scan. `metrics` jsonb shape is validated by the Zod schema in
 * data/validators.ts. Other modules referenced by FK id only.
 */
@Entity({ tableName: 'agent_metric_rollups' })
@Index({ name: 'agent_metric_rollups_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_metric_rollups_lookup_idx', properties: ['organizationId', 'agentId', 'windowStart'] })
export class AgentMetricRollup {
  [OptionalProps]?: 'computedAt' | 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** Agent definition id — mirrors AgentRun.agentId (NOT agentDefinitionId). */
  @Property({ name: 'agent_id', type: 'varchar', length: 100 })
  agentId!: string

  @Property({ name: 'window_start', type: Date })
  windowStart!: Date

  @Property({ name: 'window_end', type: Date })
  windowEnd!: Date

  @Property({ name: 'computed_at', type: Date, onCreate: () => new Date() })
  computedAt: Date = new Date()

  /** override/eval-pass/approve-unchanged/latency/cost/count KPIs (validated by Zod). */
  @Property({ name: 'metrics', type: 'jsonb' })
  metrics!: unknown

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

export type AgentRunSessionStatus = 'pending' | 'completed'

/**
 * Cross-process correlation for an OpenCode file-agent run. The runner (app /
 * worker process) and the `submit_outcome` / `load_skill` / `run_skill_script`
 * MCP tools (separate `mcp:serve-http` process) do NOT share memory, so the
 * active-agent + captured-outcome handoff cannot live in an in-process Map. This
 * row, keyed by the per-run session token, is the shared store both processes
 * reach: the runner `open`s it before sending; `submit_outcome` resolves the
 * active agent from it and writes the validated `outcome`; the runner polls for
 * the completed outcome and `dispose`s the row when the run ends.
 */
@Entity({ tableName: 'agent_run_sessions' })
@Index({ name: 'agent_run_sessions_token_idx', properties: ['sessionToken'] })
export class AgentRunSession {
  [OptionalProps]?: 'runId' | 'outcome' | 'status' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  /** The per-run session token the runner minted = the correlation key (unique). */
  @Property({ name: 'session_token', type: 'varchar', length: 100, unique: true })
  sessionToken!: string

  @Property({ name: 'agent_id', type: 'varchar', length: 100 })
  agentId!: string

  @Property({ name: 'run_id', type: 'uuid', nullable: true })
  runId?: string | null

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** The validated outcome captured by `submit_outcome`, once it arrives. */
  @Property({ name: 'outcome', type: 'jsonb', nullable: true })
  outcome?: unknown | null

  @Property({ name: 'status', type: 'varchar', length: 20, default: 'pending' })
  status: AgentRunSessionStatus = 'pending'

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

export type GuardrailPhase = 'input' | 'output'

export type GuardrailKind =
  | 'prompt_injection'
  | 'pii'
  | 'grounding'
  | 'schema'
  | 'moderation'
  | 'tool_scope'

export type GuardrailResult = 'pass' | 'warn' | 'block'

/**
 * Append-only audit of every runtime guardrail check (omits `updated_at`/
 * `deleted_at`). One row per check per phase; `guardResults` on the AgentProposal
 * carries the same verdict for fast read. `evidence` holds REDACTED data only
 * (pointers/offsets into the encrypted artifact store) — never raw PII. Shape is
 * enforced by the Zod schema in data/validators.ts. Other modules referenced by
 * FK id only (agentRunId, proposalId).
 */
@Entity({ tableName: 'agent_guardrail_checks' })
@Index({ name: 'agent_guardrail_checks_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_guardrail_checks_run_idx', properties: ['agentRunId', 'createdAt'] })
@Index({ name: 'agent_guardrail_checks_proposal_idx', properties: ['proposalId'] })
export class AgentGuardrailCheck {
  [OptionalProps]?: 'result' | 'evidence' | 'proposalId' | 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** FK id → agent_runs; NOT an ORM relation. */
  @Property({ name: 'agent_run_id', type: 'uuid' })
  agentRunId!: string

  /** FK id → agent_proposals (null for pre-call input checks). */
  @Property({ name: 'proposal_id', type: 'uuid', nullable: true })
  proposalId?: string | null

  /** Which versioned set produced this verdict. */
  @Property({ name: 'guardrail_set_version', type: 'varchar', length: 64 })
  guardrailSetVersion!: string

  @Property({ name: 'capability', type: 'varchar', length: 100 })
  capability!: string

  @Property({ name: 'phase', type: 'varchar', length: 10 })
  phase!: GuardrailPhase

  @Property({ name: 'kind', type: 'varchar', length: 30 })
  kind!: GuardrailKind

  @Property({ name: 'result', type: 'varchar', length: 10, default: 'pass' })
  result: GuardrailResult = 'pass'

  /**
   * Redacted evidence ONLY — never raw PII; pointers/offsets into the encrypted
   * artifact store (trace spec) rather than plaintext spans. Shape enforced by a
   * Zod schema in data/validators.ts.
   */
  @Property({ name: 'evidence', type: 'jsonb', nullable: true })
  evidence?: unknown | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

/**
 * A versioned guardrail SET for one capability (Wave 3, Phase 4 — grounding).
 * Append-only by version (omits `updated_at`/`deleted_at`): each row pins a
 * capability's policy body under a CONTENT-HASH `version`. The grounding sync
 * (setup.ts `seedDefaults`) upserts one row per `(organizationId, capability,
 * version)` — re-syncing an unchanged body is a no-op (idempotent), and editing
 * the body produces a new content-hash → a new append-only version. The
 * `guardrailSetVersion` recorded on every grounding `AgentGuardrailCheck` is this
 * `version`, so a verdict is replayable against the exact policy that produced it.
 * Other modules referenced by FK id only.
 */
@Entity({ tableName: 'agent_guardrail_sets' })
@Index({ name: 'agent_guardrail_sets_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_guardrail_sets_capability_idx', properties: ['organizationId', 'capability'] })
@Unique({ name: 'agent_guardrail_sets_version_uq', properties: ['organizationId', 'capability', 'version'] })
export class AgentGuardrailSet {
  [OptionalProps]?: 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'capability', type: 'varchar', length: 100 })
  capability!: string

  /** Content-hash of the canonical set body — the durable version key. */
  @Property({ name: 'version', type: 'varchar', length: 64 })
  version!: string

  /** The grounding policy body. Shape enforced by Zod in data/validators.ts. */
  @Property({ name: 'body', type: 'jsonb' })
  body!: unknown

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

/**
 * Which authentication path an agent principal uses (agent identity spec).
 * `internal` = in-process `INVOKE_AGENT` step, NO network auth and NO interactive
 * credential (Phase 1; the only mode provisioned today). `oauth_client` =
 * net-new OAuth client-credentials `/token` server (Phase 3). `authmd` =
 * `auth.md` / ID-JAG self-registration (Phase 4). The non-`internal` modes are
 * declared here as forward-compatible seams; only `internal` is provisioned now.
 */
export type AgentCredentialMode = 'internal' | 'oauth_client' | 'authmd'

/**
 * Links an AI agent to its provisioned non-interactive `auth.User` (`kind='agent'`)
 * and a scoped, least-privilege `auth.Role`, so every agent action is attributed
 * to a concrete user id through the same Command/CRUD/ACL/audit pipeline as a
 * human (agent identity & on-behalf-of spec, Wave 4 Phase 1). Editable (revoke /
 * disable) → carries `updated_at` for optimistic locking. Other modules
 * (`auth.User`, `auth.Role`, the agent definition) are referenced by FK id only —
 * NOT as ORM relations — per the cross-module decoupling rule.
 */
// One LIVE principal per (organization_id, agent_definition_id) is enforced by a
// partial unique index (`agent_principals_org_agent_uq`) over live rows
// (`WHERE deleted_at IS NULL`), created by raw SQL in Migration20260625050000. A
// `@Unique` decorator can't express a partial index (it would block re-provisioning
// after a soft-delete), so it is declared via `@Index({ expression })` — the
// repo's partial-index convention (cf. `agent_runs_eval_failed_idx`) — which
// keeps `db:generate` snapshot-aware of it instead of emitting a drop each run.
@Entity({ tableName: 'agent_principals' })
@Index({ name: 'agent_principals_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_principals_user_idx', properties: ['userId'] })
@Index({
  name: 'agent_principals_org_agent_uq',
  expression:
    `create unique index "agent_principals_org_agent_uq" on "agent_principals" ("organization_id", "agent_definition_id") where "deleted_at" is null`,
})
export class AgentPrincipal {
  [OptionalProps]?: 'credentialMode' | 'enabled' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** FK id → auth.User (kind='agent'); NOT an ORM relation. */
  @Property({ name: 'user_id', type: 'uuid' })
  userId!: string

  /** FK id → the agent definition (the `defineAgent`/file-agent id). */
  @Property({ name: 'agent_definition_id', type: 'varchar', length: 100 })
  agentDefinitionId!: string

  /** FK id → auth.Role (scoped, least privilege); NOT an ORM relation. */
  @Property({ name: 'role_id', type: 'uuid' })
  roleId!: string

  /** Selects the auth path explicitly; only `internal` is provisioned in Phase 1. */
  @Property({ name: 'credential_mode', type: 'varchar', length: 20, default: 'internal' })
  credentialMode: AgentCredentialMode = 'internal'

  @Property({ name: 'enabled', type: 'boolean', default: true })
  enabled: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * An external agent's delegation grant (agent identity & on-behalf-of spec, Wave 4
 * Phase 3). Links an external `AgentPrincipal` (`credentialMode='oauth_client'`)
 * to the human delegator + the scopes it may mint OAuth client-credentials tokens
 * for, and is the per-request REVOCATION spine: the `/token` server refuses to
 * mint while every minted token re-checks `revokedAt`/`expiresAt` on the NEXT
 * write, so revoking stops further agent action immediately rather than at token
 * expiry. The `issuer`/`subject`/`audience` columns are forward-compatible seams
 * for the later `auth.md`/ID-JAG path (Phase 4) — null for the OAuth-now path, so
 * the same record bridges both with no schema change. Editable (revoke) → carries
 * `updated_at` for optimistic locking. Dual tenancy (tenant_id + organization_id);
 * reads filter by organization_id. Other modules (`auth.User`, the agent
 * principal) are referenced by FK id only — NOT as ORM relations.
 */
@Entity({ tableName: 'agent_delegation_grants' })
@Index({ name: 'agent_delegation_grants_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_delegation_grants_principal_idx', properties: ['organizationId', 'agentPrincipalId'] })
export class AgentDelegationGrant {
  [OptionalProps]?: 'delegatorUserId' | 'expiresAt' | 'revokedAt' | 'revokedByUserId'
    | 'issuer' | 'subject' | 'audience' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** FK id → agent_principals (the external principal); NOT an ORM relation. */
  @Property({ name: 'agent_principal_id', type: 'uuid' })
  agentPrincipalId!: string

  /** FK id → the agent principal's `auth.User` (actor on every attributed write). */
  @Property({ name: 'agent_user_id', type: 'uuid' })
  agentUserId!: string

  /** FK id → auth.User — the human delegating authority; null for system grants. */
  @Property({ name: 'delegator_user_id', type: 'uuid', nullable: true })
  delegatorUserId?: string | null

  /** `<capability>:<action>` scopes the minted token may carry. */
  @Property({ name: 'scopes', type: 'jsonb' })
  scopes!: string[]

  /** Optional hard expiry; tokens never outlive this even before revocation. */
  @Property({ name: 'expires_at', type: Date, nullable: true })
  expiresAt?: Date | null

  /** When set, every token bound to this grant is denied on its next request. */
  @Property({ name: 'revoked_at', type: Date, nullable: true })
  revokedAt?: Date | null

  /** FK id → auth.User who revoked the grant. */
  @Property({ name: 'revoked_by_user_id', type: 'uuid', nullable: true })
  revokedByUserId?: string | null

  /** Forward-compatible ID-JAG seam (Phase 4); null for the OAuth-now path. */
  @Property({ name: 'issuer', type: 'varchar', length: 500, nullable: true })
  issuer?: string | null

  @Property({ name: 'subject', type: 'varchar', length: 500, nullable: true })
  subject?: string | null

  @Property({ name: 'audience', type: 'varchar', length: 500, nullable: true })
  audience?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

export type AgentProposalDisposition =
  | 'pending' | 'auto_approved' | 'approved' | 'edited' | 'rejected'

@Entity({ tableName: 'agent_proposals' })
@Index({ name: 'agent_proposals_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_proposals_run_idx', properties: ['organizationId', 'runId'] })
@Index({ name: 'agent_proposals_org_disposition_created_idx', properties: ['organizationId', 'disposition', 'createdAt'] })
export class AgentProposal {
  [OptionalProps]?: 'disposition' | 'dispositionBy' | 'dispositionReason'
    | 'processId' | 'stepId' | 'confidence' | 'guardResults' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'agent_id', type: 'varchar', length: 100 })
  agentId!: string

  @Property({ name: 'run_id', type: 'uuid' })
  runId!: string

  @Property({ name: 'process_id', type: 'uuid', nullable: true })
  processId?: string | null

  @Property({ name: 'step_id', type: 'varchar', length: 100, nullable: true })
  stepId?: string | null

  @Property({ name: 'payload', type: 'jsonb' })
  payload!: unknown

  @Property({ name: 'confidence', type: 'float', nullable: true })
  confidence?: number | null

  /**
   * The guardrail verdict's `checks` array attached at proposal creation (output
   * phase). Append-only audit lives in `agent_guardrail_checks`; this is the fast
   * read carried on the proposal. Validated by the Zod schema in data/validators.ts.
   */
  @Property({ name: 'guard_results', type: 'jsonb', nullable: true })
  guardResults?: unknown | null

  @Property({ name: 'disposition', type: 'varchar', length: 20, default: 'pending' })
  disposition: AgentProposalDisposition = 'pending'

  @Property({ name: 'disposition_by', type: 'varchar', length: 100, nullable: true })
  dispositionBy?: string | null

  @Property({ name: 'disposition_reason', type: 'text', nullable: true })
  dispositionReason?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * The single durable artifact of a Task-Driven Context Routing (TDCR) assembly —
 * the evidence record of *what an agent saw* for one `INVOKE_AGENT` run. Append-only
 * (omits `updated_at`/`deleted_at`) per conventions §3.2: it is immutable evidence
 * read by the trace inspector (routed vs. pruned + token usage), the guardrails
 * grounding check (cited snippets), and compliance lineage (fact → evidence).
 *
 * `routedSources`/`prunedSources`/`sources`/`redactionApplied` jsonb shapes are
 * enforced by Zod in data/validators.ts (`contextBundleRoutedSourcesSchema` etc.).
 * Other modules referenced by FK id only (agentRunId, processId).
 */
@Entity({ tableName: 'agent_context_bundles' })
@Index({ name: 'agent_context_bundles_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_context_bundles_run_idx', properties: ['agentRunId'] })
export class AgentContextBundle {
  [OptionalProps]?: 'processId' | 'stepId' | 'prunedSources' | 'redactionApplied' | 'payloadRef' | 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** FK id → agent_runs; NOT an ORM relation. */
  @Property({ name: 'agent_run_id', type: 'uuid' })
  agentRunId!: string

  /** FK id → workflows process instance (null for standalone runs). */
  @Property({ name: 'process_id', type: 'uuid', nullable: true })
  processId?: string | null

  @Property({ name: 'step_id', type: 'varchar', length: 100, nullable: true })
  stepId?: string | null

  @Property({ name: 'capability', type: 'varchar', length: 100 })
  capability!: string

  /**
   * Selected & packed sources: `{ kind, ref, locator?, tokens, score? }[]`. The
   * mandatory floor is always present here. Shape enforced by Zod.
   */
  @Property({ name: 'routed_sources', type: 'jsonb' })
  routedSources!: unknown

  /**
   * Excluded candidates with a reason (over budget / out of scope):
   * `{ kind, ref, reason }[]`. Records the optional-fill variance for audit.
   */
  @Property({ name: 'pruned_sources', type: 'jsonb', nullable: true })
  prunedSources?: unknown | null

  /** Provenance: `{ factId, sourceKind, sourceRef, locator? }[]` (→ lineage). */
  @Property({ name: 'sources', type: 'jsonb' })
  sources!: unknown

  @Property({ name: 'token_budget', type: 'integer' })
  tokenBudget!: number

  @Property({ name: 'tokens_used', type: 'integer' })
  tokensUsed!: number

  /** `{ field, rule }[]` redacted before the agent saw it (P4 populates richer rules). */
  @Property({ name: 'redaction_applied', type: 'jsonb', nullable: true })
  redactionApplied?: unknown | null

  /** storage-s3 ref to the packed context payload (P4 offloads the full payload). */
  @Property({ name: 'payload_ref', type: 'varchar', length: 500, nullable: true })
  payloadRef?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

export type AgentTaskTargetType = 'agent' | 'workflow'
export type AgentTaskRunStatus = 'running' | 'completed' | 'failed'

/**
 * A persisted, reusable "agentic task" launcher (Agentic Tasks spec,
 * 2026-07-03): a named, permissioned pointer at either a single agent or a
 * `workflows` definition, triggerable manually / via API key / on a schedule /
 * by a domain event. Deliberately NOT the dispatch spec's `AgentTask`
 * (external-fleet routing) — different concept, different tables.
 *
 * User-editable → carries `updated_at` for optimistic locking (default ON).
 * Every definition executes under its own auto-provisioned `AgentPrincipal`
 * (`executionPrincipalId`, synthetic agent id `task:<id>`), never as the
 * triggering user.
 */
@Entity({ tableName: 'agent_task_definitions' })
@Index({ name: 'agent_task_definitions_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_task_definitions_target_idx', properties: ['organizationId', 'targetType'] })
export class AgentTaskDefinition {
  [OptionalProps]?:
    | 'description'
    | 'targetAgentId'
    | 'targetWorkflowId'
    | 'inputDefaults'
    | 'inputSchema'
    | 'executionPrincipalId'
    | 'grantedFeatures'
    | 'scheduleCron'
    | 'scheduleTimezone'
    | 'scheduleEnabled'
    | 'enabled'
    | 'createdBy'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'name', type: 'varchar', length: 255 })
  name!: string

  @Property({ name: 'description', type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'target_type', type: 'varchar', length: 20 })
  targetType!: AgentTaskTargetType

  /** Stable registry `agentId` when targetType='agent'. */
  @Property({ name: 'target_agent_id', type: 'varchar', length: 150, nullable: true })
  targetAgentId?: string | null

  /** `WorkflowDefinition.workflowId` when targetType='workflow' (FK id only, no ORM relation). */
  @Property({ name: 'target_workflow_id', type: 'varchar', length: 150, nullable: true })
  targetWorkflowId?: string | null

  /** Default input merged under the run-time input; encrypted (encryption.ts). */
  @Property({ name: 'input_defaults', type: 'jsonb', nullable: true })
  inputDefaults?: unknown | null

  /** Optional JSON-Schema (OUTCOME-compatible subset) validating `/run` input. */
  @Property({ name: 'input_schema', type: 'jsonb', nullable: true })
  inputSchema?: unknown | null

  /**
   * FK id → agent_principals; the task's dedicated execution identity. Nullable
   * only for the instant between the insert and the afterCreate provisioning
   * hook — never null for a task the UI can run.
   */
  @Property({ name: 'execution_principal_id', type: 'uuid', nullable: true })
  executionPrincipalId?: string | null

  /**
   * The exact least-privilege feature set granted to the execution principal's
   * role. Stored on the definition so the detail page can audit it and updates
   * can diff without reading auth.RoleAcl cross-module.
   */
  @Property({ name: 'granted_features', type: 'jsonb', nullable: true })
  grantedFeatures?: string[] | null

  @Property({ name: 'schedule_cron', type: 'varchar', length: 100, nullable: true })
  scheduleCron?: string | null

  @Property({ name: 'schedule_timezone', type: 'varchar', length: 64, nullable: true })
  scheduleTimezone?: string | null

  @Property({ name: 'schedule_enabled', type: 'boolean', default: true })
  scheduleEnabled: boolean = true

  @Property({ name: 'enabled', type: 'boolean', default: true })
  enabled: boolean = true

  /** FK id → auth.users; the admin who created the task. */
  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * One execution of an `AgentTaskDefinition` — the unified, shallow run ledger
 * across both target types (the deep trace stays in agent_runs / workflow
 * instances). System-transitioned (`running → completed|failed`), no user edit
 * form → exempt from the optimistic-lock UI surface, mirroring `AgentRun`.
 * Target pointers are denormalized so history survives definition edits.
 */
@Entity({ tableName: 'agent_task_runs' })
@Index({ name: 'agent_task_runs_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_task_runs_definition_idx', properties: ['taskDefinitionId', 'createdAt'] })
@Index({ name: 'agent_task_runs_source_idx', properties: ['sourceEntityType', 'sourceEntityId'] })
@Index({
  name: 'agent_task_runs_idempotency_uq',
  expression:
    `create unique index "agent_task_runs_idempotency_uq" on "agent_task_runs" ("organization_id", "task_definition_id", "idempotency_key") where "idempotency_key" is not null`,
})
export class AgentTaskRun {
  [OptionalProps]?:
    | 'status'
    | 'targetAgentId'
    | 'targetWorkflowId'
    | 'agentRunId'
    | 'workflowInstanceId'
    | 'sourceEntityType'
    | 'sourceEntityId'
    | 'idempotencyKey'
    | 'startedAt'
    | 'completedAt'
    | 'failureReason'
    | 'createdAt'
    | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** FK id → agent_task_definitions. */
  @Property({ name: 'task_definition_id', type: 'uuid' })
  taskDefinitionId!: string

  /** Denormalized snapshot at trigger time. */
  @Property({ name: 'target_type', type: 'varchar', length: 20 })
  targetType!: AgentTaskTargetType

  @Property({ name: 'target_agent_id', type: 'varchar', length: 150, nullable: true })
  targetAgentId?: string | null

  @Property({ name: 'target_workflow_id', type: 'varchar', length: 150, nullable: true })
  targetWorkflowId?: string | null

  @Property({ name: 'status', type: 'varchar', length: 20, default: 'running' })
  status: AgentTaskRunStatus = 'running'

  /** FK id → agent_runs (agent target). */
  @Property({ name: 'agent_run_id', type: 'uuid', nullable: true })
  agentRunId?: string | null

  /** FK id → workflows instance (workflow target). */
  @Property({ name: 'workflow_instance_id', type: 'uuid', nullable: true })
  workflowInstanceId?: string | null

  /** The resolved input actually used; encrypted (encryption.ts). */
  @Property({ name: 'input', type: 'jsonb' })
  input!: unknown

  /** Correlates to the triggering business record for cross-module launches. */
  @Property({ name: 'source_entity_type', type: 'varchar', length: 100, nullable: true })
  sourceEntityType?: string | null

  @Property({ name: 'source_entity_id', type: 'uuid', nullable: true })
  sourceEntityId?: string | null

  /** Provenance only, never an ACL identity: `user:<id>` / `api_key:<id>` / `schedule:<id>` / `event:<eventName>`. */
  @Property({ name: 'triggered_by', type: 'varchar', length: 150 })
  triggeredBy!: string

  @Property({ name: 'idempotency_key', type: 'varchar', length: 200, nullable: true })
  idempotencyKey?: string | null

  @Property({ name: 'started_at', type: Date, nullable: true })
  startedAt?: Date | null

  @Property({ name: 'completed_at', type: Date, nullable: true })
  completedAt?: Date | null

  /** May echo malformed input on validation failure; encrypted (encryption.ts). */
  @Property({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

/**
 * A domain-event trigger for an `AgentTaskDefinition` — mirrors `workflows`'
 * `WorkflowEventTrigger` (`eventPattern` + `{ filterConditions, contextMapping,
 * debounceMs, maxConcurrentInstances }` config), evaluated by the module's own
 * wildcard subscriber. User-editable → `updated_at` for optimistic locking.
 */
@Entity({ tableName: 'agent_task_event_triggers' })
@Index({ name: 'agent_task_event_triggers_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_task_event_triggers_definition_idx', properties: ['taskDefinitionId'] })
export class AgentTaskEventTrigger {
  [OptionalProps]?: 'config' | 'enabled' | 'priority' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** FK id → agent_task_definitions. */
  @Property({ name: 'task_definition_id', type: 'uuid' })
  taskDefinitionId!: string

  /** e.g. `claims.claim.reported` or a trailing-wildcard `claims.*`. */
  @Property({ name: 'event_pattern', type: 'varchar', length: 255 })
  eventPattern!: string

  /** `{ filterConditions?, contextMapping?, debounceMs?, maxConcurrentInstances? }` (WorkflowEventTriggerConfig shape). */
  @Property({ name: 'config', type: 'jsonb', nullable: true })
  config?: unknown | null

  @Property({ name: 'enabled', type: 'boolean', default: true })
  enabled: boolean = true

  @Property({ name: 'priority', type: 'integer', default: 0 })
  priority: number = 0

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/** Derived display status of an `AgentProcess` (spec §Status derivation — first match wins). */
export type AgentProcessStatus =
  | 'running'
  | 'waiting_on_you'
  | 'question_open'
  | 'docs_requested'
  | 'fraud_hold'
  | 'auto_completing'
  | 'auto_completed'
  | 'completed'
  | 'failed'
  | 'cancelled'

/**
 * Read-model projection: ONE row per `(tenant, org, processId)` — the indexable
 * backing of the Processes cockpit list/detail-header (process subject & caseload
 * projection spec, 2026-06-25). NOT a source of truth: the `workflows` instance
 * stays authoritative; this row is derived from agent + workflow lifecycle events
 * by an idempotent recompute-from-source subscriber service and is fully
 * rebuildable via the `rebuild-processes` CLI backfill. Filter-driving subject
 * facets (`subject_type`/`subject_value_minor`/`subject_fraud`) are deliberately
 * PLAINTEXT typed columns (SQL-filterable); only the free-text `subject_title` is
 * encrypted (encryption.ts). Other modules referenced by FK id only.
 */
// One LIVE projection per (tenant, org, process) is enforced by a partial unique
// index (`agent_processes_org_process_uq`) over live rows (`WHERE deleted_at IS
// NULL`), declared via `@Index({ expression })` so `db:generate` stays aware of
// it (precedent: `agent_task_runs_idempotency_uq`, `agent_runs_eval_failed_idx`).
@Entity({ tableName: 'agent_processes' })
@Index({ name: 'agent_processes_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_processes_status_idx', properties: ['organizationId', 'status', 'lastActivityAt'] })
@Index({ name: 'agent_processes_value_idx', properties: ['organizationId', 'subjectValueMinor'] })
@Index({
  name: 'agent_processes_org_process_uq',
  expression:
    `create unique index "agent_processes_org_process_uq" on "agent_processes" ("tenant_id", "organization_id", "process_id") where "deleted_at" is null`,
})
export class AgentProcess {
  [OptionalProps]?: 'workflowId' | 'workflowVersion'
    | 'subjectType' | 'subjectId' | 'subjectLabel' | 'subjectTitle' | 'subjectFacets'
    | 'subjectValueMinor' | 'subjectFraud'
    | 'status' | 'currentStage' | 'agentIds' | 'costMinor' | 'currency'
    | 'runCount' | 'pendingProposalCount'
    | 'assigneeUserId' | 'teamId' | 'waitingSince' | 'lastActivityAt'
    | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** FK id → workflows instance; NOT an ORM relation. Unique per (tenant, org) over live rows. */
  @Property({ name: 'process_id', type: 'uuid' })
  processId!: string

  @Property({ name: 'workflow_id', type: 'varchar', length: 200, nullable: true })
  workflowId?: string | null

  @Property({ name: 'workflow_version', type: 'varchar', length: 50, nullable: true })
  workflowVersion?: string | null

  // ── Subject (the business record this process is about) ────────────────────
  /** e.g. 'Motor' — TYPE column + filter. Plaintext: must be SQL-queryable. */
  @Property({ name: 'subject_type', type: 'varchar', length: 100, nullable: true })
  subjectType?: string | null

  /** Business record id (opaque; FK by value only). */
  @Property({ name: 'subject_id', type: 'varchar', length: 200, nullable: true })
  subjectId?: string | null

  /** e.g. 'CLM-2026-04417' — low-sensitivity ref kept plaintext for `q` search. */
  @Property({ name: 'subject_label', type: 'varchar', length: 200, nullable: true })
  subjectLabel?: string | null

  /**
   * Free-text, person-readable subject — the ONLY encrypted subject field
   * (encryption.ts → `agent_orchestrator:agent_process`). Never SQL-filtered.
   */
  @Property({ name: 'subject_title', type: 'varchar', length: 300, nullable: true })
  subjectTitle?: string | null

  /** Claim value in minor units — High-value filter / value sort. Plaintext by design. */
  @Property({ name: 'subject_value_minor', type: 'bigint', nullable: true })
  subjectValueMinor?: number | null

  /** Fraud signal — Fraud-flagged filter. Plaintext by design. */
  @Property({ name: 'subject_fraud', type: 'boolean', nullable: true })
  subjectFraud?: boolean | null

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
  runCount: number = 0

  @Property({ name: 'pending_proposal_count', type: 'integer', default: 0 })
  pendingProposalCount: number = 0

  // ── Routing / SLA (mirrored from workflows for fast filtering; Phase B) ─────
  @Property({ name: 'assignee_user_id', type: 'uuid', nullable: true })
  assigneeUserId?: string | null

  @Property({ name: 'team_id', type: 'uuid', nullable: true })
  teamId?: string | null

  /** When the process entered a human-waiting state (Stuck >24h filter). */
  @Property({ name: 'waiting_since', type: Date, nullable: true })
  waitingSince?: Date | null

  /** First observed agent activity for the process (AGE column). */
  @Property({ name: 'opened_at', type: Date })
  openedAt!: Date

  @Property({ name: 'last_activity_at', type: Date, onCreate: () => new Date() })
  lastActivityAt: Date = new Date()

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * Per-(tenant, organization) presentation settings for an agent DEFINITION.
 * Agent definitions themselves are code/file-authored (see `defineAgent`), so
 * they are global and carry no per-tenant state — this table holds the tenant's
 * editable overrides for how an agent is presented in the cockpit. Today it
 * carries a single `icon` (a lucide icon name from `data/agentIcons.ts`) that
 * replaces the auto-generated initials avatar across the agent presentation
 * surfaces (agents list, overview "Agent trust" card, agent detail). Seeded
 * with sensible defaults in `setup.ts` → `seedDefaults`, idempotently.
 *
 * Editable → carries `updated_at` for optimistic locking. Keyed by the agent
 * definition id (a string like `deals.health_check`), referenced by id only —
 * NOT an ORM relation — per the cross-module decoupling rule.
 */
@Entity({ tableName: 'agent_settings' })
@Index({ name: 'agent_settings_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Unique({ name: 'agent_settings_org_agent_uq', properties: ['tenantId', 'organizationId', 'agentId'] })
export class AgentSetting {
  [OptionalProps]?: 'icon' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** Agent DEFINITION id (e.g. `deals.health_check`). Not an FK — decoupled. */
  @Property({ name: 'agent_id', type: 'varchar', length: 100 })
  agentId!: string

  /** Lucide icon name from `AGENT_ICON_NAMES` (data/agentIcons.ts). Null = fall back to type glyph / initials. */
  @Property({ name: 'icon', type: 'varchar', length: 64, nullable: true })
  icon?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

// ── File plane: agent-produced artifacts (attachments-in / artifacts-out) ─────

/** Where a captured artifact came from. `tool_output` is reserved for a future tool-file channel. */
export type AgentRunArtifactSource = 'agent_output' | 'tool_output'

/**
 * One file an OpenCode file-agent produced in a run (scanned from the per-run
 * sandbox `out/` dir, hashed, and uploaded encrypted to `storage-s3`). Append-only
 * (immutable after capture, so no `updated_at`); keeps `deleted_at` for DSAR/erasure.
 * The file BYTES live in `storage-s3` (referenced by `storageKey`, encrypted at rest);
 * this row is inert metadata until an `attachments.attach_artifact` proposal is
 * approved and the effector materializes a durable `Attachment` (`promotedAttachmentId`).
 * Referenced by FK ids only (`runId`, `promotedAttachmentId`) — never an ORM relation.
 */
@Entity({ tableName: 'agent_run_artifacts' })
@Index({ name: 'agent_run_artifacts_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_run_artifacts_run_idx', properties: ['organizationId', 'runId'] })
@Unique({ name: 'agent_run_artifacts_run_sha_uq', properties: ['runId', 'sha256', 'fileName'] })
export class AgentRunArtifact {
  [OptionalProps]?: 'source' | 'caption' | 'promotedAttachmentId' | 'createdAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** FK id → agent_runs; NOT an ORM relation. */
  @Property({ name: 'run_id', type: 'uuid' })
  runId!: string

  /** Sanitized basename produced by the agent (no path segments). Non-sensitive metadata. */
  @Property({ name: 'file_name', type: 'varchar', length: 255 })
  fileName!: string

  @Property({ name: 'mime_type', type: 'varchar', length: 150 })
  mimeType!: string

  @Property({ name: 'file_size', type: 'integer' })
  fileSize!: number

  @Property({ name: 'sha256', type: 'varchar', length: 64 })
  sha256!: string

  /** storage-s3 object key; bytes encrypted at rest. */
  @Property({ name: 'storage_key', type: 'varchar', length: 500 })
  storageKey!: string

  /** Agent-supplied description; encrypted (encryption.ts → `agent_orchestrator:agent_run_artifact`). */
  @Property({ name: 'caption', type: 'text', nullable: true })
  caption?: string | null

  @Property({ name: 'source', type: 'varchar', length: 20, default: 'agent_output' })
  source: AgentRunArtifactSource = 'agent_output'

  /** Set when an `attachments.attach_artifact` proposal is approved and the effector runs. */
  @Property({ name: 'promoted_attachment_id', type: 'uuid', nullable: true })
  promotedAttachmentId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
