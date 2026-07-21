import fs from 'node:fs'
import path from 'node:path'
import { countTokens } from '@open-mercato/shared/lib/ai/token-count'
import type {
  AgentTokenUsage,
  SkillTokenUsage,
  SubAgentTokenUsage,
  TokenizedFile,
  ToolTokenUsage,
} from './types'

const TOOL_EXTENSIONS = ['.ts', '.js']

function countFile(dir: string, relativePath: string): TokenizedFile | null {
  const absolute = path.join(dir, relativePath)
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return null
  return { path: relativePath, tokens: countTokens(fs.readFileSync(absolute, 'utf8')) }
}

function listFiles(dir: string, extensions?: string[]): string[] {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => !extensions || extensions.includes(path.extname(name)))
    .sort((a, b) => a.localeCompare(b))
}

function listDirs(dir: string): string[] {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== '__tests__')
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
}

function computeSkills(agentDir: string): SkillTokenUsage[] {
  const skillsRoot = path.join(agentDir, 'skills')
  return listDirs(skillsRoot).map((skillId) => {
    const skillRel = path.join('skills', skillId)
    const files: TokenizedFile[] = []
    for (const name of ['SKILL.md', 'TEMPLATE.md']) {
      const file = countFile(agentDir, path.join(skillRel, name))
      if (file) files.push(file)
    }
    for (const subdir of ['examples', 'scripts']) {
      for (const name of listFiles(path.join(agentDir, skillRel, subdir))) {
        const file = countFile(agentDir, path.join(skillRel, subdir, name))
        if (file) files.push(file)
      }
    }
    return { id: skillId, tokens: files.reduce((sum, f) => sum + f.tokens, 0), files }
  })
}

function computeTools(agentDir: string): ToolTokenUsage[] {
  const toolsRoot = path.join(agentDir, 'tools')
  return listFiles(toolsRoot, TOOL_EXTENSIONS).map((name) => {
    const rel = path.join('tools', name)
    return {
      name: name.replace(/\.[^.]+$/, ''),
      path: rel,
      tokens: countTokens(fs.readFileSync(path.join(agentDir, rel), 'utf8')),
    }
  })
}

/**
 * Compute the token-usage breakdown for a file-defined agent directory by
 * counting the RAW bytes of each construction file. Mirrors the generator's
 * bake-time walker (`discoverAgentTokenUsage` in the CLI); keep both in sync.
 *
 * `depth` guards the sub-agent recursion at the same depth cap the loader
 * enforces (sub-agents may not declare their own sub-agents).
 */
export function computeAgentTokenUsageFromDir(agentDir: string, depth = 0): AgentTokenUsage {
  const agent = countFile(agentDir, 'AGENT.md')?.tokens ?? 0
  const outcome = countFile(agentDir, 'OUTCOME.md')?.tokens ?? 0
  const skills = computeSkills(agentDir)
  const tools = computeTools(agentDir)

  const subAgents: SubAgentTokenUsage[] = []
  if (depth === 0) {
    const subAgentsRoot = path.join(agentDir, 'sub-agents')
    for (const subId of listDirs(subAgentsRoot)) {
      const nested = computeAgentTokenUsageFromDir(path.join(subAgentsRoot, subId), depth + 1)
      subAgents.push({ id: subId, tokens: nested.total })
    }
  }

  const self =
    agent +
    outcome +
    skills.reduce((sum, s) => sum + s.tokens, 0) +
    tools.reduce((sum, t) => sum + t.tokens, 0)
  const total = self + subAgents.reduce((sum, s) => sum + s.tokens, 0)

  return { total, self, agent, outcome, skills, tools, subAgents }
}
