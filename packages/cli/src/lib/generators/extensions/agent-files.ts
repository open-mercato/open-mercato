import fs from 'node:fs'
import path from 'node:path'
import type { GeneratorExtension, ModuleScanContext } from '../extension'
import { resolveStandaloneSourceMirrorBase } from '../scanner'

/**
 * Generator extension for the `agents/<id>/` file-defined-agent convention
 * (AGENT.md + OUTCOME.md). For every enabled module it scans the module's
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
 * Generation FAILS (throws) on any malformed AGENT.md/OUTCOME.md/SKILL.md,
 * naming the offending dir (spec §9). The CLI does not depend on
 * `@open-mercato/core`, so the small AGENT.md/OUTCOME.md/SKILL.md parsers are
 * reimplemented here; they MUST stay in sync with
 * `lib/sdk/{agentMarkdown,skillMarkdown,defineFileAgent}.ts`.
 *
 * Phase 3 also emits NATIVE OpenCode skill files under `docker/opencode/skills/`
 * (frontmatter `name` sanitized to `^[a-z0-9]+(-[a-z0-9]+)*$`, `description`
 * required, body = skill instructions) and unions skill-contributed read-only
 * tools into the agent allowlist (manifest + docker agent-file `tools` block).
 */

/** One sandboxed script carried as plain data (Phase 5). */
type DiscoveredScript = {
  name: string
  source: string
}

type DiscoveredSkill = {
  /** Skill id: frontmatter `id` or, when absent, the skill dir name. */
  id: string
  description: string
  instructions: string
  template?: string
  examples: string[]
  tools: string[]
  /** Sandboxed helper scripts (`scripts/*.ts`), Phase 5. */
  scripts: DiscoveredScript[]
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
  /** OUTCOME.md prose after the JSON-Schema fence — injected into the agent prompt. */
  outcomeProse: string
  /** Effective allowlist: AGENT.md tools ∪ skill-contributed read-only tools. */
  tools: string[]
  skills: string[]
  subAgents: string[]
  openCodeAgentName: string
  /** Resolved agent-local skill content (Phase 3). */
  skillsContent: DiscoveredSkill[]
  /**
   * Resolved sub-agents under `sub-agents/<subid>/` (Phase 4). Each is a full
   * file agent, constrained to informative + non-delegating. Empty for a
   * sub-agent itself (depth cap = 1) and for primaries with no sub-agents.
   */
  subAgentsContent: DiscoveredAgent[]
  /** `'primary'` (default) or `'subagent'` for a discovered sub-agent. */
  mode: 'primary' | 'subagent'
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
): { kind: 'informative' | 'actionable'; schema: Record<string, unknown>; prose: string } | null {
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
  const prose = body.slice(fenceMatch.index + fenceMatch[0].length).trim()
  return { kind, schema: parsed as Record<string, unknown>, prose }
}

// Keep in sync with `agent_orchestrator/lib/sdk/outcomeSchema.ts` (the CLI cannot
// import @open-mercato/core). Mirrors `jsonSchemaToZod`'s supported subset so a
// schema that parses as JSON but could NOT compile to Zod fails generation LOUDLY
// here, instead of parsing fine and being silently dropped at load time (M2).
const OUTCOME_UNSUPPORTED_KEYWORDS = [
  'oneOf', 'anyOf', 'allOf', 'not', '$ref', 'format', 'patternProperties', 'pattern',
  'additionalItems', 'propertyNames', 'if', 'then', 'else',
] as const
const OUTCOME_SUPPORTED_TYPES = ['object', 'array', 'string', 'number', 'integer', 'boolean']

