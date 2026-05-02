/**
 * Module-to-module override pipeline for AI agents and AI tools.
 *
 * Per-module `<module>/ai-overrides.ts` files are aggregated by the CLI
 * generator into `apps/<app>/.mercato/generated/ai-overrides.generated.ts`
 * (`aiOverrideEntries`). At first registry access the runtime applies them
 * in module-load order — the last entry to mention an id wins.
 *
 * Apps and tests can also override via the programmatic helpers
 * {@link applyAiAgentOverrides} and {@link applyAiToolOverrides}, which
 * supersede file-based overrides and persist for the process lifetime.
 *
 * `null` always means "remove from the registry"; a definition replaces.
 *
 * @see ../../../../../../.ai/specs/2026-04-30-ai-overrides-and-module-disable.md
 */
import type { AiAgentDefinition } from './ai-agent-definition'
import type { AiToolDefinition } from './types'

/** Override for a single agent: replace with a definition or remove with `null`. */
export type AiAgentOverride = AiAgentDefinition | null

/** Override for a single tool: replace with a definition or remove with `null`. */
export type AiToolOverride = AiToolDefinition | null

/** Map of agent id → override. Used in the per-module `ai-overrides.ts` file. */
export type AiAgentOverridesMap = Record<string, AiAgentOverride>

/** Map of tool name → override. Used in the per-module `ai-overrides.ts` file. */
export type AiToolOverridesMap = Record<string, AiToolOverride>

/**
 * Public shape of the `aiOverrides` export from a module's
 * `ai-overrides.ts` file. Both branches are optional so a module can ship
 * an agents-only or tools-only override file without filler.
 */
export interface AiAgentOverrides {
  agents?: AiAgentOverridesMap
  tools?: AiToolOverridesMap
}

/**
 * Per-entry shape produced by the generator. Mirrors the per-module
 * record format used elsewhere in the registry generators so the file
 * stays grep-able and inspectable.
 */
export interface AiOverrideConfigEntry {
  moduleId: string
  overrides: AiAgentOverrides
}

const programmaticAgentOverrides: AiAgentOverridesMap = {}
const programmaticToolOverrides: AiToolOverridesMap = {}

/**
 * Apply programmatic agent overrides — survive after the registries load
 * and take precedence over file-based overrides for the same id.
 *
 * @example
 * ```ts
 * applyAiAgentOverrides({
 *   'catalog.catalog_assistant': null,           // disable
 *   'catalog.merchandising_assistant': customAgent,  // replace
 * })
 * ```
 */
export function applyAiAgentOverrides(overrides: AiAgentOverridesMap): void {
  for (const [id, value] of Object.entries(overrides)) {
    programmaticAgentOverrides[id] = value
  }
}

/**
 * Apply programmatic tool overrides — survive after the registries load
 * and take precedence over file-based overrides for the same id.
 */
export function applyAiToolOverrides(overrides: AiToolOverridesMap): void {
  for (const [name, value] of Object.entries(overrides)) {
    programmaticToolOverrides[name] = value
  }
}

/** @__internal Test-only hook — reset programmatic override state. */
export function resetProgrammaticOverridesForTests(): void {
  for (const key of Object.keys(programmaticAgentOverrides)) {
    delete programmaticAgentOverrides[key]
  }
  for (const key of Object.keys(programmaticToolOverrides)) {
    delete programmaticToolOverrides[key]
  }
}

/**
 * Resolve the final agent override map from a list of file-based entries
 * plus the programmatic state. Last entry wins; programmatic always
 * supersedes file-based.
 */
export function composeAgentOverrideMap(
  fileEntries: readonly AiOverrideConfigEntry[],
): AiAgentOverridesMap {
  const out: AiAgentOverridesMap = {}
  for (const entry of fileEntries) {
    const agents = entry?.overrides?.agents
    if (!agents || typeof agents !== 'object') continue
    for (const [id, value] of Object.entries(agents)) {
      if (typeof id !== 'string' || !id) continue
      out[id] = value as AiAgentOverride
    }
  }
  for (const [id, value] of Object.entries(programmaticAgentOverrides)) {
    out[id] = value
  }
  return out
}

/**
 * Resolve the final tool override map from a list of file-based entries
 * plus the programmatic state. Last entry wins; programmatic always
 * supersedes file-based.
 */
export function composeToolOverrideMap(
  fileEntries: readonly AiOverrideConfigEntry[],
): AiToolOverridesMap {
  const out: AiToolOverridesMap = {}
  for (const entry of fileEntries) {
    const tools = entry?.overrides?.tools
    if (!tools || typeof tools !== 'object') continue
    for (const [name, value] of Object.entries(tools)) {
      if (typeof name !== 'string' || !name) continue
      out[name] = value as AiToolOverride
    }
  }
  for (const [name, value] of Object.entries(programmaticToolOverrides)) {
    out[name] = value
  }
  return out
}

/**
 * Apply an agent override map to a base list. Returns a new array.
 * `null` removes the entry; a non-null override replaces it. Override
 * entries naming an id that is not in `base` log a structured warning so
 * an operator can spot stale override files.
 */
export function applyAgentOverrideMap(
  base: readonly AiAgentDefinition[],
  overrides: AiAgentOverridesMap,
): AiAgentDefinition[] {
  if (!overrides || Object.keys(overrides).length === 0) return base.slice()
  const byId = new Map<string, AiAgentDefinition>()
  for (const agent of base) {
    if (agent && typeof agent.id === 'string' && agent.id) {
      byId.set(agent.id, agent)
    }
  }
  for (const [id, value] of Object.entries(overrides)) {
    if (!byId.has(id) && value !== null) {
      // Allow registering a brand-new agent through the override surface
      // — useful for app-level "synthetic" agents without authoring a
      // module file. Warn at the structured logger so the operator
      // notices a stale id slipping through.
      console.warn(
        `[AI Overrides] Override registers a new agent "${id}" — no base entry to replace.`,
      )
    }
    if (value === null) {
      byId.delete(id)
      continue
    }
    if (!value || typeof value.id !== 'string' || value.id !== id) {
      console.warn(
        `[AI Overrides] Skipping malformed agent override for id "${id}" — id mismatch or missing fields.`,
      )
      continue
    }
    byId.set(id, value)
  }
  return Array.from(byId.values())
}

/**
 * Apply a tool override map to a base map. Returns a new Map.
 * `null` removes the entry; a non-null override replaces it.
 */
export function applyToolOverrideMap<TTool extends { name: string }>(
  base: ReadonlyMap<string, TTool>,
  overrides: Record<string, TTool | null | undefined>,
): Map<string, TTool> {
  const out = new Map<string, TTool>(base)
  if (!overrides) return out
  for (const [name, value] of Object.entries(overrides)) {
    if (value === null) {
      out.delete(name)
      continue
    }
    if (value === undefined) continue
    if (!value || typeof (value as TTool).name !== 'string' || (value as TTool).name !== name) {
      console.warn(
        `[AI Overrides] Skipping malformed tool override for name "${name}" — name mismatch or missing fields.`,
      )
      continue
    }
    out.set(name, value as TTool)
  }
  return out
}

/**
 * @__internal — read the snapshot of programmatic overrides. Used by
 * tests and by the diagnostic helper that reports which overrides are in
 * effect.
 */
export function snapshotProgrammaticOverrides(): {
  agents: Readonly<AiAgentOverridesMap>
  tools: Readonly<AiToolOverridesMap>
} {
  return {
    agents: { ...programmaticAgentOverrides },
    tools: { ...programmaticToolOverrides },
  }
}
