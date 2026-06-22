import fs from 'node:fs'
import path from 'node:path'
import type { GeneratorExtension, ModuleScanContext } from '../extension'
import { resolveStandaloneSourceMirrorBase } from '../scanner'

/**
 * Generator extension for the `agents/<id>/` file-defined-agent convention
 * (CLAUDE.md + OUTCOME.md). For every enabled module it scans the module's
 * `agents/` tree, validates each agent dir, and emits two artifacts as a
 * deterministic fs side effect from `generateOutput()`:
 *
 *   1. The committed, git-tracked registry manifest
 *      `packages/core/src/modules/agent_orchestrator/generated/file-agents.generated.ts`
 *      (raw JSON-Schema, recompiled to Zod at load by `ensureAgentsLoaded`).
 *   2. OpenCode agent `.md` files under `docker/opencode/agents/` (container
 *      delivery: dev bind-mount, prod Dockerfile COPY).
 *
 * Both targets live OUTSIDE the app `.mercato/generated/` dir, so they are
 * written directly (not via the Map<filename,content> return, which targets the
 * app generated dir). `generateOutput()` therefore returns an empty Map.
 *
 * Generation FAILS (throws) on any malformed CLAUDE.md/OUTCOME.md, naming the
 * offending dir (spec §9). The CLI does not depend on `@open-mercato/core`, so
 * the small CLAUDE.md/OUTCOME.md parsers are reimplemented here; they MUST stay
 * in sync with `lib/sdk/{agentMarkdown,defineFileAgent}.ts`.
 */

type DiscoveredAgent = {
  moduleId: string
  dir: string
  id: string
  label: string
  description: string
  instructions: string
  resultKind: 'informative' | 'actionable'
  outcomeSchema: Record<string, unknown>
  tools: string[]
  skills: string[]
  subAgents: string[]
  openCodeAgentName: string
  maxSteps?: number
  provider?: string
  model?: string
}

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/
const JSON_FENCE_RE = /```json\s*\n([\s\S]*?)\n```/
const LIST_KEYS = ['tools', 'skills', 'subAgents'] as const

function stripQuotes(value: string): string {
  return value.trim().replace(/^['"]/, '').replace(/['"]$/, '').trim()
}

function parseInlineList(rawValue: string): string[] {
  return rawValue
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .split(',')
    .map((entry) => stripQuotes(entry))
    .filter(Boolean)
}

type AgentFrontmatter = {
  id?: string
  label?: string
  description?: string
  provider?: string
  model?: string
  tools: string[]
  skills: string[]
  subAgents: string[]
  maxSteps?: number
  instructions: string
}

function parseAgentMarkdown(raw: string): AgentFrontmatter | null {
  const match = FRONTMATTER_RE.exec(raw)
  if (!match) return null
  const [, frontmatterBlock, body] = match
  const meta: AgentFrontmatter = { tools: [], skills: [], subAgents: [], instructions: body.trim() }
  const lines = frontmatterBlock.split('\n')
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) {
      index += 1
      continue
    }
    const lineMatch = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line)
    if (!lineMatch) {
      index += 1
      continue
    }
    const key = lineMatch[1]
    const rawValue = lineMatch[2].trim()
    if ((LIST_KEYS as readonly string[]).includes(key)) {
      const listKey = key as (typeof LIST_KEYS)[number]
      if (rawValue.startsWith('[')) {
        meta[listKey] = parseInlineList(rawValue)
        index += 1
        continue
      }
      const items: string[] = []
      index += 1
      while (index < lines.length && /^\s*-\s+/.test(lines[index])) {
        items.push(stripQuotes(lines[index].replace(/^\s*-\s+/, '')))
        index += 1
      }
      meta[listKey] = items.filter(Boolean)
      continue
    }
    if (key === 'maxSteps') {
      const parsed = Number.parseInt(stripQuotes(rawValue), 10)
      if (!Number.isNaN(parsed)) meta.maxSteps = parsed
      index += 1
      continue
    }
    if (key === 'id' || key === 'label' || key === 'description' || key === 'provider' || key === 'model') {
      meta[key] = stripQuotes(rawValue)
    }
    index += 1
  }
  if (!meta.id || !meta.label || !meta.description) return null
  return meta
}

function parseOutcomeKind(frontmatterBlock: string): 'informative' | 'actionable' | null {
  for (const line of frontmatterBlock.split('\n')) {
    const match = /^kind:\s*(.*)$/.exec(line.trim())
    if (!match) continue
    const value = stripQuotes(match[1])
    if (value === 'informative' || value === 'actionable') return value
    return null
  }
  return null
}