/** Throw (failing `yarn generate`) when an OUTCOME schema node is outside the supported subset. */
function assertOutcomeSchemaSupported(node: unknown, where: string, path = '$'): void {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) {
    throw new Error(`[internal] malformed OUTCOME.md at ${where}: schema node at ${path} must be an object`)
  }
  const schema = node as Record<string, unknown>
  for (const keyword of OUTCOME_UNSUPPORTED_KEYWORDS) {
    if (keyword in schema) {
      throw new Error(`[internal] malformed OUTCOME.md at ${where}: unsupported keyword "${keyword}" at ${path}`)
    }
  }
  if ('const' in schema) return
  const type = schema.type
  if (typeof type !== 'string' || !OUTCOME_SUPPORTED_TYPES.includes(type)) {
    throw new Error(`[internal] malformed OUTCOME.md at ${where}: missing/unsupported "type" at ${path}`)
  }
  if (type === 'object' && schema.properties != null) {
    if (typeof schema.properties !== 'object' || schema.properties === null || Array.isArray(schema.properties)) {
      throw new Error(`[internal] malformed OUTCOME.md at ${where}: "properties" at ${path} must be an object`)
    }
    for (const [key, child] of Object.entries(schema.properties as Record<string, unknown>)) {
      assertOutcomeSchemaSupported(child, where, `${path}.${key}`)
    }
  }
  if (type === 'array') {
    if (schema.items == null) {
      throw new Error(`[internal] malformed OUTCOME.md at ${where}: array at ${path} requires "items"`)
    }
    assertOutcomeSchemaSupported(schema.items, where, `${path}[]`)
  }
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
 * Basic parse validation of a script source (Phase 5). The script runs in the
 * `isolated-vm` sandbox server-side (never copied to the container), so we only
 * cheaply assert it defines a `run` function — a missing `run` would fail at
 * runtime, so we fail generation early naming the file. We do NOT execute it.
 */
function validateScriptSource(file: string, source: string): void {
  const definesRun = /(^|\b)(async\s+)?function\s+run\b/.test(source) || /\brun\s*=/.test(source)
  if (!definesRun) {
    throw new Error(
      `[internal] malformed agent script at ${file}: must define a \`run(args)\` function`,
    )
  }
}

/**
 * Read sandboxed scripts from a `scripts/` dir (`*.ts` / `*.js`), Phase 5. Each
 * file's basename (no extension) is the script name; the raw source is carried
 * as plain data. Validates each parses (basic). Ordered by filename.
 */
function listScripts(scriptsDir: string): DiscoveredScript[] {
  if (!fs.existsSync(scriptsDir) || !fs.statSync(scriptsDir).isDirectory()) return []
  const scripts: DiscoveredScript[] = []
  for (const name of fs
    .readdirSync(scriptsDir)
    .filter((entry) => entry.endsWith('.ts') || entry.endsWith('.js'))
    .sort((a, b) => a.localeCompare(b))) {
    const file = path.join(scriptsDir, name)
    const source = fs.readFileSync(file, 'utf8')
    validateScriptSource(file, source)
    scripts.push({ name: name.replace(/\.(ts|js)$/, ''), source })
  }
  return scripts
}

/** Synthetic skill id under which an agent's LOCAL sandboxed tool files register. */
const AGENT_TOOLS_SKILL_ID = '__agent_tools__'
const TOOL_REF_RE = /^\s*\/\/\s*@ref:?\s+(\S+)/

/**
 * Discover `agents/<id>/tools/*.ts` local tool files (Phase 5). Reference-form
 * files (first line `// @ref <defineAiTool id>`) contribute the id to `refs`
 * (unioned into the allowlist, flows through the central ACL + propose-only
 * gate). Any other file is a LOCAL sandboxed tool: carried as a script run via
 * `run_skill_script` under the synthetic `__agent_tools__` skill. Must stay in
 * sync with `lib/sdk/defineFileAgent.ts` `loadToolFiles`.
 */
function discoverToolFiles(agentDir: string): { refs: string[]; scripts: DiscoveredScript[] } {
  const toolsBase = path.join(agentDir, 'tools')
  if (!fs.existsSync(toolsBase) || !fs.statSync(toolsBase).isDirectory()) {
    return { refs: [], scripts: [] }
  }
  const refs: string[] = []
  const scripts: DiscoveredScript[] = []
  for (const name of fs
    .readdirSync(toolsBase)
    .filter((entry) => entry.endsWith('.ts') || entry.endsWith('.js'))
    .sort((a, b) => a.localeCompare(b))) {
    const file = path.join(toolsBase, name)
    const source = fs.readFileSync(file, 'utf8')
    const firstLine = source.split('\n', 1)[0] ?? ''
    const refMatch = TOOL_REF_RE.exec(firstLine)
    if (refMatch) {
      refs.push(refMatch[1])
      continue
    }
    validateScriptSource(file, source)
    scripts.push({ name: name.replace(/\.(ts|js)$/, ''), source })
  }
  return { refs, scripts }
}

