import type { AiAgentMutationPolicy } from './ai-agent-definition'
import { isMutationPolicyEscalation, resolveEffectiveMutationPolicy } from './agent-policy'
import type { McpMutationMode } from './mcp-exposure'
import type { AiPendingActionChannel } from './pending-action-types'

export interface ResolveAgentMutationPolicyForChannelInput {
  channel: AiPendingActionChannel
  mutationMode: McpMutationMode
  declaredPolicy: AiAgentMutationPolicy | undefined
}

/**
 * Spec `2026-10-21-mcp-tool-exposure-parity-and-audit` §3 "Mutation rule":
 * an agent run on behalf of an MCP / tools-api caller is downgraded to
 * `read-only` unless the server runs in `approval` mode, where the agent keeps
 * its own effective policy and its writes are queued through `prepareMutation`.
 * Returns `null` when no override applies. The result can only ever DOWNGRADE
 * the declared policy.
 */
export function resolveAgentMutationPolicyForChannel(
  input: ResolveAgentMutationPolicyForChannelInput,
): AiAgentMutationPolicy | null {
  if (input.channel === 'agent') return null
  if (input.mutationMode === 'approval') return null
  const downgrade: AiAgentMutationPolicy = 'read-only'
  if (isMutationPolicyEscalation(input.declaredPolicy, downgrade)) return null
  return downgrade
}

/**
 * Combines two optional mutation-policy downgrades into the most restrictive
 * one. `null` on both sides means no override.
 */
export function mergeMutationPolicyOverrides(
  first: AiAgentMutationPolicy | null | undefined,
  second: AiAgentMutationPolicy | null | undefined,
): AiAgentMutationPolicy | null {
  if (!first) return second ?? null
  if (!second) return first
  return resolveEffectiveMutationPolicy(first, second)
}

export interface ResolveAgentRunMutationPolicyOverrideInput {
  channel: AiPendingActionChannel | undefined
  mutationMode: McpMutationMode | undefined
  declaredPolicy: AiAgentMutationPolicy | undefined
  tenantOverride: AiAgentMutationPolicy | null | undefined
  canQueueMutations: boolean
}

/**
 * Effective mutation-policy override for one agent run: the tenant override
 * merged with the channel rule. A non-`agent` channel that cannot queue
 * pending actions (no DI container) is forced to `read-only` so its writes
 * can never run unapproved. Defaults reproduce the plain tenant override.
 */
export function resolveAgentRunMutationPolicyOverride(
  input: ResolveAgentRunMutationPolicyOverrideInput,
): AiAgentMutationPolicy | null {
  const channel = input.channel ?? 'agent'
  const channelOverride =
    channel !== 'agent' && !input.canQueueMutations
      ? 'read-only'
      : resolveAgentMutationPolicyForChannel({
          channel,
          mutationMode: input.mutationMode ?? 'direct',
          declaredPolicy: input.declaredPolicy,
        })
  return mergeMutationPolicyOverrides(input.tenantOverride, channelOverride)
}