function parseOutcomeMarkdown(
  raw: string,
): { kind: 'informative' | 'actionable'; schema: Record<string, unknown> } | null {
  const frontmatterMatch = FRONTMATTER_RE.exec(raw)
  if (!frontmatterMatch) return null
  const [, frontmatterBlock, body] = frontmatterMatch
  const kind = parseOutcomeKind(frontmatterBlock)
  if (!kind) return null
  const fenceMatch = JSON_FENCE_RE.exec(body)
  if (!fenceMatch) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(fenceMatch[1])
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  return { kind, schema: parsed as Record<string, unknown> }
}

function sanitizeAgentName(id: string): string {
  return id.replace(/[^a-z0-9_-]/gi, '_')
}

/** Walk up from a known in-repo path until a dir containing both `docker` and `packages` is found. */
function findRepoRoot(start: string): string | null {
  let current = path.resolve(start)
  for (let depth = 0; depth < 40; depth += 1) {
    if (
      fs.existsSync(path.join(current, 'docker', 'opencode')) &&
      fs.existsSync(path.join(current, 'packages'))
    ) {
      return current
    }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return null
}

function listAgentDirs(agentsBase: string): string[] {
  if (!fs.existsSync(agentsBase)) return []
  return fs
    .readdirSync(agentsBase, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== '__tests__')
    .map((entry) => path.join(agentsBase, entry.name))
}

function renderToolPermissionLine(toolName: string): string {
  return `  ${JSON.stringify(toolName)}: true`
}

function renderOpenCodeAgentFile(agent: DiscoveredAgent): string {
  const submitTool = 'agent_orchestrator.submit_outcome'
  const allowedTools = Array.from(new Set([...agent.tools, submitTool]))
  const modelLine =
    agent.provider && agent.model
      ? `model: ${agent.provider}/${agent.model}`
      : agent.model
        ? `model: ${agent.model}`
        : null
  const frontmatterLines = [
    '---',
    `description: ${JSON.stringify(agent.description)}`,
    ...(modelLine ? [modelLine] : []),
    'mode: primary',
    'tools:',
    '  "*": false',
    ...allowedTools.map(renderToolPermissionLine),
    'permission:',
    '  write: deny',
    '  edit: deny',
    '  bash: deny',
    '---',
  ]
  const terminalInstruction =
    'Finish by calling `agent_orchestrator.submit_outcome` with a value matching the outcome contract. Do not answer in prose.'
  const body = [agent.instructions.trim(), terminalInstruction].filter(Boolean).join('\n\n')
  return `${frontmatterLines.join('\n')}\n${body}\n`
}

function renderManifest(agents: DiscoveredAgent[]): string {
  const descriptors = agents
    .map((agent) => {
      const optional: string[] = []
      if (agent.maxSteps != null) optional.push(`    maxSteps: ${agent.maxSteps},`)
      if (agent.provider != null) optional.push(`    provider: ${JSON.stringify(agent.provider)},`)
      if (agent.model != null) optional.push(`    model: ${JSON.stringify(agent.model)},`)
      return [
        '  {',
        `    id: ${JSON.stringify(agent.id)},`,
        `    moduleId: ${JSON.stringify(agent.moduleId)},`,
        `    label: ${JSON.stringify(agent.label)},`,
        `    description: ${JSON.stringify(agent.description)},`,
        `    instructions: ${JSON.stringify(agent.instructions)},`,
        `    resultKind: ${JSON.stringify(agent.resultKind)},`,
        `    outcomeSchema: ${JSON.stringify(agent.outcomeSchema)},`,
        `    tools: ${JSON.stringify(agent.tools)},`,
        `    skills: ${JSON.stringify(agent.skills)},`,
        `    subAgents: ${JSON.stringify(agent.subAgents)},`,
        `    openCodeAgentName: ${JSON.stringify(agent.openCodeAgentName)},`,
        ...optional,
        '  },',
      ].join('\n')
    })
    .join('\n')

  return `// AUTO-GENERATED by mercato generate registry — DO NOT EDIT BY HAND.
//
// Committed, generator-owned manifest of file-defined (OpenCode) agents,
// discovered from \`agents/<id>/\` directories across every enabled module. It
// stores PLAIN data (raw JSON-Schema, not a Zod instance) so this file is pure
// data and travels with the repo (survives \`yarn clean-generated\`).
// \`ensureAgentsLoaded()\` recompiles each \`outcomeSchema\` to Zod via
// \`compileOutcome\` at load time and registers it with \`runtime:'opencode'\`.
//
// Regenerate with \`yarn generate\`.
import type { JsonSchemaNode, OutcomeKind } from '../lib/sdk/outcomeSchema'

export type FileAgentDescriptor = {
  id: string
  moduleId: string
  label: string
  description: string
  instructions: string
  resultKind: OutcomeKind
  outcomeSchema: JsonSchemaNode
  tools: string[]
  skills: string[]
  subAgents: string[]
  openCodeAgentName: string
  maxSteps?: number
  provider?: string
  model?: string
}

export const fileAgentDescriptors: FileAgentDescriptor[] = [${
    descriptors ? `\n${descriptors}\n` : ''
  }]
`
}

export function createAgentFilesExtension(): GeneratorExtension {
  const discovered: DiscoveredAgent[] = []
  const seenIds = new Set<string>()
  let repoRoot: string | null = null

  function scanAgentsTree(moduleId: string, baseDir: string): void {
    for (const dir of listAgentDirs(baseDir)) {
      const claudePath = path.join(dir, 'CLAUDE.md')
      const outcomePath = path.join(dir, 'OUTCOME.md')
      // Only treat a dir as an agent if at least one convention file exists.
      const hasClaude = fs.existsSync(claudePath)
      const hasOutcome = fs.existsSync(outcomePath)
      if (!hasClaude && !hasOutcome) continue
      if (!hasClaude || !hasOutcome) {
        throw new Error(
          `[internal] malformed file agent at ${dir}: both CLAUDE.md and OUTCOME.md are required`,
        )
      }
      const agent = parseAgentMarkdown(fs.readFileSync(claudePath, 'utf8'))
      if (!agent) {
        throw new Error(`[internal] malformed CLAUDE.md at ${dir}: missing id/label/description`)
      }
      const outcome = parseOutcomeMarkdown(fs.readFileSync(outcomePath, 'utf8'))
      if (!outcome) {
        throw new Error(`[internal] malformed OUTCOME.md at ${dir}: missing kind or JSON-Schema block`)
      }
      if (seenIds.has(agent.id!)) continue
      seenIds.add(agent.id!)
      discovered.push({
        moduleId,
        dir,
        id: agent.id!,
        label: agent.label!,
        description: agent.description!,
        instructions: agent.instructions,
        resultKind: outcome.kind,
        outcomeSchema: outcome.schema,
        tools: agent.tools,
        skills: agent.skills,
        subAgents: agent.subAgents,
        openCodeAgentName: sanitizeAgentName(agent.id!),
        maxSteps: agent.maxSteps,
        provider: agent.provider,
        model: agent.model,
      })
    }
  }

  return {
    id: 'registry.agent-files',
    outputFiles: [],
    scanModule(ctx: ModuleScanContext) {
      if (!repoRoot) {
        repoRoot = findRepoRoot(ctx.roots.pkgBase) ?? findRepoRoot(ctx.roots.appBase)
      }
      const pkgScanBase = resolveStandaloneSourceMirrorBase(ctx.roots.pkgBase) ?? ctx.roots.pkgBase
      scanAgentsTree(ctx.moduleId, path.join(pkgScanBase, 'agents'))
      scanAgentsTree(ctx.moduleId, path.join(ctx.roots.appBase, 'agents'))
    },
    generateOutput() {
      const sorted = [...discovered].sort((a, b) => a.id.localeCompare(b.id))

      if (!repoRoot) {
        // No module roots resolved to a repo (e.g. an isolated unit test). Skip
        // the fs side effect; the empty-Map return keeps the contract intact.
        return new Map<string, string>()
      }

      const manifestPath = path.join(
        repoRoot,
        'packages',
        'core',
        'src',
        'modules',
        'agent_orchestrator',
        'generated',
        'file-agents.generated.ts',
      )
      fs.mkdirSync(path.dirname(manifestPath), { recursive: true })
      fs.writeFileSync(manifestPath, renderManifest(sorted), 'utf8')

      const dockerAgentsDir = path.join(repoRoot, 'docker', 'opencode', 'agents')
      fs.mkdirSync(dockerAgentsDir, { recursive: true })
      const desiredFiles = new Map<string, string>()
      for (const agent of sorted) {
        desiredFiles.set(`${agent.openCodeAgentName}.md`, renderOpenCodeAgentFile(agent))
      }
      // Idempotent: remove stale generated agent files, write the current set.
      for (const existing of fs.existsSync(dockerAgentsDir) ? fs.readdirSync(dockerAgentsDir) : []) {
        if (existing.endsWith('.md') && !desiredFiles.has(existing)) {
          fs.rmSync(path.join(dockerAgentsDir, existing))
        }
      }
      for (const [fileName, content] of desiredFiles) {
        fs.writeFileSync(path.join(dockerAgentsDir, fileName), content, 'utf8')
      }

      return new Map<string, string>()
    },
  }
}
