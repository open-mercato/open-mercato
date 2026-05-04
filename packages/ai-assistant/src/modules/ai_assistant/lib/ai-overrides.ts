import {
  registerModuleOverrideApplier,
  type ModuleOverrideEntry,
} from '@open-mercato/shared/modules/overrides'

/**
 * Module-to-module override pipeline for AI agents and AI tools.
 *
 * Modules contribute overrides through two surfaces:
 *
 * 1. Per-module: declare additional `aiAgentOverrides` / `aiToolOverrides`
 *    exports in the existing `<module>/ai-agents.ts` / `<module>/ai-tools.ts`
 *    files (no separate `ai-overrides.ts` file). The generator picks the
 *    exports up alongside `aiAgents` / `aiTools` and emits override entries
 *    inside `apps/<app>/.mercato/generated/ai-agents.generated.ts`
 *    (`aiAgentOverrideEntries`) and `ai-tools.generated.ts`
 *    (`aiToolOverrideEntries`).
 *
 * 2. App-level: declare `aiAgentOverrides` / `aiToolOverrides` directly on a
 *    `ModuleEntry` inside the app's `src/modules.ts`. {@link
 *    applyAiOverridesFromEnabledModules} feeds these into the runtime; they
 *    sit one tier higher than the per-module file-based entries but below
 *    explicit programmatic calls.
 *
 * Tests and bootstrap code can also override imperatively via
 * {@link applyAiAgentOverrides} and {@link applyAiToolOverrides}, which
 * supersede every other tier and persist for the process lifetime.
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

/** Map of agent id → override. Used in the per-module `ai-agents.ts` file. */
export type AiAgentOverridesMap = Record<string, AiAgentOverride>

/** Map of tool name → override. Used in the per-module `ai-tools.ts` file. */
export type AiToolOverridesMap = Record<string, AiToolOverride>

/**
 * Per-entry shape produced by the agent generator. Mirrors the per-module
 * record format used elsewhere in the registry generators so the file
 * stays grep-friendly.
 */
export interface AiAgentOverrideConfigEntry {
  moduleId: string
  overrides: AiAgentOverridesMap
}

/**
 * Per-entry shape produced by the tool generator. Same record format as
 * {@link AiAgentOverrideConfigEntry}, but with tool definitions.
 */
export interface AiToolOverrideConfigEntry {
  moduleId: string
  overrides: AiToolOverridesMap
}

/** Shape of the `entry.overrides.ai` sub-tree on a `modules.ts` entry. */
export interface AiModuleOverridesShape {
  agents?: AiAgentOverridesMap
  tools?: AiToolOverridesMap
}

/** Shape of a `modules.ts` `ModuleEntry` with the umbrella `overrides.ai`. */
export interface EnabledModuleAiOverrides {
  id: string
  overrides?: { ai?: AiModuleOverridesShape }
}

const programmaticAgentOverrides: AiAgentOverridesMap = {}
const programmaticToolOverrides: AiToolOverridesMap = {}

const modulesConfigAgentOverrides: AiAgentOverridesMap = {}
const modulesConfigToolOverrides: AiToolOverridesMap = {}

/**
 * Apply programmatic agent overrides — survive after the registries load
 * and take precedence over both file-based and `modules.ts`-tier overrides
 * for the same id.
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
 * and take precedence over both file-based and `modules.ts`-tier overrides
 * for the same name.
 */
export function applyAiToolOverrides(overrides: AiToolOverridesMap): void {
  for (const [name, value] of Object.entries(overrides)) {
    programmaticToolOverrides[name] = value
  }
}

/**
 * Walk a list of `enabledModules` entries (the `apps/<app>/src/modules.ts`
 * shape) and register their `overrides.ai.agents` / `overrides.ai.tools`
 * into the `modules.ts` tier. Tier precedence (highest first):
 *
 *   1. {@link applyAiAgentOverrides} / {@link applyAiToolOverrides}
 *   2. `modules.ts` inline (this function)
 *   3. `<module>/ai-agents.ts` `aiAgentOverrides` / `<module>/ai-tools.ts`
 *      `aiToolOverrides`
 *   4. base `aiAgents` / `aiTools`
 *
 * Calling this multiple times is additive: later calls overlay on the
 * existing tier (last wins per id). Use only at boot time — re-entering
 * mid-request blurs the resolution order.
 *
 * In practice this is invoked from `applyModuleOverridesFromEnabledModules`
 * (the umbrella dispatcher in `@open-mercato/shared/modules/overrides`)
 * via the registered `'ai'` applier; downstream apps call the dispatcher
 * once from `bootstrap.ts`. The standalone signature is kept for tests
 * and ad-hoc use.
 */
