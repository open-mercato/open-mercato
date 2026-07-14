/**
 * Client-side view types for the cockpit UI. These mirror the snake_case
 * shapes returned by the area-01/03 list APIs, normalized to camelCase for the
 * React layer. No new entities — these are pure read projections.
 */
import { isAgentIconName, type AgentIconName } from '../data/agentIcons'

export type ProposalView = {
  id: string
  agentId: string
  runId: string
  processId: string | null
  stepId: string | null
  payload: unknown
  confidence: number | null
  /** `payload.rationale` when the persisted proposal payload carries one. */
  rationale: string | null
  /** Guardrail verdict checks attached at proposal creation (`guard_results`). */
  guardResults: GuardCheckView[]
  disposition: string
  dispositionBy: string | null
  dispositionReason: string | null
  createdAt: string | null
  updatedAt: string | null
}

export type GuardCheckView = {
  kind: string
  result: string
}

/** Windowed traces KPI block on GET /metrics/overview (data-honesty pass). */
export type TracesKpiView = {
  p95LatencyMs: number | null
  errorRate: number | null
  evalPassRate: number | null
  source: 'rollup' | 'live'
}

/** Response of GET /metrics/overview — org-level cockpit aggregates. */
export type OverviewMetricsView = {
  window: string
  autoApproveRate: number | null
  pendingCount: number
  oldestPendingAt: string | null
  runsTotal: number
  dispositionCounts: Record<string, number>
  /** Windowed count of operator corrections (additive). */
  correctionsCount: number | null
  /** Traces-list KPI block (additive); null when the server predates it. */
  traces: TracesKpiView | null
  source: 'rollup' | 'live'
}

/** One item of GET /metrics/agents — per-agent window metrics. */
export type AgentWindowMetricsView = {
  agentId: string
  runsTotal: number
  errorRate: number | null
  overrideRate: number | null
  evalPassRate: number | null
  avgLatencyMs: number | null
  avgCostMinor: number | null
  costMinorTotal: number
  disposedProposals: number
  currency: string | null
  source: 'rollup' | 'live'
}

export type RunView = {
  id: string
  agentId: string
  status: string | null
  resultKind: string | null
  errorMessage: string | null
  input: unknown
  output: unknown
  /** storage-s3 key for the full offloaded output (F1); null when inline. */
  outputArtifactKey: string | null
  createdAt: string | null
  updatedAt: string | null
  // Trace-eval overlay fields (present on the trace list + detail reads).
  runtime: string | null
  externalRunId: string | null
  model: string | null
  confidence: number | null
  evalScore: number | null
  evalPassed: boolean | null
  latencyMs: number | null
  costMinor: number | null
  inputTokens: number | null
  outputTokens: number | null
  currency: string | null
  agentVersion: string | null
  humanConfirmedAt: string | null
  /** Forensic completion timestamp (stamped once, flag-proof); null = running or legacy-unbackfilled. */
  completedAt: string | null
  /** Operator triage flag timestamp; null = unflagged. */
  flaggedAt: string | null
  contextRouting: unknown
  /** FK id → workflows process instance (drives "Open process"). */
  processId: string | null
}

export type SpanView = {
  id: string
  externalSpanId: string | null
  parentSpanId: string | null
  sequence: number
  name: string
  kind: string
  startedAt: string | null
  endedAt: string | null
  durationMs: number | null
  status: string | null
}

export type ToolCallView = {
  id: string
  spanId: string | null
  toolName: string
  status: string | null
  latencyMs: number | null
  errorMessage: string | null
  requestSummary: unknown
  responseSummary: unknown
  /** storage-s3 keys for the full offloaded request/response (F1); null when inline. */
  requestArtifactKey: string | null
  responseArtifactKey: string | null
}

export type EvalResultView = {
  id: string
  assertionKey: string
  passed: boolean
  score: number | null
  severity: string
  evidence: unknown
}

export type ContextRoutedSourceView = {
  kind: string
  ref: string
  locator: string | null
  tokens: number | null
}

