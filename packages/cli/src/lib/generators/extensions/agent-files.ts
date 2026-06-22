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
 * Generation FAILS (throws) on any malformed CLAUDE.md/OUTCOME.md/SKILL.md,
 * naming the offending dir (spec §9). The CLI does not depend on
 * `@open-mercato/core`, so the small CLAUDE.md/OUTCOME.md/SKILL.md parsers are
 * reimplemented here; they MUST stay in sync with
 * `lib/sdk/{agentMarkdown,skillMarkdown,defineFileAgent}.ts`.
 *
 * Phase 3 also emits NATIVE OpenCode skill files under `docker/opencode/skills/`
 * (frontmatter `name` sanitized to `^[a-z0-9]+(-[a-z0-9]+)*$`, `description`
 * required, body = skill instructions) and unions skill-contributed read-only
 * tools into the agent allowlist (manifest + docker agent-file `tools` block).
 */

type DiscoveredSkill = {
  /** Skill id: frontmatter `id` or, when absent, the skill dir name. */
  id: string
  description: string
  instructions: string
  template?: string
  examples: string[]
  tools: string[]
  /** OpenCode native skill name (sanitized to ^[a-z0-9]+(-[a-z0-9]+)*$). */
  openCodeSkillName: string
}

type DiscoveredAgent = {
  moduleId: string
  dir: string
  id: string
  label: string
  description: string
  instructions: string
  resultKind: 'informative' | 'actionable'
  outcomeSchema: Record<string, unknown>
  /** Effective allowlist: CLAUDE.md tools ∪ skill-contributed read-only tools. */
  tools: string[]
  skills: string[]
  subAgents: string[]
  openCodeAgentName: string
  /** Resolved agent-local skill content (Phase 3). */
  skillsContent: DiscoveredSkill[]
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

/**
 * Sanitize a skill id into an OpenCode native skill `name`, which must match
 * `^[a-z0-9]+(-[a-z0-9]+)*$`: lowercase, underscores/dots/spaces → hyphens,
 * any other char → hyphen, collapse runs, trim leading/trailing hyphens. Must
 * stay in sync with the loader's interpretation of skill ids.
 */
function sanitizeSkillName(id: string): string {
  const name = id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
  return name || 'skill'
}

type SkillFrontmatter = {
  id?: string
  label?: string
  description?: string
  tools: string[]
}

/**
 * Parse an agent-local SKILL.md frontmatter (in sync with
 * `lib/sdk/skillMarkdown.ts`). Agent-local skills may omit `moduleId` and `id`
 * (the dir name is then authoritative); only a parseable frontmatter block is
 * required. Returns null when there is no frontmatter block.
 */
function parseSkillMarkdown(raw: string): { meta: SkillFrontmatter; body: string } | null {
  const match = FRONTMATTER_RE.exec(raw)
  if (!match) return null
  const [, frontmatterBlock, body] = match
  const meta: SkillFrontmatter = { tools: [] }
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
    if (key === 'tools') {
      if (rawValue.startsWith('[')) {
        meta.tools = parseInlineList(rawValue)
        index += 1
        continue
      }
      const items: string[] = []
      index += 1
      while (index < lines.length && /^\s*-\s+/.test(lines[index])) {
        items.push(stripQuotes(lines[index].replace(/^\s*-\s+/, '')))
        index += 1
      }
      meta.tools = items.filter(Boolean)
      continue
    }
    if (key === 'id' || key === 'label' || key === 'description') {
      meta[key] = stripQuotes(rawValue)
    }
    index += 1
  }
  return { meta, body: body.trim() }
}

function listExampleBodies(skillDir: string): string[] {
  const examplesDir = path.join(skillDir, 'examples')
  if (!fs.existsSync(examplesDir) || !fs.statSync(examplesDir).isDirectory()) return []
  return fs
    .readdirSync(examplesDir)
    .filter((name) => name.endsWith('.md'))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => fs.readFileSync(path.join(examplesDir, name), 'utf8').trim())
    .filter(Boolean)
}

/**
 * Discover the agent's referenced skills under `agents/<id>/skills/<skill_id>/`.
 * For each id in CLAUDE.md `skills:` we look up the matching dir (by frontmatter
 * id or dir name). FAILS generation when a referenced SKILL.md is malformed
 * (present dir but unparseable frontmatter). A referenced id with no dir is
 * skipped (the loader warns identically at runtime).
 */
