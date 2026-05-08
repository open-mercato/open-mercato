import { llmProviderRegistry } from '@open-mercato/shared/lib/ai/llm-provider-registry'
import type { AiAgentDefinition, AiAgentExtension, AiAgentSuggestion } from './ai-agent-definition'
import {
  applyAgentOverrideMap,
  composeAgentExtensionEntries,
  composeAgentOverrideMap,
  type AiAgentExtensionConfigEntry,
  type AiAgentOverrideConfigEntry,
} from './ai-overrides'

const agentsById = new Map<string, AiAgentDefinition>()
let loaded = false

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isAiAgentSuggestion(value: unknown): value is AiAgentSuggestion {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.label === 'string' && typeof candidate.prompt === 'string'
}

function isAiAgentExtension(value: unknown): value is AiAgentExtension {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.targetAgentId === 'string' &&
    (!('replaceAllowedTools' in candidate) || isStringArray(candidate.replaceAllowedTools)) &&
    (!('deleteAllowedTools' in candidate) || isStringArray(candidate.deleteAllowedTools)) &&
    (!('appendAllowedTools' in candidate) || isStringArray(candidate.appendAllowedTools)) &&
    (!('replaceSystemPrompt' in candidate) || typeof candidate.replaceSystemPrompt === 'string') &&
    (!('appendSystemPrompt' in candidate) || typeof candidate.appendSystemPrompt === 'string') &&
    (!('replaceSuggestions' in candidate) ||
      (Array.isArray(candidate.replaceSuggestions) && candidate.replaceSuggestions.every(isAiAgentSuggestion))) &&
    (!('deleteSuggestions' in candidate) || isStringArray(candidate.deleteSuggestions)) &&
    (!('appendSuggestions' in candidate) ||
      (Array.isArray(candidate.appendSuggestions) && candidate.appendSuggestions.every(isAiAgentSuggestion))) &&
    (!('suggestions' in candidate) ||
      (Array.isArray(candidate.suggestions) && candidate.suggestions.every(isAiAgentSuggestion)))
  )
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

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter((value) => typeof value === 'string' && value.length > 0)))
}

function applyStringListPatch(
  current: readonly string[],
  patch: {
    replace?: readonly string[]
    delete?: readonly string[]
    append?: readonly string[]
  },
): string[] {
  const deleted = new Set(patch.delete ?? [])
  return uniqueStrings([
    ...(patch.replace ?? current).filter((value) => !deleted.has(value)),
    ...(patch.append ?? []),
  ])
}

function suggestionDeleteKey(suggestion: AiAgentSuggestion): string[] {
  return [suggestion.label, suggestion.prompt].filter((value) => value.length > 0)
}

function applySuggestionPatch(
  current: readonly AiAgentSuggestion[],
  patch: {
    replace?: readonly AiAgentSuggestion[]
    delete?: readonly string[]
    append?: readonly AiAgentSuggestion[]
  },
): AiAgentSuggestion[] {
  const deleted = new Set(patch.delete ?? [])
  const base = patch.replace ?? current
  const out: AiAgentSuggestion[] = []
  const seen = new Set<string>()
  for (const suggestion of base) {
    if (suggestionDeleteKey(suggestion).some((key) => deleted.has(key))) continue
    const key = `${suggestion.label}\n${suggestion.prompt}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(suggestion)
  }
  for (const suggestion of patch.append ?? []) {
    const key = `${suggestion.label}\n${suggestion.prompt}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(suggestion)
  }
  return out
}

function validateAndNormalizeAgent(candidate: AiAgentDefinition): AiAgentDefinition {
  const rawProvider = (candidate as Record<string, unknown>).defaultProvider
  if (typeof rawProvider !== 'string' || rawProvider.trim().length === 0) {
    return candidate
  }
  const providerHint = rawProvider.trim()
  const registered = llmProviderRegistry.get(providerHint)
  if (!registered) {
    console.warn(
      `[AI Agents] Agent "${candidate.id}" declares defaultProvider "${providerHint}" which is not registered in llmProviderRegistry. ` +
        `The agent will be registered with defaultProvider: undefined so the resolution chain still works. ` +
        `Built-in provider ids: anthropic, google, openai, deepinfra, groq, together, fireworks, azure, litellm, ollama.`,
    )
    return { ...candidate, defaultProvider: undefined }
  }
  return candidate
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
    agentsById.set(candidate.id, validateAndNormalizeAgent(candidate))
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

async function loadExtensionEntries(): Promise<AiAgentExtension[]> {
  try {
    const mod = (await import(
      '@/.mercato/generated/ai-agents.generated'
    )) as { aiAgentExtensionEntries?: unknown[] }
    const entries = Array.isArray(mod.aiAgentExtensionEntries)
      ? (mod.aiAgentExtensionEntries as AiAgentExtensionConfigEntry[])
      : []
    return composeAgentExtensionEntries(entries).filter(isAiAgentExtension)
  } catch {
    return []
  }
}

function applyExtensionsToRegistry(extensions: readonly AiAgentExtension[]): void {
  if (extensions.length === 0) return
  for (const extension of extensions) {
    const agent = agentsById.get(extension.targetAgentId)
    if (!agent) {
      console.warn(
        `[AI Agents] Skipping extension for unknown agent "${extension.targetAgentId}".`,
      )
      continue
    }

    const replacementSystemPrompt = extension.replaceSystemPrompt?.trim()
    const appendSystemPrompt = extension.appendSystemPrompt?.trim()
    const systemPrompt = replacementSystemPrompt ?? agent.systemPrompt.trim()
    agentsById.set(agent.id, {
      ...agent,
      allowedTools: applyStringListPatch(agent.allowedTools, {
        replace: extension.replaceAllowedTools,
        delete: extension.deleteAllowedTools,
        append: extension.appendAllowedTools,
      }),
      systemPrompt: appendSystemPrompt
        ? `${systemPrompt}\n\n${appendSystemPrompt}`
        : systemPrompt,
      suggestions: applySuggestionPatch(agent.suggestions ?? [], {
        replace: extension.replaceSuggestions,
        delete: extension.deleteSuggestions,
        append: [
          ...(extension.appendSuggestions ?? []),
          ...(extension.suggestions ?? []),
        ],
      }),
    })
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
      const extensionEntries = await loadExtensionEntries()
      applyExtensionsToRegistry(extensionEntries)
    } catch (error) {
      console.error('[AI Agents] Failed to apply agent overrides/extensions:', error)
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

/**
 * @__internal Test-only hook — apply additive extension entries against the
 * seeded registry without round-tripping through the generated file.
 */
export function applyAgentExtensionEntriesForTests(
  entries: readonly AiAgentExtension[],
): void {
  applyExtensionsToRegistry(entries)
}
