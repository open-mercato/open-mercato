/**
 * Minimal, purpose-built parser for an `agents/<id>/AGENT.md` file, mirroring
 * `skillMarkdown.ts`. The format is fully controlled by us (agents are authored
 * in-repo), so a tiny parser avoids pulling in a YAML/frontmatter dependency.
 * Supported frontmatter:
 *
 *   ---
 *   id: deals.health_check
 *   label: Deal health check
 *   description: Assess a deal and propose the next stage.
 *   provider: anthropic            # optional
 *   model: claude-sonnet-4-6       # optional
 *   tools: [customers.get_deal]    # read-only tool ids; block list also accepted
 *   skills: [deals.stage_playbook]
 *   subAgents: [deals.activity_scan]
 *   maxSteps: 12
 *   ---
 *   <markdown body → agent instructions>
 *
 * List keys (`tools`, `skills`, `subAgents`) accept BOTH the inline form
 * `tools: [a, b]` and a block list (`- a` lines). Everything after the closing
 * `---` is the instructions body (trimmed). Returns null when a required field
 * (id, label, description) is missing.
 */
import type { FileAgentFilesConfig } from './defineAgent'

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/

const LIST_KEYS = ['tools', 'skills', 'subAgents'] as const
type ListKey = (typeof LIST_KEYS)[number]

const TRUTHY_TOKENS = new Set(['enabled', 'true', 'yes', '1', 'on'])

function stripQuotes(value: string): string {
  return value.trim().replace(/^['"]/, '').replace(/['"]$/, '').trim()
}

export type AgentMarkdown = {
  id: string
  label: string
  description: string
  provider?: string
  model?: string
  tools: string[]
  skills: string[]
  subAgents: string[]
  maxSteps?: number
  files?: FileAgentFilesConfig
  instructions: string
}

type Frontmatter = {
  id?: string
  label?: string
  description?: string
  provider?: string
  model?: string
  tools?: string[]
  skills?: string[]
  subAgents?: string[]
  maxSteps?: number
  filesEnabled?: boolean
  filesBash?: boolean
}

function isListKey(key: string): key is ListKey {
  return (LIST_KEYS as readonly string[]).includes(key)
}

function parseInlineList(rawValue: string): string[] {
  return rawValue
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .split(',')
    .map((entry) => stripQuotes(entry))
    .filter(Boolean)
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
    if (isListKey(key)) {
      if (rawValue.startsWith('[')) {
        result[key] = parseInlineList(rawValue)
        index += 1
        continue
      }
      // Block list: subsequent `- item` lines.
      const items: string[] = []
      index += 1
      while (index < lines.length && /^\s*-\s+/.test(lines[index])) {
        items.push(stripQuotes(lines[index].replace(/^\s*-\s+/, '')))
        index += 1
      }
      result[key] = items.filter(Boolean)
      continue
    }
    if (key === 'maxSteps') {
      const parsed = Number.parseInt(stripQuotes(rawValue), 10)
      if (!Number.isNaN(parsed)) result.maxSteps = parsed
      index += 1
      continue
    }
    if (key === 'files') {
      result.filesEnabled = TRUTHY_TOKENS.has(stripQuotes(rawValue).toLowerCase())
      index += 1
      continue
    }
    if (key === 'filesBash') {
      result.filesBash = TRUTHY_TOKENS.has(stripQuotes(rawValue).toLowerCase())
      index += 1
      continue
    }
    if (key === 'id' || key === 'label' || key === 'description' || key === 'provider' || key === 'model') {
      result[key] = stripQuotes(rawValue)
    }
    index += 1
  }
  return result
}

export function parseAgentMarkdown(raw: string): AgentMarkdown | null {
  const match = FRONTMATTER_RE.exec(raw)
  if (!match) return null
  const [, frontmatterBlock, body] = match
  const meta = parseFrontmatter(frontmatterBlock)
  if (!meta.id || !meta.label || !meta.description) return null
  return {
    id: meta.id,
    label: meta.label,
    description: meta.description,
    provider: meta.provider,
    model: meta.model,
    tools: meta.tools ?? [],
    skills: meta.skills ?? [],
    subAgents: meta.subAgents ?? [],
    maxSteps: meta.maxSteps,
    files: meta.filesEnabled
      ? { enabled: true, inputs: true, outputs: true, bash: meta.filesBash ?? false }
      : undefined,
    instructions: body.trim(),
  }
}