function discoverAgentSkills(agentDir: string, skillIds: string[]): DiscoveredSkill[] {
  if (skillIds.length === 0) return []
  const skillsBase = path.join(agentDir, 'skills')
  if (!fs.existsSync(skillsBase) || !fs.statSync(skillsBase).isDirectory()) return []

  const bySkillId = new Map<string, DiscoveredSkill>()
  for (const entry of fs.readdirSync(skillsBase, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const skillDir = path.join(skillsBase, entry.name)
    const skillPath = path.join(skillDir, 'SKILL.md')
    if (!fs.existsSync(skillPath)) continue
    const parsed = parseSkillMarkdown(fs.readFileSync(skillPath, 'utf8'))
    if (!parsed) {
      throw new Error(`[internal] malformed SKILL.md at ${skillDir}: missing frontmatter block`)
    }
    const id = parsed.meta.id || entry.name
    const templatePath = path.join(skillDir, 'TEMPLATE.md')
    const template = fs.existsSync(templatePath)
      ? fs.readFileSync(templatePath, 'utf8').trim() || undefined
      : undefined
    bySkillId.set(id, {
      id,
      description: parsed.meta.description ?? '',
      instructions: parsed.body,
      template,
      examples: listExampleBodies(skillDir),
      tools: parsed.meta.tools,
      openCodeSkillName: sanitizeSkillName(id),
    })
  }

  const resolved: DiscoveredSkill[] = []
  for (const skillId of skillIds) {
    const skill = bySkillId.get(skillId)
    if (skill) resolved.push(skill)
  }
  return resolved
}

function renderOpenCodeSkillFile(skill: DiscoveredSkill): string {
  const frontmatter = [
    '---',
    `name: ${skill.openCodeSkillName}`,
    `description: ${JSON.stringify(skill.description)}`,
    '---',
  ]
  return `${frontmatter.join('\n')}\n${skill.instructions.trim()}\n`
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
      const skillsContent = agent.skillsContent.map((skill) => ({
        id: skill.id,
        instructions: skill.instructions,
        ...(skill.template != null ? { template: skill.template } : {}),
        examples: skill.examples,
        tools: skill.tools,
      }))
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
        `    skillsContent: ${JSON.stringify(skillsContent)},`,
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

export type FileAgentSkillContent = {
  id: string
  instructions: string
  template?: string
  examples: string[]
  tools: string[]
}

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
  skillsContent?: FileAgentSkillContent[]
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
      // Phase 3: resolve agent-local skills and UNION their read-only tools into
      // the agent allowlist (deduped), matching the loader.
      const skillsContent = discoverAgentSkills(dir, agent.skills)
      const skillTools = skillsContent.flatMap((skill) => skill.tools)
      const effectiveTools = Array.from(new Set([...agent.tools, ...skillTools]))
      discovered.push({
        moduleId,
        dir,
        id: agent.id!,
        label: agent.label!,
        description: agent.description!,
        instructions: agent.instructions,
        resultKind: outcome.kind,
        outcomeSchema: outcome.schema,
        tools: effectiveTools,
        skills: agent.skills,
        subAgents: agent.subAgents,
        openCodeAgentName: sanitizeAgentName(agent.id!),
        skillsContent,
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

      // Phase 3: emit NATIVE OpenCode skill files (one dir per skill name) under
      // `docker/opencode/skills/<sanitized-skill-name>/SKILL.md`. Idempotent:
      // remove stale skill dirs not in the current desired set.
      const dockerSkillsDir = path.join(repoRoot, 'docker', 'opencode', 'skills')
      const desiredSkillNames = new Set<string>()
      for (const agent of sorted) {
        for (const skill of agent.skillsContent) desiredSkillNames.add(skill.openCodeSkillName)
      }
      if (desiredSkillNames.size > 0) fs.mkdirSync(dockerSkillsDir, { recursive: true })
      if (fs.existsSync(dockerSkillsDir)) {
        for (const existing of fs.readdirSync(dockerSkillsDir, { withFileTypes: true })) {
          if (existing.isDirectory() && !desiredSkillNames.has(existing.name)) {
            fs.rmSync(path.join(dockerSkillsDir, existing.name), { recursive: true, force: true })
          }
        }
      }
      const renderedSkillNames = new Set<string>()
      for (const agent of sorted) {
        for (const skill of agent.skillsContent) {
          // A skill name may be shared across agents; the first rendering wins
          // (content is keyed by name, deterministic by sorted agent order).
          if (renderedSkillNames.has(skill.openCodeSkillName)) continue
          renderedSkillNames.add(skill.openCodeSkillName)
          const skillDir = path.join(dockerSkillsDir, skill.openCodeSkillName)
          fs.mkdirSync(skillDir, { recursive: true })
          fs.writeFileSync(path.join(skillDir, 'SKILL.md'), renderOpenCodeSkillFile(skill), 'utf8')
        }
      }

      return new Map<string, string>()
    },
  }
}
