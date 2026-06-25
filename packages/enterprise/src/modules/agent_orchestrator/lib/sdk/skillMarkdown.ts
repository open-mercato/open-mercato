import type { DefineSkillInput } from './defineSkill'

/**
 * Minimal, purpose-built parser for a SKILL.md file. The format is fully
 * controlled by us (skills are authored in-repo), so a tiny parser avoids
 * pulling in a YAML/frontmatter dependency. Supported frontmatter:
 *
 *   ---
 *   id: deals.stage_playbook
 *   moduleId: agent_orchestrator
 *   label: Deal stage playbook
 *   description: One-line summary.
 *   tools:
 *     - customers.analyze_deals
 *   ---
 *   <markdown body → skill instructions>
 *
 * `tools` also accepts the inline form `tools: [a, b]`. Everything after the
 * closing `---` is the instructions body (trimmed). Returns null when the
 * required fields (id, moduleId, label) are missing.
 */
const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/

function stripQuotes(value: string): string {
  return value.trim().replace(/^['"]/, '').replace(/['"]$/, '').trim()
}

type Frontmatter = {
  id?: string
  moduleId?: string
  label?: string
  description?: string
  tools?: string[]
}

function parseFrontmatter(block: string): Frontmatter {
  const result: Frontmatter = {}
  const lines = block.split('\n')
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) {
      index += 1
      continue
    }
    const match = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line)
    if (!match) {
      index += 1
      continue
    }
    const key = match[1]
    const rawValue = match[2].trim()
    if (key === 'tools') {
      if (rawValue.startsWith('[')) {
        result.tools = rawValue
          .replace(/^\[/, '')
          .replace(/\]$/, '')
          .split(',')
          .map((entry) => stripQuotes(entry))
          .filter(Boolean)
        index += 1
        continue
      }
      // Block list: subsequent `- item` lines.
      const tools: string[] = []
      index += 1
      while (index < lines.length && /^\s*-\s+/.test(lines[index])) {
        tools.push(stripQuotes(lines[index].replace(/^\s*-\s+/, '')))
        index += 1
      }
      result.tools = tools.filter(Boolean)
      continue
    }
    if (key === 'id' || key === 'moduleId' || key === 'label' || key === 'description') {
      result[key] = stripQuotes(rawValue)
    }
    index += 1
  }
  return result
}

export function parseSkillMarkdown(raw: string): DefineSkillInput | null {
  const match = FRONTMATTER_RE.exec(raw)
  if (!match) return null
  const [, frontmatterBlock, body] = match
  const meta = parseFrontmatter(frontmatterBlock)
  if (!meta.id || !meta.moduleId || !meta.label) return null
  return {
    id: meta.id,
    moduleId: meta.moduleId,
    label: meta.label,
    description: meta.description ?? '',
    instructions: body.trim(),
    tools: meta.tools ?? [],
  }
}

export type AgentLocalSkill = {
  /** Skill id: frontmatter `id` when present, else the dir name (see fallbackId). */
  id: string
  label: string
  description: string
  instructions: string
  tools: string[]
}

/**
 * Parse an AGENT-LOCAL SKILL.md (authored under `agents/<id>/skills/<skill_id>/`).
 *
 * Unlike module-level skills (`parseSkillMarkdown`), agent-local skills MAY omit
 * `moduleId` (they are scoped to one agent, not a module registry) and MAY omit
 * the frontmatter `id` (the skill DIR NAME is then authoritative). This mirrors
 * the OpenCode native-skill shape (`name` + `description` + body) more closely
 * than the module-skill shape. Resolution rules:
 *
 *  - `id`   ← frontmatter `id` when present, else `fallbackId` (the dir name).
 *  - `label`← frontmatter `label` when present, else `id`.
 *  - `tools`← frontmatter `tools` (read-only ids) unioned into the agent allowlist.
 *
 * Returns null only when the file has no parseable frontmatter block at all.
 */
export function parseAgentLocalSkillMarkdown(
  raw: string,
  fallbackId: string,
): AgentLocalSkill | null {
  const match = FRONTMATTER_RE.exec(raw)
  if (!match) return null
  const [, frontmatterBlock, body] = match
  const meta = parseFrontmatter(frontmatterBlock)
  const id = meta.id || fallbackId
  if (!id) return null
  return {
    id,
    label: meta.label || id,
    description: meta.description ?? '',
    instructions: body.trim(),
    tools: meta.tools ?? [],
  }
}
