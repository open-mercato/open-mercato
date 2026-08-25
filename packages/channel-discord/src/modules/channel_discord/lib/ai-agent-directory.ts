import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
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
  return (await findDiscordEligibleAgent(agentId)) !== null
}

/**
 * The eligible agent `agentId` names, or `null` when the AI peer is absent or the
 * agent is not one auto-reply may be pointed at.
 *
 * Prefer this over {@link isDiscordEligibleAgentId} when the caller also needs the
 * agent's `requiredFeatures` — it answers both questions from a single registry
 * load instead of two.
 */
export async function findDiscordEligibleAgent(agentId: string): Promise<DiscordEligibleAgent | null> {
  const directory = await listDiscordEligibleAgents()
  if (!directory.available) return null
  return directory.agents.find((agent) => agent.id === agentId) ?? null
}

/** The identity half of the invocability question — see {@link missingAgentFeatures}. */
export type AgentInvokingPrincipal = {
  features: string[]
  isSuperAdmin: boolean
}

/**
 * The subset of an agent's `requiredFeatures` the principal does NOT hold.
 *
 * This is the second half of "can auto-reply actually invoke this agent", and it
 * is the half the settings surface used to skip. `listDiscordEligibleAgents`
 * answers the *shape* question (object-mode, so `runAiAgentObject` will take it);
 * this answers the *authorization* question the runtime asks next, when
 * `checkAgentPolicy` runs the agent's `requiredFeatures` against the principal
 * from `lib/ai-service-principal.ts`. An agent that clears the first and fails the
 * second stores a setting that can only fail later, inside a background
 * subscriber — the failure mode issue #4778 was filed for.
 *
 * The check delegates to the platform's own `authorizeFeatures`, one feature at a
 * time so the caller can name what is missing. Going through the shared helper —
 * rather than a `Set.has` — is what makes wildcard grants (`customers.*`, `*`),
 * removed features and disabled modules resolve exactly the way the runtime will
 * resolve them; a hand-rolled comparison would reject a bot user whose role
 * carries a wildcard and the operator would have no way to tell why.
 */
export function missingAgentFeatures(
  requiredFeatures: readonly string[] | undefined,
  principal: AgentInvokingPrincipal,
): string[] {
  if (!requiredFeatures?.length) return []
  return requiredFeatures.filter((featureId) => !authorizeFeatures([featureId], {
    grantedFeatures: principal.features,
    unrestricted: principal.isSuperAdmin,
  }))
}
