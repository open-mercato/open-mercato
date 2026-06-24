import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'node:url'
import { defineSkill, type SkillRegistryEntry } from './lib/sdk/defineSkill'
import { parseSkillMarkdown } from './lib/sdk/skillMarkdown'

// Skills are authored as SKILL.md files under `./skills`. Each file carries
// frontmatter (id, moduleId, label, description, tools) and a markdown body that
// becomes the skill's instructions. They are loaded here and registered via
// `defineSkill`, so the registry is populated by importing this module — exactly
// like `ai-agents.ts`. Path resolution mirrors `lib/seeds.ts` `readExampleJson`
// so it works from the import.meta location and from the repo cwd.

const __esmDirname = path.dirname(fileURLToPath(import.meta.url))

function resolveSkillsDir(): string | null {
  const candidates = [
    path.join(__esmDirname, 'skills'),
    path.join(process.cwd(), 'packages', 'core', 'src', 'modules', 'agent_orchestrator', 'skills'),
    path.join(process.cwd(), 'src', 'modules', 'agent_orchestrator', 'skills'),
  ]
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null
}

function loadSkillsFromDisk(): SkillRegistryEntry[] {
  const dir = resolveSkillsDir()
  if (!dir) {
    console.warn('[agent_orchestrator] skills directory not found; no skills loaded.')
    return []
  }
  const files = fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.md'))
    .sort()
  const entries: SkillRegistryEntry[] = []
  for (const file of files) {
    const raw = fs.readFileSync(path.join(dir, file), 'utf8')
    const parsed = parseSkillMarkdown(raw)
    if (!parsed) {
      console.warn(`[agent_orchestrator] skill "${file}" is missing required frontmatter (id/moduleId/label); skipping.`)
      continue
    }
    entries.push(defineSkill(parsed))
  }
  return entries
}

export const aiSkills: SkillRegistryEntry[] = loadSkillsFromDisk()

export default aiSkills
