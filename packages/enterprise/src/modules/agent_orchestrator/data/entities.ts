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

  @Property({ name: 'status', type: 'varchar', length: 20, default: 'running' })
  status: AgentRunStatus = 'running'

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

export type AgentProposalDisposition =
  | 'pending' | 'auto_approved' | 'approved' | 'edited' | 'rejected'

@Entity({ tableName: 'agent_proposals' })
@Index({ name: 'agent_proposals_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_proposals_run_idx', properties: ['organizationId', 'runId'] })
export class AgentProposal {
  [OptionalProps]?: 'disposition' | 'dispositionBy' | 'dispositionReason'
    | 'processId' | 'stepId' | 'confidence' | 'createdAt' | 'updatedAt' | 'deletedAt'

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
