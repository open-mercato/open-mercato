/**
 * Skill registry for propose-only agents. A skill is a reusable capability pack
 * (à la Claude Agent SDK skills): a body of instructions injected into the
 * agent's system prompt plus an optional READ-ONLY tool allowlist the skill
 * contributes to the agent. Unlike the previous `[skill:<id>]` prompt-marker
 * stub, declaring a skill on an agent now actually changes what the agent knows
 * and can call (see `defineAgent` → skill resolution).
 *
 * Skills stay read-only by construction: agents are declared `readOnly`, so the
 * AI runtime strips any `isMutation: true` tool a skill contributes — a skill
 * can only ever add reads, never writes.
 */
export interface DefineSkillInput {
  /** 'module.skill' — STABLE contract id referenced by an agent's `skills`. */
  id: string
  moduleId: string
  label: string
  description: string
  /** SKILL.md-style body injected verbatim into the system prompt of any agent that declares it. */
  instructions: string
  /** defineAiTool ids the skill contributes to the agent's allowlist (read-only). */
  tools?: string[]
}

export interface SkillRegistryEntry {
  id: string
  moduleId: string
  label: string
  description: string
  instructions: string
  tools: string[]
}

const registry = new Map<string, SkillRegistryEntry>()

export function defineSkill(input: DefineSkillInput): SkillRegistryEntry {
  if (registry.has(input.id)) {
    throw new Error(`[internal] duplicate skill id "${input.id}"`)
  }
  const entry: SkillRegistryEntry = {
    id: input.id,
    moduleId: input.moduleId,
    label: input.label,
    description: input.description,
    instructions: input.instructions,
    tools: input.tools ?? [],
  }
  registry.set(input.id, entry)
  return entry
}

export function getSkillEntry(id: string): SkillRegistryEntry | undefined {
  return registry.get(id)
}

export function listSkillEntries(): SkillRegistryEntry[] {
  return [...registry.values()]
}

let skillsLoadPromise: Promise<void> | null = null

/**
 * Ensure the module's `ai-skills.ts` has executed so `defineSkill` has populated
 * the registry. Mirrors `ensureAgentsLoaded`: the registry is a module-level Map
 * filled by import side effect, so code paths that don't transitively import
 * `ai-skills.ts` (e.g. the agents detail API resolving skill metadata) would
 * otherwise read an empty registry. Idempotent.
 */
export async function ensureSkillsLoaded(): Promise<void> {
  if (registry.size > 0) return
  if (!skillsLoadPromise) {
    skillsLoadPromise = import('../../ai-skills')
      .then(() => undefined)
      .catch((err) => {
        skillsLoadPromise = null
        throw err
      })
  }
  await skillsLoadPromise
}