/**
 * Discover the agent's referenced skills under `agents/<id>/skills/<skill_id>/`.
 * For each id in AGENT.md `skills:` we look up the matching dir (by frontmatter
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
      scripts: listScripts(path.join(skillDir, 'scripts')),
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

/**
 * Discover and validate the sub-agents under `agents/<id>/sub-agents/<subid>/`
 * (Phase 4). Each is a full file agent (AGENT.md + OUTCOME.md) constrained to:
 *   1. OUTCOME `kind: informative` (sub-agents inform; only the primary proposes);
 *   2. NO `subAgents` of its own (depth cap = 1).
 * FAILS generation (throws, naming the dir) on a malformed sub-agent OR a
 * constraint violation — in sync with `lib/sdk/defineFileAgent.ts` `loadSubAgentDir`.
 */
function discoverSubAgents(agentDir: string): DiscoveredAgent[] {
  const base = path.join(agentDir, 'sub-agents')
  if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) return []
  const subAgents: DiscoveredAgent[] = []
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '__tests__') continue
    const dir = path.join(base, entry.name)
    const agentMdPath = path.join(dir, 'AGENT.md')
    const outcomePath = path.join(dir, 'OUTCOME.md')
    if (!fs.existsSync(agentMdPath) || !fs.existsSync(outcomePath)) {
      throw new Error(
        `[internal] malformed sub-agent at ${dir}: both AGENT.md and OUTCOME.md are required`,
      )
    }
    const agent = parseAgentMarkdown(fs.readFileSync(agentMdPath, 'utf8'))
    if (!agent) {
      throw new Error(`[internal] malformed AGENT.md at ${dir}: missing id/label/description`)
    }
    const outcome = parseOutcomeMarkdown(fs.readFileSync(outcomePath, 'utf8'))
    if (!outcome) {
      throw new Error(`[internal] malformed OUTCOME.md at ${dir}: missing kind or JSON-Schema block`)
    }
    assertOutcomeSchemaSupported(outcome.schema, dir)
    if (outcome.kind !== 'informative') {
      throw new Error(
        `[internal] sub-agent at ${dir} must be informative (kind: informative); only the primary proposes`,
      )
    }
    if (agent.subAgents.length > 0) {
      throw new Error(
        `[internal] sub-agent at ${dir} may not declare subAgents (depth cap = 1); sub-agents may not delegate further`,
      )
    }
    const skillsContent = discoverAgentSkills(dir, agent.skills)
    const skillTools = skillsContent.flatMap((skill) => skill.tools)
    const toolFiles = discoverToolFiles(dir)
    const effectiveSkillsContent =
      toolFiles.scripts.length > 0
        ? [
            ...skillsContent,
            {
              id: AGENT_TOOLS_SKILL_ID,
              description: '',
              instructions: '',
              examples: [],
              tools: [],
              scripts: toolFiles.scripts,
              openCodeSkillName: sanitizeSkillName(AGENT_TOOLS_SKILL_ID),
            },
          ]
        : skillsContent
    const effectiveTools = Array.from(
      new Set([...agent.tools, ...skillTools, ...toolFiles.refs]),
    )
    subAgents.push({
      moduleId: '',
      dir,
      id: agent.id!,
      label: agent.label!,
      description: agent.description!,
      instructions: agent.instructions,
      resultKind: outcome.kind,
      outcomeSchema: outcome.schema,
      outcomeProse: outcome.prose,
      tools: effectiveTools,
      skills: agent.skills,
      subAgents: [],
      openCodeAgentName: sanitizeAgentName(agent.id!),
      skillsContent: effectiveSkillsContent,
      subAgentsContent: [],
      mode: 'subagent',
      maxSteps: agent.maxSteps,
      provider: agent.provider,
      model: agent.model,
    })
  }
  return subAgents
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

/** Built-in OpenCode delegation tool a primary agent uses to fan out to sub-agents. */
const TASK_TOOL_NAME = 'task'

