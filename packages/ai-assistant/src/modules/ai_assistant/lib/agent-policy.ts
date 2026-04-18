import { getAgent } from './agent-registry'
import { hasRequiredFeatures } from './auth'
import { toolRegistry } from './tool-registry'
import type { AiAgentAcceptedMediaType, AiAgentDefinition } from './ai-agent-definition'
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

function hasAgentStructuredOutput(agent: AiAgentDefinition): boolean {
  return Boolean(agent.output)
}

function agentExecutionMode(agent: AiAgentDefinition): 'chat' | 'object' {
  return agent.executionMode ?? 'chat'
}

export function checkAgentPolicy(input: AgentPolicyCheckInput): AgentPolicyDecision {
  const { agentId, authContext, toolName, attachmentMediaTypes, requestedExecutionMode } = input

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
      if (agent.mutationPolicy === 'read-only') {
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