export type ContextPrunedSourceView = {
  kind: string
  ref: string
  reason: string
}

export type ContextBundleView = {
  id: string
  capability: string
  tokenBudget: number | null
  tokensUsed: number | null
  routedSources: ContextRoutedSourceView[]
  prunedSources: ContextPrunedSourceView[]
}

export type GuardrailCheckView = {
  id: string
  phase: string
  kind: string
  result: 'pass' | 'warn' | 'block'
  capability: string
  guardrailSetVersion: string | null
  evidence: unknown
}

export type RunDetailView = {
  run: RunView
  spans: SpanView[]
  toolCalls: ToolCallView[]
  evalResults: EvalResultView[]
  contextBundle: ContextBundleView | null
  guardrailChecks: GuardrailCheckView[]
  /** The run's proposals (oldest first) — carry the persisted `payload.rationale`. */
  proposals: ProposalView[]
}

export type AgentRuntime = 'in-process' | 'native' | 'opencode' | 'external'

export type AgentView = {
  id: string
  label: string
  description: string
  resultKind: 'informative' | 'actionable'
  runtime: AgentRuntime
  /** Tenant-configured presentation icon (lucide name), or null for the fallback glyph. */
  icon: AgentIconName | null
  tools: string[]
  skills: string[]
  /** Optional example input for the Playground "Insert sample" button. */
  sampleInput?: unknown
  /** Optional declared Caseload facts (from the agent's FACTS.json / defineAgent). */
  facts?: AgentFactView[]
}

export type AgentFactView = {
  label: string
  source: 'input' | 'payload' | 'output'
  path: string
  format?: 'text' | 'number' | 'boolean' | 'percent'
}

export type SkillDetailView = {
  id: string
  label: string
  description: string
  instructions: string
  tools: string[]
}

export type AgentDetailView = AgentView & {
  moduleId: string
  instructions: string
  defaultProvider: string | null
  defaultModel: string | null
  loopMaxSteps: number | null
  skillDetails: SkillDetailView[]
  subAgents: string[]
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  // Postgres bigint columns (e.g. cost_minor) serialize to JSON as strings —
  // coerce finite numeric strings so those fields are not silently dropped.
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function extractRationale(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const rationale = (payload as Record<string, unknown>).rationale
  return typeof rationale === 'string' && rationale.trim() ? rationale : null
}

function mapGuardResults(raw: unknown): GuardCheckView[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((entry): GuardCheckView | null => {
      if (!entry || typeof entry !== 'object') return null
      const check = entry as Record<string, unknown>
      const kind = asString(check.kind)
      const result = asString(check.result)
      if (!kind || !result) return null
      return { kind, result }
    })
    .filter((check): check is GuardCheckView => !!check)
}

export function mapOverviewMetrics(item: Record<string, unknown>): OverviewMetricsView | null {
  const source = item.source === 'rollup' ? 'rollup' : item.source === 'live' ? 'live' : null
  if (!source) return null
  const dispositionCounts: Record<string, number> = {}
  const countsRaw = item.dispositionCounts
  if (countsRaw && typeof countsRaw === 'object' && !Array.isArray(countsRaw)) {
    for (const [key, value] of Object.entries(countsRaw as Record<string, unknown>)) {
      const count = asNumber(value)
      if (count != null) dispositionCounts[key] = count
    }
  }
  return {
    window: asString(item.window) ?? '7d',
    autoApproveRate: asNumber(item.autoApproveRate),
    pendingCount: asNumber(item.pendingCount) ?? 0,
    oldestPendingAt: asString(item.oldestPendingAt),
    runsTotal: asNumber(item.runsTotal) ?? 0,
    dispositionCounts,
    correctionsCount: asNumber(item.correctionsCount),
    traces: mapTracesKpi(item.traces),
    source,
  }
}

function mapTracesKpi(raw: unknown): TracesKpiView | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const block = raw as Record<string, unknown>
  const source = block.source === 'rollup' ? 'rollup' : block.source === 'live' ? 'live' : null
  if (!source) return null
  return {
    p95LatencyMs: asNumber(block.p95LatencyMs),
    errorRate: asNumber(block.errorRate),
    evalPassRate: asNumber(block.evalPassRate),
    source,
  }
}

