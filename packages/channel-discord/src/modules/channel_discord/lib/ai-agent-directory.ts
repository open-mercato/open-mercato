import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('channel_discord').child({ component: 'ai-agent-directory' })

/** The subset of an agent definition the settings surface needs to describe a choice. */
export type DiscordEligibleAgent = {
  id: string
  label: string
  description: string
  requiredFeatures: string[]
}

export type DiscordAgentDirectory =
  | { available: false }
  | { available: true; agents: DiscordEligibleAgent[] }

type AgentRegistryModule = {
  loadAgentRegistry: () => Promise<unknown>
  listAgents: () => Array<{
    id: string
    label?: string
    description?: string
    executionMode?: 'chat' | 'object'
    output?: unknown
    requiredFeatures?: string[]
  }>
}

/**
 * List the agents a Discord channel may legitimately be pointed at.
 *
 * "Eligible" means the AI runtime would accept the call the subscriber makes:
 * `runAiAgentObject` requests execution mode `object`, and `checkAgentPolicy`
 * rejects an agent that is neither declared object-mode nor carrying an output
 * schema (`execution_mode_not_supported`). Offering a chat-mode agent in the
 * picker would therefore be offering a setting that can only ever fail at
 * runtime — the exact failure mode this feature was filed to remove.
 *
 * The import is dynamic and failure-tolerant because `@open-mercato/ai-assistant`
 * is an optional peer: a deployment without it gets `{ available: false }`, and
 * the settings surface then explains why auto-reply cannot be enabled instead of
 * rendering an empty dropdown.
 */
export async function listDiscordEligibleAgents(): Promise<DiscordAgentDirectory> {
  let mod: AgentRegistryModule
  try {
    mod = (await import('@open-mercato/ai-assistant')) as unknown as AgentRegistryModule
  } catch {
    return { available: false }
  }
  if (typeof mod.loadAgentRegistry !== 'function' || typeof mod.listAgents !== 'function') {
    return { available: false }
  }

  try {
    await mod.loadAgentRegistry()
  } catch (err) {
    logger.warn('Failed to load the AI agent registry', { err })
    return { available: false }
  }

  const agents = mod
    .listAgents()
    .filter((agent) => agent.executionMode === 'object' || Boolean(agent.output))
    .map((agent) => ({
      id: agent.id,
      label: agent.label ?? agent.id,
      description: agent.description ?? '',
      requiredFeatures: agent.requiredFeatures ?? [],
    }))

  return { available: true, agents }
}

/** Whether `agentId` is one the subscriber could actually invoke. */
export async function isDiscordEligibleAgentId(agentId: string): Promise<boolean> {
  const directory = await listDiscordEligibleAgents()
  if (!directory.available) return false
  return directory.agents.some((agent) => agent.id === agentId)
}
