import { getAgent } from './agent-registry'
import { hasRequiredFeatures } from './auth'
import { toolRegistry } from './tool-registry'
import type {
  AiAgentAcceptedMediaType,
  AiAgentDefinition,
  AiAgentMutationPolicy,
} from './ai-agent-definition'
import type { AiToolDefinition } from './types'

export type AgentPolicyDenyCode =
  | 'agent_unknown'
  | 'agent_features_denied'
  | 'tool_not_whitelisted'
  | 'tool_unknown'
  | 'tool_features_denied'
  | 'mutation_blocked_by_readonly'
  | 'mutation_blocked_by_policy'
  | 'execution_mode_not_supported'
  | 'attachment_type_not_accepted'

export type AgentPolicyDecision =
  | { ok: true; agent: AiAgentDefinition; tool?: AiToolDefinition }
  | { ok: false; code: AgentPolicyDenyCode; message: string }

export interface AgentPolicyAuthContext {
  userFeatures: string[]
  isSuperAdmin: boolean
}

export interface AgentPolicyCheckInput {
  agentId: string
  authContext: AgentPolicyAuthContext
  toolName?: string
  attachmentMediaTypes?: string[]
  requestedExecutionMode?: 'chat' | 'object'
  /**
   * Optional tenant-scoped downgrade for the agent's code-declared
   * `mutationPolicy`. When supplied, the effective policy is the MOST
   * RESTRICTIVE of `{ code-declared, override }` — escalation is never
   * allowed through this channel (that is enforced at the route layer).
   * Callers that omit this field get the exact pre-Step-5.4 behavior.
   */
  mutationPolicyOverride?: AiAgentMutationPolicy | null
}

/**
 * Restrictiveness ranking of `AiAgentMutationPolicy` (most restrictive first).
 * `read-only` blocks all mutation tools. `destructive-confirm-required` forces
 * confirmation for every write (including non-destructive ones). `confirm-required`
 * is the least restrictive policy — writes go through a single confirmation.
 *
 * This ordering is load-bearing for both the runtime's effective-policy
 * computation AND the route-layer escalation guard. Changing the order is a
 * security-sensitive change.
 */
const POLICY_RESTRICTIVENESS: Record<AiAgentMutationPolicy, number> = {
  'read-only': 0,
  'destructive-confirm-required': 1,
  'confirm-required': 2,
}

export function isKnownMutationPolicy(value: unknown): value is AiAgentMutationPolicy {
  return (
    value === 'read-only' ||
    value === 'confirm-required' ||
    value === 'destructive-confirm-required'
  )
}

/**
 * Returns the effective mutation policy — the MOST RESTRICTIVE of
 * `{ codeDeclared, override }`. Missing override → `codeDeclared`. A corrupt
 * override value (unknown string from DB) is logged and falls back to
 * `codeDeclared` so the system fails SAFE when a schema drift leaks through.
 */
export function resolveEffectiveMutationPolicy(
  codeDeclared: AiAgentMutationPolicy | undefined,
  override: AiAgentMutationPolicy | null | undefined,
  agentId?: string,
): AiAgentMutationPolicy {
  const base: AiAgentMutationPolicy =
    codeDeclared && isKnownMutationPolicy(codeDeclared) ? codeDeclared : 'read-only'
  if (override === undefined || override === null) return base
  if (!isKnownMutationPolicy(override)) {
    console.warn(
      `[AI Agents] Ignoring corrupt mutationPolicy override for agent "${agentId ?? '<unknown>'}": ${String(
        override,
      )}. Falling back to code-declared policy "${base}".`,
    )
    return base
  }
  const baseRank = POLICY_RESTRICTIVENESS[base]
  const overrideRank = POLICY_RESTRICTIVENESS[override]
  return overrideRank < baseRank ? override : base
}

/**
 * Returns `true` when `candidate` would WIDEN `codeDeclared` — i.e. would
 * grant the agent more mutation surface than its code declares. Used by the
 * mutation-policy override route to reject escalation attempts with 400.
 */
export function isMutationPolicyEscalation(
  codeDeclared: AiAgentMutationPolicy | undefined,
  candidate: AiAgentMutationPolicy,
): boolean {
  const base: AiAgentMutationPolicy =
    codeDeclared && isKnownMutationPolicy(codeDeclared) ? codeDeclared : 'read-only'
  return POLICY_RESTRICTIVENESS[candidate] > POLICY_RESTRICTIVENESS[base]
}

function classifyMediaType(value: string): AiAgentAcceptedMediaType {
  const normalized = value.trim().toLowerCase()
  if (normalized.startsWith('image/')) return 'image'
  if (normalized === 'application/pdf') return 'pdf'
  return 'file'
}

function isAgentReadOnly(agent: AiAgentDefinition): boolean {
  if (typeof agent.readOnly === 'boolean') return agent.readOnly
  return true
}