// OpenCode names every MCP tool `<serverKey>_<toolName with dots→underscores>`
// (verified against the running image). Keep in sync with
// `lib/sdk/defineFileAgent.ts`.
const OPENCODE_MCP_SERVER_KEY = 'open-mercato'
const CORE_FILE_AGENT_TOOL_IDS = [
  'agent_orchestrator.submit_outcome',
  'agent_orchestrator.load_skill',
  'agent_orchestrator.run_skill_script',
]
function toOpenCodeMcpToolId(omToolId: string): string {
  return `${OPENCODE_MCP_SERVER_KEY}_${omToolId.replace(/\./g, '_')}`
}

/**
 * Render an OpenCode agent .md file. Must stay in sync with
 * `lib/sdk/defineFileAgent.ts` `renderOpenCodeAgentFile`. Sub-agent files
 * (`mode: subagent`) get NO `task` allowance and `permission.task: deny` (depth
 * cap = 1). A primary that declares sub-agents allows the built-in `task` tool,
 * whitelists ONLY its sub-agents' sanitized names under `permission.task`, and
 * gains a "Sub-agents" prompt section nudging parallel fan-out.
 */
function renderOpenCodeAgentFile(agent: DiscoveredAgent): string {
  const subAgentNames =
    agent.mode === 'primary' ? agent.subAgentsContent.map((sub) => sub.openCodeAgentName) : []
  const hasSubAgents = subAgentNames.length > 0
  const omMcpToolIds = Array.from(new Set([...agent.tools, ...CORE_FILE_AGENT_TOOL_IDS]))
  const allowedTools = [
    ...omMcpToolIds.map(toOpenCodeMcpToolId),
    ...(hasSubAgents ? [TASK_TOOL_NAME] : []),
  ]
  const modelLine =
    agent.provider && agent.model
      ? `model: ${agent.provider}/${agent.model}`
      : agent.model
        ? `model: ${agent.model}`
        : null
  const taskPermissionLines = hasSubAgents
    ? ['  task:', '    "*": deny', ...subAgentNames.map((name) => `    ${JSON.stringify(name)}: allow`)]
    : ['  task: deny']
  const frontmatterLines = [
    '---',
    `description: ${JSON.stringify(agent.description)}`,
    ...(modelLine ? [modelLine] : []),
    `mode: ${agent.mode}`,
    'tools:',
    '  "*": false',
    ...allowedTools.map(renderToolPermissionLine),
    'permission:',
    '  write: deny',
    '  edit: deny',
    '  bash: deny',
    ...taskPermissionLines,
    '---',
  ]
  const terminalInstruction =
    `Finish by calling the \`${toOpenCodeMcpToolId('agent_orchestrator.submit_outcome')}\` tool with a value matching the outcome contract (pass it as the \`outcome\` argument). You MUST call the tool — do not answer in prose or emit the result as a code block.`
  const subAgentSection = hasSubAgents
    ? `## Sub-agents\nYou may delegate independent read-only sub-tasks to these sub-agents by calling the \`task\` tool. When several sub-tasks are independent, issue multiple \`task\` calls in the SAME step so they run in parallel, then combine their results before submitting your outcome. Available sub-agents: ${subAgentNames.join(', ')}.`
    : null
  // Inject the OUTCOME contract so the agent SEES the exact shape it must submit
  // (otherwise it guesses and learns the shape only from validation errors). Keep
  // in sync with lib/sdk/defineFileAgent.ts renderOutcomeSection.
  const outcomeTarget = agent.resultKind === 'actionable' ? 'the `proposal` object' : 'the `data` object'
  const outcomeSection = [
    '## Outcome contract',
    `Your result MUST match this JSON Schema (${outcomeTarget}). Pass it as the \`outcome\` argument of the submit_outcome tool, as a JSON object (not a string):`,
    '',
    '```json',
    JSON.stringify(agent.outcomeSchema, null, 2),
    '```',
    ...(agent.outcomeProse ? ['', agent.outcomeProse] : []),
  ].join('\n')
  const body = [
    agent.instructions.trim(),
    ...(subAgentSection ? [subAgentSection] : []),
    outcomeSection,
    terminalInstruction,
  ]
    .filter(Boolean)
    .join('\n\n')
  return `${frontmatterLines.join('\n')}\n${body}\n`
}