/** Defensive mapper for GET /metrics/agents items. */
export function mapAgentWindowMetrics(item: Record<string, unknown>): AgentWindowMetricsView | null {
  const agentId = asString(item.agentId)
  if (!agentId) return null
  const source = item.source === 'rollup' ? 'rollup' : item.source === 'live' ? 'live' : null
  if (!source) return null
  return {
    agentId,
    runsTotal: asNumber(item.runsTotal) ?? 0,
    errorRate: asNumber(item.errorRate),
    overrideRate: asNumber(item.overrideRate),
    evalPassRate: asNumber(item.evalPassRate),
    avgLatencyMs: asNumber(item.avgLatencyMs),
    avgCostMinor: asNumber(item.avgCostMinor),
    costMinorTotal: asNumber(item.costMinorTotal) ?? 0,
    disposedProposals: asNumber(item.disposedProposals) ?? 0,
    currency: asString(item.currency),
    source,
  }
}

export function mapProposal(item: Record<string, unknown>): ProposalView | null {
  const id = asString(item.id)
  const agentId = asString(item.agent_id) ?? asString(item.agentId)
  const runId = asString(item.run_id) ?? asString(item.runId)
  if (!id || !agentId || !runId) return null
  return {
    id,
    agentId,
    runId,
    processId: asString(item.process_id) ?? asString(item.processId),
    stepId: asString(item.step_id) ?? asString(item.stepId),
    payload: item.payload ?? null,
    confidence: asNumber(item.confidence),
    rationale: extractRationale(item.payload),
    guardResults: mapGuardResults(item.guard_results ?? item.guardResults),
    disposition: asString(item.disposition) ?? 'pending',
    dispositionBy: asString(item.disposition_by) ?? asString(item.dispositionBy),
    dispositionReason: asString(item.disposition_reason) ?? asString(item.dispositionReason),
    createdAt: asString(item.created_at) ?? asString(item.createdAt),
    updatedAt: asString(item.updated_at) ?? asString(item.updatedAt),
  }
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

export function mapRun(item: Record<string, unknown>): RunView | null {
  const id = asString(item.id)
  const agentId = asString(item.agent_id) ?? asString(item.agentId)
  if (!id || !agentId) return null
  return {
    id,
    agentId,
    status: asString(item.status),
    resultKind: asString(item.result_kind) ?? asString(item.resultKind),
    errorMessage: asString(item.error_message) ?? asString(item.errorMessage),
    input: item.input ?? null,
    output: item.output ?? null,
    outputArtifactKey: asString(item.output_artifact_key) ?? asString(item.outputArtifactKey),
    createdAt: asString(item.created_at) ?? asString(item.createdAt),
    updatedAt: asString(item.updated_at) ?? asString(item.updatedAt),
    runtime: asString(item.runtime),
    externalRunId: asString(item.external_run_id) ?? asString(item.externalRunId),
    model: asString(item.model),
    confidence: asNumber(item.confidence),
    evalScore: asNumber(item.eval_score) ?? asNumber(item.evalScore),
    evalPassed: asBoolean(item.eval_passed) ?? asBoolean(item.evalPassed),
    latencyMs: asNumber(item.latency_ms) ?? asNumber(item.latencyMs),
    costMinor: asNumber(item.cost_minor) ?? asNumber(item.costMinor),
    inputTokens: asNumber(item.input_tokens) ?? asNumber(item.inputTokens),
    outputTokens: asNumber(item.output_tokens) ?? asNumber(item.outputTokens),
    currency: asString(item.currency),
    agentVersion: asString(item.agent_version) ?? asString(item.agentVersion),
    humanConfirmedAt: asString(item.human_confirmed_at) ?? asString(item.humanConfirmedAt),
    completedAt: asString(item.completed_at) ?? asString(item.completedAt),
    flaggedAt: asString(item.flagged_at) ?? asString(item.flaggedAt),
    contextRouting: item.context_routing ?? item.contextRouting ?? null,
    processId: asString(item.process_id) ?? asString(item.processId),
  }
}

export function mapSpan(item: Record<string, unknown>): SpanView | null {
  const id = asString(item.id)
  if (!id) return null
  return {
    id,
    externalSpanId: asString(item.external_span_id) ?? asString(item.externalSpanId),
    parentSpanId: asString(item.parent_span_id) ?? asString(item.parentSpanId),
    sequence: asNumber(item.sequence) ?? 0,
    name: asString(item.name) ?? '',
    kind: asString(item.kind) ?? 'system',
    startedAt: asString(item.started_at) ?? asString(item.startedAt),
    endedAt: asString(item.ended_at) ?? asString(item.endedAt),
    durationMs: asNumber(item.duration_ms) ?? asNumber(item.durationMs),
    status: asString(item.status),
  }
}

export function mapToolCall(item: Record<string, unknown>): ToolCallView | null {
  const id = asString(item.id)
  if (!id) return null
  return {
    id,
    spanId: asString(item.span_id) ?? asString(item.spanId),
    toolName: asString(item.tool_name) ?? asString(item.toolName) ?? '',
    status: asString(item.status),
    latencyMs: asNumber(item.latency_ms) ?? asNumber(item.latencyMs),
    errorMessage: asString(item.error_message) ?? asString(item.errorMessage),
    requestSummary: item.request_summary ?? item.requestSummary ?? null,
    responseSummary: item.response_summary ?? item.responseSummary ?? null,
    requestArtifactKey: asString(item.request_artifact_key) ?? asString(item.requestArtifactKey),
    responseArtifactKey: asString(item.response_artifact_key) ?? asString(item.responseArtifactKey),
  }
}

export function mapEvalResult(item: Record<string, unknown>): EvalResultView | null {
  const id = asString(item.id)
  if (!id) return null
  return {
    id,
    assertionKey: asString(item.assertion_key) ?? asString(item.assertionKey) ?? '',
    passed: asBoolean(item.passed) ?? false,
    score: asNumber(item.score),
    severity: asString(item.severity) ?? 'warn',
    evidence: item.evidence ?? null,
  }
}

export function mapContextBundle(item: Record<string, unknown> | null | undefined): ContextBundleView | null {
  if (!item) return null
  const id = asString(item.id)
  if (!id) return null
  const routedSources = (Array.isArray(item.routed_sources ?? item.routedSources) ? (item.routed_sources ?? item.routedSources) as unknown[] : [])
    .map((row): ContextRoutedSourceView | null => {
      if (!row || typeof row !== 'object') return null
      const source = row as Record<string, unknown>
      const ref = asString(source.ref)
      if (!ref) return null
      return {
        kind: asString(source.kind) ?? 'entity',
        ref,
        locator: asString(source.locator),
        tokens: asNumber(source.tokens),
      }
    })
    .filter((row): row is ContextRoutedSourceView => !!row)
  const prunedSources = (Array.isArray(item.pruned_sources ?? item.prunedSources) ? (item.pruned_sources ?? item.prunedSources) as unknown[] : [])
    .map((row): ContextPrunedSourceView | null => {
      if (!row || typeof row !== 'object') return null
      const source = row as Record<string, unknown>
      const ref = asString(source.ref)
      if (!ref) return null
      return {
        kind: asString(source.kind) ?? 'entity',
        ref,
        reason: asString(source.reason) ?? '',
      }
    })
    .filter((row): row is ContextPrunedSourceView => !!row)
  return {
    id,
    capability: asString(item.capability) ?? '',
    tokenBudget: asNumber(item.token_budget ?? item.tokenBudget),
    tokensUsed: asNumber(item.tokens_used ?? item.tokensUsed),
    routedSources,
    prunedSources,
  }
}

export function mapGuardrailCheck(item: Record<string, unknown>): GuardrailCheckView | null {
  const id = asString(item.id)
  if (!id) return null
  const rawResult = asString(item.result)
  const result = rawResult === 'block' || rawResult === 'warn' ? rawResult : 'pass'
  return {
    id,
    phase: asString(item.phase) ?? 'output',
    kind: asString(item.kind) ?? '',
    result,
    capability: asString(item.capability) ?? '',
    guardrailSetVersion: asString(item.guardrail_set_version) ?? asString(item.guardrailSetVersion),
    evidence: item.evidence ?? null,
  }
}

export function mapRunDetail(payload: Record<string, unknown>): RunDetailView | null {
  const run = mapRun((payload.run as Record<string, unknown>) ?? {})
  if (!run) return null
  const spans = (Array.isArray(payload.spans) ? payload.spans : [])
    .map((row) => mapSpan(row as Record<string, unknown>))
    .filter((row): row is SpanView => !!row)
    .sort((left, right) => left.sequence - right.sequence)
  const toolCalls = (Array.isArray(payload.toolCalls) ? payload.toolCalls : [])
    .map((row) => mapToolCall(row as Record<string, unknown>))
    .filter((row): row is ToolCallView => !!row)
  const evalResults = (Array.isArray(payload.evalResults) ? payload.evalResults : [])
    .map((row) => mapEvalResult(row as Record<string, unknown>))
    .filter((row): row is EvalResultView => !!row)
  const contextBundle = mapContextBundle(payload.contextBundle as Record<string, unknown> | null | undefined)
  const guardrailChecks = (Array.isArray(payload.guardrailChecks) ? payload.guardrailChecks : [])
    .map((row) => mapGuardrailCheck(row as Record<string, unknown>))
    .filter((row): row is GuardrailCheckView => !!row)
  const proposals = (Array.isArray(payload.proposals) ? payload.proposals : [])
    .map((row) => mapProposal(row as Record<string, unknown>))
    .filter((row): row is ProposalView => !!row)
  return { run, spans, toolCalls, evalResults, contextBundle, guardrailChecks, proposals }
}

export function mapAgent(item: Record<string, unknown>): AgentView | null {
  const id = asString(item.id)
  if (!id) return null
  const resultKind = item.resultKind === 'actionable' ? 'actionable' : 'informative'
  const runtime: AgentRuntime =
    item.runtime === 'opencode'
      ? 'opencode'
      : item.runtime === 'external'
        ? 'external'
        : item.runtime === 'native'
          ? 'native'
          : 'in-process'
  return {
    id,
    label: asString(item.label) ?? id,
    description: asString(item.description) ?? '',
    resultKind,
    runtime,
    icon: isAgentIconName(item.icon) ? item.icon : null,
    tools: Array.isArray(item.tools) ? item.tools.filter((tool): tool is string => typeof tool === 'string') : [],
    skills: Array.isArray(item.skills) ? item.skills.filter((skill): skill is string => typeof skill === 'string') : [],
    sampleInput: item.sampleInput,
    facts: mapAgentFacts(item.facts),
  }
}

function mapAgentFacts(raw: unknown): AgentFactView[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const facts = raw
    .map((entry): AgentFactView | null => {
      if (!entry || typeof entry !== 'object') return null
      const fact = entry as Record<string, unknown>
      const label = asString(fact.label)
      const path = asString(fact.path)
      const source = asString(fact.source)
      if (!label || !path || (source !== 'input' && source !== 'payload' && source !== 'output')) return null
      const format = asString(fact.format)
      return {
        label,
        source,
        path,
        ...(format === 'text' || format === 'number' || format === 'boolean' || format === 'percent'
          ? { format }
          : {}),
      }
    })
    .filter((fact): fact is AgentFactView => !!fact)
  return facts.length > 0 ? facts : undefined
}

export function mapAgentDetail(item: Record<string, unknown>): AgentDetailView | null {
  const base = mapAgent(item)
  if (!base) return null
  const loop = item.loop && typeof item.loop === 'object' ? (item.loop as Record<string, unknown>) : null
  const skillDetailsRaw = Array.isArray(item.skillDetails) ? item.skillDetails : []
  const skillDetails = skillDetailsRaw
    .map((raw): SkillDetailView | null => {
      if (!raw || typeof raw !== 'object') return null
      const entry = raw as Record<string, unknown>
      const id = asString(entry.id)
      if (!id) return null
      return {
        id,
        label: asString(entry.label) ?? id,
        description: asString(entry.description) ?? '',
        instructions: asString(entry.instructions) ?? '',
        tools: Array.isArray(entry.tools)
          ? entry.tools.filter((tool): tool is string => typeof tool === 'string')
          : [],
      }
    })
    .filter((skill): skill is SkillDetailView => !!skill)
  return {
    ...base,
    moduleId: asString(item.moduleId) ?? '',
    instructions: asString(item.instructions) ?? '',
    defaultProvider: asString(item.defaultProvider),
    defaultModel: asString(item.defaultModel),
    loopMaxSteps: loop ? asNumber(loop.maxSteps) : null,
    skillDetails,
    subAgents: Array.isArray(item.subAgents)
      ? item.subAgents.filter((sub): sub is string => typeof sub === 'string')
      : [],
  }
}

export function formatConfidence(confidence: number | null): string | null {
  if (confidence == null) return null
  const pct = confidence <= 1 ? confidence * 100 : confidence
  return `${Math.round(pct)}%`
}

export function formatDurationMs(ms: number | null): string | null {
  if (ms == null) return null
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function formatTokens(total: number | null): string | null {
  if (total == null) return null
  if (total >= 1000) return `${(total / 1000).toFixed(1)}k`
  return String(Math.round(total))
}

export function formatCostMinor(costMinor: number | null, currency: string | null): string | null {
  if (costMinor == null) return null
  const code = currency ?? 'USD'
  return `${(costMinor / 100).toFixed(2)} ${code}`
}

/**
 * Locale-aware display formatters shared by every cockpit page.
 *
 * Policy: LIST surfaces render relative age (queues are about urgency), DETAIL
 * headers render absolute date+time (forensics); when a cell needs the other
 * form it belongs in the tooltip/title. Pages obtain the active locale once via
 * `useLocale()` and pass it down — the helpers stay pure (no hook coupling).
 *
 * `formatRelativeAge`/`formatWaitMinutes`/`formatTimeShort` are locale-neutral
 * by design: their output is digits plus single-letter duration units ("5m",
 * "3h 20m", "2d 4h") or a 24h clock label, which carry no locale content —
 * only grouping/date-order formatters take a locale parameter.
 */
export function formatNumber(value: number | null | undefined, locale: string): string | null {
  if (value == null || !Number.isFinite(value)) return null
  return new Intl.NumberFormat(locale).format(value)
}

export function formatDateTime(iso: string | null | undefined, locale: string): string | null {
  if (!iso) return null
  const parsed = Date.parse(iso)
  if (!Number.isFinite(parsed)) return null
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
}

/** Compact HH:mm label for dense timeline rows (locale-neutral 24h clock). */
export function formatTimeShort(iso: string | null | undefined): string | null {
  if (!iso) return null
  const parsed = Date.parse(iso)
  if (!Number.isFinite(parsed)) return null
  const date = new Date(parsed)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function formatRelativeAge(iso: string | null | undefined, nowMs: number = Date.now()): string | null {
  if (!iso) return null
  const parsed = Date.parse(iso)
  if (!Number.isFinite(parsed)) return null
  const minutes = Math.floor(Math.max(0, nowMs - parsed) / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  const restHours = hours % 24
  return restHours > 0 ? `${days}d ${restHours}h` : `${days}d`
}

export function formatWaitMinutes(minutes: number | null | undefined): string | null {
  if (minutes == null || !Number.isFinite(minutes)) return null
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  if (hours < 24) return restMinutes ? `${hours}h ${restMinutes}m` : `${hours}h`
  const days = Math.floor(hours / 24)
  const restHours = hours % 24
  return restHours ? `${days}d ${restHours}h` : `${days}d`
}
