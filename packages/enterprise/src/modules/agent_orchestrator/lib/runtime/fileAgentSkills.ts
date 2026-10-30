/**
 * In-process registry of agent-local skill content (Phase 3), keyed by agent id
 * then skill id. The `load_skill` MCP tool reads from this map at runtime to
 * return a skill's instructions/template/examples on demand (progressive
 * disclosure), WITHOUT touching the filesystem — the content is persisted in the
 * committed manifest (`generated/file-agents.generated.ts`) and registered here by
 * `ensureAgentsLoaded()` at load time.
 *
 * The native OpenCode SKILL.md files are the primary delivery path; this map +
 * `load_skill` is the fallback, and also the only carrier for TEMPLATE.md /
 * examples that native skills may not bundle.
 */

/**
 * One executable script carried as plain data (Phase 5). `name` is the script
 * file's basename without extension (e.g. `scripts/score.ts` → `score`); `source`
 * is the raw TS/JS source, run server-side in the Code Mode `isolated-vm`
 * sandbox by the `run_skill_script` MCP tool — NEVER copied to the OpenCode
 * container. The script is a pure function of its `args` (no fs/net/imports).
 */
export type SkillScript = {
  name: string
  source: string
}

export type SkillContent = {
  id: string
  instructions: string
  template?: string
  examples: string[]
  tools: string[]
  /** Sandboxed helper scripts (`skills/<id>/scripts/*.ts`), Phase 5. */
  scripts?: SkillScript[]
}

const byAgent = new Map<string, Map<string, SkillContent>>()

/**
 * Register the skill content for one agent. Idempotent: re-registering an agent
 * replaces its skill set (a re-`ensureAgentsLoaded` should never duplicate).
 */
export function registerAgentSkills(agentId: string, skills: SkillContent[]): void {
  if (skills.length === 0) {
    byAgent.delete(agentId)
    return
  }
  const map = new Map<string, SkillContent>()
  for (const skill of skills) map.set(skill.id, skill)
  byAgent.set(agentId, map)
}

/** Resolve one skill's content for an agent, or undefined when not allowed/known. */
export function getAgentSkill(agentId: string, skillId: string): SkillContent | undefined {
  return byAgent.get(agentId)?.get(skillId)
}

/** List the allowed skill ids for an agent (the set the agent may `load_skill`). */
export function listAgentSkillIds(agentId: string): string[] {
  const map = byAgent.get(agentId)
  return map ? [...map.keys()] : []
}

/**
 * Resolve one named script of one skill for an agent (Phase 5), or undefined when
 * the agent/skill/script is unknown. The active agent + skill set are resolved
 * from the per-run correlation store by the `run_skill_script` tool BEFORE this
 * lookup, so this only confirms the script exists in that allowed skill.
 */
export function getAgentSkillScript(
  agentId: string,
  skillId: string,
  scriptName: string,
): SkillScript | undefined {
  const skill = byAgent.get(agentId)?.get(skillId)
  return skill?.scripts?.find((script) => script.name === scriptName)
}

/** Test/reset seam: clear all registered skill content. */
export function clearAgentSkills(): void {
  byAgent.clear()
}
