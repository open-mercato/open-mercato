/**
 * Authoring-time feedback for INVOKE_AGENT steps run under a definition grant.
 *
 * A definition that declares `grantedFeatures` always runs as its own execution
 * principal, whose role ACL is exactly that grant. When an INVOKE_AGENT step
 * targets an agent whose `requiredFeatures` the grant does not cover, the run is
 * denied at invoke time. Saving or publishing such a definition returns a
 * WARNING (never a block): the author may still widen the grant later, and the
 * runtime check stays the authority.
 *
 * The agent requirements come from the OPTIONAL agent_orchestrator peer through
 * its `agentWorkflowBridge.listAgentAccessRequirements?()` (duck-typed, never
 * imported). An absent peer, an older bridge without the method, a failing
 * lookup, or a definition without a grant all yield no warnings — without a
 * grant the acting identity is whoever starts the run, unknown at authoring time.
 * Warnings carry the step and agent ids only, never feature names.
 */

import { hasAllFeatures } from '@open-mercato/shared/security/features'
import { normalizeGrantedFeatures } from './definition-grant'

export const AGENT_INVOKE_NOT_COVERED_WARNING = 'agent_invoke_not_covered' as const

export type AgentInvokeGrantWarning = {
  code: typeof AGENT_INVOKE_NOT_COVERED_WARNING
  stepId: string
  agentId: string
}

export type AgentAccessRequirement = {
  agentId: string
  requiredFeatures: string[]
}

type AgentAccessBridgeLike = {
  listAgentAccessRequirements?: () =>
    | Promise<Array<{ agentId?: unknown; requiredFeatures?: unknown }>>
    | Array<{ agentId?: unknown; requiredFeatures?: unknown }>
}

type ServiceContainer = {
  resolve: <T>(name: string) => T
}

type InvokeAgentReference = {
  stepId: string
  agentId: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function collectFromActivities(ownerId: string, activities: unknown, into: InvokeAgentReference[]): void {
  if (!Array.isArray(activities)) return
  for (const activity of activities) {
    if (!isRecord(activity) || activity.activityType !== 'INVOKE_AGENT') continue
    const config = isRecord(activity.config) ? activity.config : null
    const agentId = typeof config?.agentId === 'string' ? config.agentId.trim() : ''
    if (!agentId) continue
    into.push({ stepId: ownerId, agentId })
  }
}

export function collectInvokeAgentReferences(definition: unknown): InvokeAgentReference[] {
  const references: InvokeAgentReference[] = []
  if (!isRecord(definition)) return references
  if (Array.isArray(definition.steps)) {
    for (const step of definition.steps) {
      if (!isRecord(step) || typeof step.stepId !== 'string') continue
      collectFromActivities(step.stepId, step.activities, references)
    }
  }
  if (Array.isArray(definition.transitions)) {
    for (const transition of definition.transitions) {
      if (!isRecord(transition) || typeof transition.transitionId !== 'string') continue
      collectFromActivities(transition.transitionId, transition.activities, references)
    }
  }
  return references
}

export function findAgentInvokeGrantWarnings(
  definition: unknown,
  grantedFeatures: string[] | null | undefined,
  requirements: AgentAccessRequirement[],
): AgentInvokeGrantWarning[] {
  const grant = normalizeGrantedFeatures(grantedFeatures)
  if (!grant.length) return []
  const requiredByAgent = new Map(requirements.map((requirement) => [requirement.agentId, requirement.requiredFeatures]))
  const warnings: AgentInvokeGrantWarning[] = []
  for (const reference of collectInvokeAgentReferences(definition)) {
    const required = requiredByAgent.get(reference.agentId)
    if (!required || required.length === 0) continue
    if (hasAllFeatures(grant, required)) continue
    warnings.push({ code: AGENT_INVOKE_NOT_COVERED_WARNING, stepId: reference.stepId, agentId: reference.agentId })
  }
  return warnings
}

async function loadAgentAccessRequirements(container: ServiceContainer): Promise<AgentAccessRequirement[]> {
  let bridge: AgentAccessBridgeLike | undefined
  try {
    bridge = container.resolve<AgentAccessBridgeLike>('agentWorkflowBridge')
  } catch {
    return []
  }
  if (!bridge || typeof bridge.listAgentAccessRequirements !== 'function') return []
  try {
    const snapshots = await bridge.listAgentAccessRequirements()
    if (!Array.isArray(snapshots)) return []
    const requirements: AgentAccessRequirement[] = []
    for (const snapshot of snapshots) {
      if (typeof snapshot?.agentId !== 'string' || snapshot.agentId.length === 0) continue
      requirements.push({
        agentId: snapshot.agentId,
        requiredFeatures: normalizeGrantedFeatures(snapshot.requiredFeatures),
      })
    }
    return requirements
  } catch {
    return []
  }
}

export async function collectAgentInvokeGrantWarnings(
  container: ServiceContainer,
  params: { definition: unknown; grantedFeatures: string[] | null | undefined },
): Promise<AgentInvokeGrantWarning[]> {
  if (!normalizeGrantedFeatures(params.grantedFeatures).length) return []
  if (!collectInvokeAgentReferences(params.definition).length) return []
  const requirements = await loadAgentAccessRequirements(container)
  if (!requirements.length) return []
  return findAgentInvokeGrantWarnings(params.definition, params.grantedFeatures, requirements)
}