/**
 * Render one agent descriptor as a key-per-line object literal at `indent`.
 * Used for both top-level agents and nested sub-agents (Phase 4). A primary that
 * declares sub-agents emits them as a nested `subAgentDescriptors` array so
 * `ensureAgentsLoaded` can register each sub-agent too (informative, individually
 * runnable file agents). A nested sub-agent carries no `subAgentDescriptors`
 * (depth cap = 1).
 */
function renderDescriptor(agent: DiscoveredAgent, indent: string): string {
  const optional: string[] = []
  if (agent.subAgentsContent.length > 0) {
    const nested = agent.subAgentsContent
      .map((sub) => renderDescriptor(sub, `${indent}  `))
      .join('\n')
    optional.push(`${indent}  subAgentDescriptors: [\n${nested}\n${indent}  ],`)
  }
  if (agent.maxSteps != null) optional.push(`${indent}  maxSteps: ${agent.maxSteps},`)
  if (agent.provider != null) optional.push(`${indent}  provider: ${JSON.stringify(agent.provider)},`)
  if (agent.model != null) optional.push(`${indent}  model: ${JSON.stringify(agent.model)},`)
  const skillsContent = agent.skillsContent.map((skill) => ({
    id: skill.id,
    instructions: skill.instructions,
    ...(skill.template != null ? { template: skill.template } : {}),
    examples: skill.examples,
    tools: skill.tools,
    ...(skill.scripts.length > 0 ? { scripts: skill.scripts } : {}),
  }))
  return [
    `${indent}{`,
    `${indent}  id: ${JSON.stringify(agent.id)},`,
    `${indent}  moduleId: ${JSON.stringify(agent.moduleId)},`,
    `${indent}  label: ${JSON.stringify(agent.label)},`,
    `${indent}  description: ${JSON.stringify(agent.description)},`,
    `${indent}  instructions: ${JSON.stringify(agent.instructions)},`,
    `${indent}  resultKind: ${JSON.stringify(agent.resultKind)},`,
    `${indent}  outcomeSchema: ${JSON.stringify(agent.outcomeSchema)},`,
    `${indent}  tools: ${JSON.stringify(agent.tools)},`,
    `${indent}  skills: ${JSON.stringify(agent.skills)},`,
    `${indent}  subAgents: ${JSON.stringify(agent.subAgents)},`,
    `${indent}  openCodeAgentName: ${JSON.stringify(agent.openCodeAgentName)},`,
    `${indent}  skillsContent: ${JSON.stringify(skillsContent)},`,
    ...optional,
    `${indent}},`,
  ].join('\n')
}