/**
 * Returns the effective mutation policy for a policy-check invocation — the
 * most restrictive of `{ agent.mutationPolicy, input.mutationPolicyOverride }`.
 * Pure-lookup helper; no I/O. Callers that need to know the same value outside
 * of a policy check should use {@link resolveEffectiveMutationPolicy} directly.
 */
function resolvePolicyCheckMutationPolicy(
  agent: AiAgentDefinition,
  override: AiAgentMutationPolicy | null | undefined,
): AiAgentMutationPolicy {
  return resolveEffectiveMutationPolicy(agent.mutationPolicy, override, agent.id)
}

function hasAgentStructuredOutput(agent: AiAgentDefinition): boolean {
  return Boolean(agent.output)
}

function agentExecutionMode(agent: AiAgentDefinition): 'chat' | 'object' {
  return agent.executionMode ?? 'chat'
}

export function checkAgentPolicy(input: AgentPolicyCheckInput): AgentPolicyDecision {
  const {
    agentId,
    authContext,
    toolName,
    attachmentMediaTypes,
    requestedExecutionMode,
    mutationPolicyOverride,
  } = input

  const agent = getAgent(agentId)
  if (!agent) {
    return {
      ok: false,
      code: 'agent_unknown',
      message: `Agent "${agentId}" is not registered.`,
    }
  }

  const agentFeatures = agent.requiredFeatures ?? []
  if (
    !hasRequiredFeatures(agentFeatures, authContext.userFeatures, authContext.isSuperAdmin)
  ) {
    return {
      ok: false,
      code: 'agent_features_denied',
      message: `Access to agent "${agentId}" requires features: ${agentFeatures.join(', ')}`,
    }
  }

  let resolvedTool: AiToolDefinition | undefined
  if (typeof toolName === 'string') {
    if (!agent.allowedTools.includes(toolName)) {
      return {
        ok: false,
        code: 'tool_not_whitelisted',
        message: `Tool "${toolName}" is not whitelisted for agent "${agentId}".`,
      }
    }

    const toolRecord = toolRegistry.getTool(toolName) as AiToolDefinition | undefined
    if (!toolRecord) {
      return {
        ok: false,
        code: 'tool_unknown',
        message: `Tool "${toolName}" is not registered in the tool registry.`,
      }
    }

    const toolFeatures = toolRecord.requiredFeatures ?? []
    if (
      !hasRequiredFeatures(toolFeatures, authContext.userFeatures, authContext.isSuperAdmin)
    ) {
      return {
        ok: false,
        code: 'tool_features_denied',
        message: `Access to tool "${toolName}" requires features: ${toolFeatures.join(', ')}`,
      }
    }

    if (toolRecord.isMutation === true) {
      if (isAgentReadOnly(agent)) {
        return {
          ok: false,
          code: 'mutation_blocked_by_readonly',
          message: `Mutation tool "${toolName}" cannot be executed by read-only agent "${agentId}".`,
        }
      }
      const effectivePolicy = resolvePolicyCheckMutationPolicy(agent, mutationPolicyOverride)
      if (effectivePolicy === 'read-only') {
        return {
          ok: false,
          code: 'mutation_blocked_by_policy',
          message: `Mutation tool "${toolName}" is blocked by agent "${agentId}" mutationPolicy=read-only.`,
        }
      }
    }

    resolvedTool = toolRecord
  }

  if (requestedExecutionMode) {
    const declaredMode = agentExecutionMode(agent)
    if (requestedExecutionMode === 'object') {
      if (declaredMode !== 'object' && !hasAgentStructuredOutput(agent)) {
        return {
          ok: false,
          code: 'execution_mode_not_supported',
          message: `Agent "${agentId}" does not support execution mode "object" (no output schema declared).`,
        }
      }
    } else if (requestedExecutionMode === 'chat') {
      if (declaredMode === 'object' && hasAgentStructuredOutput(agent)) {
        return {
          ok: false,
          code: 'execution_mode_not_supported',
          message: `Agent "${agentId}" is declared as object-mode and cannot run via chat transport.`,
        }
      }
    }
  }

  if (Array.isArray(attachmentMediaTypes) && attachmentMediaTypes.length > 0) {
    const accepted = agent.acceptedMediaTypes
    if (!accepted || accepted.length === 0) {
      return {
        ok: false,
        code: 'attachment_type_not_accepted',
        message: `Agent "${agentId}" does not accept attachments.`,
      }
    }
    const acceptedSet = new Set<AiAgentAcceptedMediaType>(accepted)
    for (const raw of attachmentMediaTypes) {
      const kind = classifyMediaType(raw)
      if (!acceptedSet.has(kind)) {
        return {
          ok: false,
          code: 'attachment_type_not_accepted',
          message: `Agent "${agentId}" does not accept media type "${raw}" (classified as "${kind}").`,
        }
      }
    }
  }

  return { ok: true, agent, tool: resolvedTool }
}
