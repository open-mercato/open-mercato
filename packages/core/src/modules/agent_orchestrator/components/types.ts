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
  disposition: string
  dispositionBy: string | null
  dispositionReason: string | null
  createdAt: string | null
  updatedAt: string | null
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
}

export type AgentView = {
  id: string
  label: string
  description: string
  resultKind: 'informative' | 'actionable'
  tools: string[]
  skills: string[]
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
  return typeof value === 'number' && Number.isFinite(value) ? value : null
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
    disposition: asString(item.disposition) ?? 'pending',
    dispositionBy: asString(item.disposition_by) ?? asString(item.dispositionBy),
    dispositionReason: asString(item.disposition_reason) ?? asString(item.dispositionReason),
    createdAt: asString(item.created_at) ?? asString(item.createdAt),
    updatedAt: asString(item.updated_at) ?? asString(item.updatedAt),
  }
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
  }
}

export function mapAgent(item: Record<string, unknown>): AgentView | null {
  const id = asString(item.id)
  if (!id) return null
  const resultKind = item.resultKind === 'actionable' ? 'actionable' : 'informative'
  return {
    id,
    label: asString(item.label) ?? id,
    description: asString(item.description) ?? '',
    resultKind,
    tools: Array.isArray(item.tools) ? item.tools.filter((tool): tool is string => typeof tool === 'string') : [],
    skills: Array.isArray(item.skills) ? item.skills.filter((skill): skill is string => typeof skill === 'string') : [],
  }
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