function renderManifest(agents: DiscoveredAgent[]): string {
  const descriptors = agents.map((agent) => renderDescriptor(agent, '  ')).join('\n')

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

export type FileAgentScript = {
  name: string
  source: string
}

export type FileAgentSkillContent = {
  id: string
  instructions: string
  template?: string
  examples: string[]
  tools: string[]
  /**
   * Sandboxed helper scripts (Phase 5). Carried as plain source; run server-side
   * in the Code Mode \`isolated-vm\` sandbox via the \`run_skill_script\` MCP tool.
   * Never copied to the OpenCode container. The synthetic skill id
   * \`__agent_tools__\` carries an agent's LOCAL \`tools/*.ts\` sources.
   */
  scripts?: FileAgentScript[]
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
  /**
   * Nested descriptors for this agent's sub-agents (Phase 4). Each is an
   * informative, non-delegating file agent registered individually (depth cap =
   * 1). Absent for agents without sub-agents and for sub-agents themselves.
   */
  subAgentDescriptors?: FileAgentDescriptor[]
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
      const agentMdPath = path.join(dir, 'AGENT.md')
      const outcomePath = path.join(dir, 'OUTCOME.md')
      // Only treat a dir as an agent if at least one convention file exists.
      const hasAgentMd = fs.existsSync(agentMdPath)
      const hasOutcome = fs.existsSync(outcomePath)
      if (!hasAgentMd && !hasOutcome) continue
      if (!hasAgentMd || !hasOutcome) {
        throw new Error(
          `[internal] malformed file agent at ${dir}: both AGENT.md and OUTCOME.md are required`,
        )
      }
      const agent = parseAgentMarkdown(fs.readFileSync(agentMdPath, 'utf8'))
      if (!agent) {
        throw new Error(`[internal] malformed AGENT.md at ${dir}: missing id/label/description`)
      }
      const outcome = parseOutcomeMarkdown(fs.readFileSync(outcomePath, 'utf8'))
      if (!outcome) {
        throw new Error(`[internal] malformed OUTCOME.md at ${dir}: missing kind or JSON-Schema block`)
      }
      assertOutcomeSchemaSupported(outcome.schema, dir)
      // The id is the registry/dup key AND the OpenCode `agent` message field —
      // constrain it to a safe charset (module.entity-style: lowercase alnum + . _ -).
      if (!/^[a-z0-9][a-z0-9._-]*$/.test(agent.id!)) {
        throw new Error(
          `[internal] invalid agent id "${agent.id}" at ${dir}: use lowercase [a-z0-9._-] (e.g. "module.agent")`,
        )
      }
      if (seenIds.has(agent.id!)) {
        // Surface accidental collisions at generate time instead of silently
        // dropping the later agent (the registry would only skip it at load).
        console.warn(`[internal] duplicate file-agent id "${agent.id}" at ${dir}; keeping the first, skipping this one.`)
        continue
      }
      seenIds.add(agent.id!)
      // Phase 3: resolve agent-local skills and UNION their read-only tools into
      // the agent allowlist (deduped), matching the loader.
      const skillsContent = discoverAgentSkills(dir, agent.skills)
      const skillTools = skillsContent.flatMap((skill) => skill.tools)
      // Phase 5: local tool files — reference ids union into the allowlist; local
      // sandboxed tool sources register under the synthetic `__agent_tools__` skill.
      const toolFiles = discoverToolFiles(dir)
      const effectiveSkillsContent =
        toolFiles.scripts.length > 0
          ? [
              ...skillsContent,
              {
                id: AGENT_TOOLS_SKILL_ID,
                description: '',
                instructions: '',
                examples: [],
                tools: [],
                scripts: toolFiles.scripts,
                openCodeSkillName: sanitizeSkillName(AGENT_TOOLS_SKILL_ID),
              },
            ]
          : skillsContent
      const effectiveTools = Array.from(
        new Set([...agent.tools, ...skillTools, ...toolFiles.refs]),
      )
      // Phase 4: discover + validate sub-agents (throws on a malformed/actionable/
      // self-delegating sub-agent).
      const subAgentsContent = discoverSubAgents(dir)
      discovered.push({
        moduleId,
        dir,
        id: agent.id!,
        label: agent.label!,
        description: agent.description!,
        instructions: agent.instructions,
        resultKind: outcome.kind,
        outcomeSchema: outcome.schema,
        outcomeProse: outcome.prose,
        tools: effectiveTools,
        skills: agent.skills,
        subAgents: agent.subAgents,
        openCodeAgentName: sanitizeAgentName(agent.id!),
        skillsContent: effectiveSkillsContent,
        subAgentsContent,
        mode: 'primary',
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
        // Phase 4: emit each sub-agent as its own `mode: subagent` file so
        // OpenCode can reach it via the primary's whitelisted `task` tool.
        for (const sub of agent.subAgentsContent) {
          desiredFiles.set(`${sub.openCodeAgentName}.md`, renderOpenCodeAgentFile(sub))
        }
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
      // remove stale skill dirs not in the current desired set. Sub-agents
      // (Phase 4) may carry their own skills too, so flatten them in.
      const allAgents = sorted.flatMap((agent) => [agent, ...agent.subAgentsContent])
      const dockerSkillsDir = path.join(repoRoot, 'docker', 'opencode', 'skills')
      // The synthetic `__agent_tools__` skill only carries an agent's local
      // `tools/*.ts` sources (run via `run_skill_script`); it has no instructions
      // and MUST NOT be emitted as a native OpenCode skill (OpenCode requires a
      // non-empty `description`, and it is not a progressive-disclosure skill).
      const isNativeSkill = (skill: { id: string }): boolean => skill.id !== AGENT_TOOLS_SKILL_ID
      const desiredSkillNames = new Set<string>()
      for (const agent of allAgents) {
        for (const skill of agent.skillsContent) {
          if (isNativeSkill(skill)) desiredSkillNames.add(skill.openCodeSkillName)
        }
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
      for (const agent of allAgents) {
        for (const skill of agent.skillsContent) {
          if (!isNativeSkill(skill)) continue
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
