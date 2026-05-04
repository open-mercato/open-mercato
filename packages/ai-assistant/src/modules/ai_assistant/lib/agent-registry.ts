import type { AiAgentDefinition } from './ai-agent-definition'
import {
  applyAgentOverrideMap,
  composeAgentOverrideMap,
  type AiAgentOverrideConfigEntry,
} from './ai-overrides'

const agentsById = new Map<string, AiAgentDefinition>()
let loaded = false

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isAiAgentDefinition(value: unknown): value is AiAgentDefinition {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.moduleId === 'string' &&
    typeof candidate.label === 'string' &&
    typeof candidate.description === 'string' &&
    typeof candidate.systemPrompt === 'string' &&
    isStringArray(candidate.allowedTools)
  )
}

function populateFromAgents(agents: unknown[]): void {
  for (const candidate of agents) {
    if (!isAiAgentDefinition(candidate)) {
      console.warn('[AI Agents] Skipping malformed agent entry in ai-agents.generated.ts')
      continue
    }
    const existing = agentsById.get(candidate.id)
    if (existing) {
      throw new Error(
        `[AI Agents] Duplicate agent id "${candidate.id}" — already registered by module "${existing.moduleId}", conflicts with module "${candidate.moduleId}". Export \`aiAgentOverrides\` from your module's \`ai-agents.ts\` (or set it on the modules.ts entry) to replace an agent across modules.`
      )
    }
    agentsById.set(candidate.id, candidate)
  }
}

async function loadOverrideEntries(): Promise<AiAgentOverrideConfigEntry[]> {
  try {
    const mod = (await import(
      '@/.mercato/generated/ai-agents.generated'
    )) as { aiAgentOverrideEntries?: unknown[] }
    return Array.isArray(mod.aiAgentOverrideEntries)
      ? (mod.aiAgentOverrideEntries as AiAgentOverrideConfigEntry[])
      : []
  } catch {
    // No generated file yet — pre-generate builds and tests fall through.
    return []
  }
}

function applyOverridesToRegistry(entries: readonly AiAgentOverrideConfigEntry[]): void {
  const overrideMap = composeAgentOverrideMap(entries)
  if (Object.keys(overrideMap).length === 0) return
  const overridden = applyAgentOverrideMap(Array.from(agentsById.values()), overrideMap)
  agentsById.clear()
  for (const agent of overridden) agentsById.set(agent.id, agent)
  for (const [id, value] of Object.entries(overrideMap)) {
    const verb = value === null ? 'disabled' : 'replaced'
    console.info(`[AI Overrides] Agent "${id}" ${verb} by override.`)
  }
}

export async function loadAgentRegistry(): Promise<void> {
  if (loaded) return
  try {
    const mod = (await import(
      '@/.mercato/generated/ai-agents.generated'
    )) as { allAiAgents?: unknown[] }
    const agents = Array.isArray(mod.allAiAgents) ? mod.allAiAgents : []
    populateFromAgents(agents)
  } catch (error) {
    console.error(
      '[AI Agents] Could not load ai-agents.generated.ts (agent registry empty):',
      error
    )
  } finally {
    try {
      const overrideEntries = await loadOverrideEntries()
      applyOverridesToRegistry(overrideEntries)
    } catch (error) {
      console.error('[AI Overrides] Failed to apply agent overrides:', error)
    }
    loaded = true
  }
}

export function getAgent(id: string): AiAgentDefinition | undefined {
  return agentsById.get(id)
}

export function listAgents(): AiAgentDefinition[] {
  return Array.from(agentsById.values()).sort((a, b) => a.id.localeCompare(b.id))
}

export function listAgentsByModule(moduleId: string): AiAgentDefinition[] {
  return listAgents().filter((agent) => agent.moduleId === moduleId)
}

/**
 * @__internal
 * Test-only hook — clears the cached registry so `loadAgentRegistry` re-evaluates its source.
 */
export function resetAgentRegistryForTests(): void {
  agentsById.clear()
  loaded = false
}

/**
 * @__internal
 * Test-only hook — seeds the registry directly from a fixture array without going through
 * the dynamic generated-file import. Used by the registry's own unit tests.
 */
export function seedAgentRegistryForTests(agents: unknown[]): void {
  agentsById.clear()
  populateFromAgents(agents)
  loaded = true
}

/**
 * @__internal
 * Test-only hook — apply override entries against the seeded registry to
 * exercise the override pipeline without round-tripping through the
 * generated file.
 */
export function applyAgentOverrideEntriesForTests(
  entries: readonly AiAgentOverrideConfigEntry[],
): void {
  applyOverridesToRegistry(entries)
}
