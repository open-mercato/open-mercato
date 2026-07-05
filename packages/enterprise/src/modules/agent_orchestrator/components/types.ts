/**
 * Client-side view types for the cockpit UI. These mirror the snake_case
 * shapes returned by the area-01/03 list APIs, normalized to camelCase for the
 * React layer. No new entities — these are pure read projections.
 */

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

export type RunView = {
  id: string
  agentId: string
  status: string | null
  resultKind: string | null
  errorMessage: string | null
  input: unknown
  output: unknown
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
}

export type EvalResultView = {
  id: string
  assertionKey: string
  passed: boolean
  score: number | null
  severity: string
  evidence: unknown
}

export type RunDetailView = {
  run: RunView
  spans: SpanView[]
  toolCalls: ToolCallView[]
  evalResults: EvalResultView[]
}

export type AgentRuntime = 'in-process' | 'opencode' | 'external'

export type AgentView = {
  id: string
  label: string
  description: string
  resultKind: 'informative' | 'actionable'
  runtime: AgentRuntime
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
  return { run, spans, toolCalls, evalResults }
}

export function mapAgent(item: Record<string, unknown>): AgentView | null {
  const id = asString(item.id)
  if (!id) return null
  const resultKind = item.resultKind === 'actionable' ? 'actionable' : 'informative'
  const runtime: AgentRuntime =
    item.runtime === 'opencode' ? 'opencode' : item.runtime === 'external' ? 'external' : 'in-process'
  return {
    id,
    label: asString(item.label) ?? id,
    description: asString(item.description) ?? '',
    resultKind,
    runtime,
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