export function applyAiOverridesFromEnabledModules(
  modules: ReadonlyArray<EnabledModuleAiOverrides>,
): void {
  for (const entry of modules) {
    if (!entry || typeof entry.id !== 'string' || !entry.id) continue
    const ai = entry.overrides?.ai
    if (!ai || typeof ai !== 'object') continue
    if (ai.agents && typeof ai.agents === 'object') {
      for (const [id, value] of Object.entries(ai.agents)) {
        modulesConfigAgentOverrides[id] = value as AiAgentOverride
      }
    }
    if (ai.tools && typeof ai.tools === 'object') {
      for (const [name, value] of Object.entries(ai.tools)) {
        modulesConfigToolOverrides[name] = value as AiToolOverride
      }
    }
  }
}

/**
 * Bucketed entry shape passed to the umbrella dispatcher's per-domain
 * applier. Each entry carries one module's `overrides.ai` sub-tree.
 */
type AiOverrideEntryFromDispatcher = {
  moduleId: string
  overrides: AiModuleOverridesShape
}

/**
 * Applier registered with `@open-mercato/shared/modules/overrides` for
 * the `'ai'` domain. The dispatcher hands us per-module entries already
 * scoped to `overrides.ai`; we re-shape into `EnabledModuleAiOverrides`
 * and reuse {@link applyAiOverridesFromEnabledModules} so the AI tier
 * has exactly one code path.
 */
export function applyAiOverridesDispatcherEntries(
  entries: ReadonlyArray<AiOverrideEntryFromDispatcher>,
): void {
  applyAiOverridesFromEnabledModules(
    entries.map((entry) => ({
      id: entry.moduleId,
      overrides: { ai: entry.overrides },
    })),
  )
}

// Side-effect: register the `'ai'` applier on first module load so the
// umbrella dispatcher in `@open-mercato/shared/modules/overrides` can
// route `entry.overrides.ai` here. Any consumer that imports
// `@open-mercato/ai-assistant` (which apps do via `bootstrap.ts`) gets
// the registration for free — no second import needed.
registerModuleOverrideApplier<AiModuleOverridesShape>(
  'ai',
  (entries: ReadonlyArray<ModuleOverrideEntry<AiModuleOverridesShape>>) => {
    applyAiOverridesDispatcherEntries(entries)
  },
)

/** @__internal Test-only hook — reset programmatic + modules.ts override state. */
export function resetProgrammaticOverridesForTests(): void {
  for (const key of Object.keys(programmaticAgentOverrides)) {
    delete programmaticAgentOverrides[key]
  }
  for (const key of Object.keys(programmaticToolOverrides)) {
    delete programmaticToolOverrides[key]
  }
  for (const key of Object.keys(modulesConfigAgentOverrides)) {
    delete modulesConfigAgentOverrides[key]
  }
  for (const key of Object.keys(modulesConfigToolOverrides)) {
    delete modulesConfigToolOverrides[key]
  }
}

/**
 * Resolve the final agent override map from a list of file-based entries
 * plus the `modules.ts` and programmatic state.
 *
 * Resolution order (lowest precedence → highest):
 *   1. file entries in module load order
 *   2. modules.ts entries
 *   3. programmatic
 */
export function composeAgentOverrideMap(
  fileEntries: readonly AiAgentOverrideConfigEntry[],
): AiAgentOverridesMap {
  const out: AiAgentOverridesMap = {}
  for (const entry of fileEntries) {
    const overrides = entry?.overrides
    if (!overrides || typeof overrides !== 'object') continue
    for (const [id, value] of Object.entries(overrides)) {
      if (typeof id !== 'string' || !id) continue
      out[id] = value as AiAgentOverride
    }
  }
  for (const [id, value] of Object.entries(modulesConfigAgentOverrides)) {
    out[id] = value
  }
  for (const [id, value] of Object.entries(programmaticAgentOverrides)) {
    out[id] = value
  }
  return out
}

/**
 * Resolve the final tool override map from a list of file-based entries
 * plus the `modules.ts` and programmatic state.
 */
export function composeToolOverrideMap(
  fileEntries: readonly AiToolOverrideConfigEntry[],
): AiToolOverridesMap {
  const out: AiToolOverridesMap = {}
  for (const entry of fileEntries) {
    const overrides = entry?.overrides
    if (!overrides || typeof overrides !== 'object') continue
    for (const [name, value] of Object.entries(overrides)) {
      if (typeof name !== 'string' || !name) continue
      out[name] = value as AiToolOverride
    }
  }
  for (const [name, value] of Object.entries(modulesConfigToolOverrides)) {
    out[name] = value
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
 * @__internal — read the snapshot of programmatic + modules.ts overrides.
 * Used by tests and by the diagnostic helper that reports which overrides
 * are in effect.
 */
export function snapshotProgrammaticOverrides(): {
  agents: Readonly<AiAgentOverridesMap>
  tools: Readonly<AiToolOverridesMap>
  modulesConfigAgents: Readonly<AiAgentOverridesMap>
  modulesConfigTools: Readonly<AiToolOverridesMap>
} {
  return {
    agents: { ...programmaticAgentOverrides },
    tools: { ...programmaticToolOverrides },
    modulesConfigAgents: { ...modulesConfigAgentOverrides },
    modulesConfigTools: { ...modulesConfigToolOverrides },
  }
}
