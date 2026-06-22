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
