import fs from 'node:fs'
import path from 'node:path'
import { countTokens } from '@open-mercato/shared/lib/ai/token-count'
import type { GeneratorExtension, ModuleScanContext } from '../extension'
import { resolveStandaloneSourceMirrorBase } from '../scanner'

/**
 * Generator extension for the `agents/<id>/` file-defined-agent convention
 * (AGENT.md + OUTCOME.md). For every enabled module it scans the module's
 * `agents/` tree, validates each agent dir, and emits the committed, git-tracked
 * registry manifest under the enterprise agent orchestrator. `generateOutput()`
 * writes that manifest directly and returns an empty Map because the target lives
 * outside the app `.mercato/generated/` directory.
 *
 * Generation FAILS (throws) on any malformed AGENT.md/OUTCOME.md/SKILL.md,
 * naming the offending dir (spec §9). The CLI does not depend on
 * `@open-mercato/core`, so the small AGENT.md/OUTCOME.md/SKILL.md parsers are
 * reimplemented here; they MUST stay in sync with
 * `lib/sdk/{agentMarkdown,skillMarkdown,defineFileAgent}.ts`.
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
}

type DiscoveredAgent = {
  moduleId: string
  dir: string
  id: string
  label: string
  description: string
  instructions: string
  resultKind: 'researcher' | 'proposal'
  outcomeSchema: Record<string, unknown>
  /** Effective allowlist: AGENT.md tools ∪ skill-contributed read-only tools. */
  tools: string[]
  skills: string[]
  subAgents: string[]
  /** Resolved agent-local skill content (Phase 3). */
  skillsContent: DiscoveredSkill[]
  /**
   * Resolved sub-agents under `sub-agents/<subid>/` (Phase 4). Each is a full
   * file agent, constrained to researcher + non-delegating. Empty for a
   * sub-agent itself (depth cap = 1) and for primaries with no sub-agents.
   */
  subAgentsContent: DiscoveredAgent[]
  maxSteps?: number
  provider?: string
  model?: string
  /** Optional `SAMPLE.json` example input for the Playground "Insert sample" button. */
  sampleInput?: unknown
  /** Optional `FACTS.json` declarations driving the Caseload facts panel. */
  facts?: DiscoveredFact[]
  /** Baked token-usage breakdown of the agent's construction files (Phase: token accounting). */
  tokenUsage: FileAgentTokenUsage
  /** Baked raw content of every construction file, for the read-only Files tab (#12 files). */
  sourceFiles: FileAgentSourceFile[]
}

/**
 * Raw definition file baked into the manifest so the Files tab reads agent source
 * without runtime fs access. MIRRORS `FileAgentFile` in
 * `packages/enterprise/.../lib/tokens/types.ts` — the CLI cannot import the
 * enterprise package, so the shape is reimplemented here and MUST stay in sync.
 */
type FileAgentSourceFile = {
  path: string
  content: string
  tokens: number
  inContext: boolean
}

/**
 * Token-usage shape MIRRORED from
 * `packages/enterprise/src/modules/agent_orchestrator/lib/tokens/types.ts`. The
 * CLI cannot import `@open-mercato/enterprise`, so both the type and the walker
 * below are reimplemented here and MUST stay in sync — a parity test in the
 * enterprise module (`agent-token-usage.test.ts`) guards the numbers.
 */
type TokenizedFile = { path: string; tokens: number }
type SkillTokenUsage = { id: string; tokens: number; files: TokenizedFile[] }
type ToolTokenUsage = { name: string; path: string; tokens: number }
type SubAgentTokenUsage = { id: string; tokens: number }
type FileAgentTokenUsage = {
  total: number
  self: number
  agent: number
  outcome: number
  skills: SkillTokenUsage[]
  tools: ToolTokenUsage[]
  subAgents: SubAgentTokenUsage[]
}

type DiscoveredFact = {
  label: string
  source: 'input' | 'payload' | 'output'
  path: string
  format?: 'text' | 'number' | 'boolean' | 'percent'
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

function parseOutcomeKind(frontmatterBlock: string): 'researcher' | 'proposal' | null {
  for (const line of frontmatterBlock.split('\n')) {
    const match = /^kind:\s*(.*)$/.exec(line.trim())
    if (!match) continue
    const value = stripQuotes(match[1])
    if (value === 'researcher' || value === 'proposal') return value
    return null
  }
  return null
}

function parseOutcomeMarkdown(
  raw: string,
): { kind: 'researcher' | 'proposal'; schema: Record<string, unknown>; prose: string } | null {
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

/**
 * Read the optional `agents/<id>/SAMPLE.json` example input emitted into the
 * manifest for the Playground "Insert sample" button. Pure JSON (no markdown),
 * so a missing file is fine; a malformed one fails generation LOUDLY (naming the
 * dir) rather than being silently dropped. Must stay in sync with
 * `lib/sdk/defineFileAgent.ts` `loadSampleInput`.
 */
function discoverSampleInput(dir: string): unknown {
  const samplePath = path.join(dir, 'SAMPLE.json')
  if (!fs.existsSync(samplePath)) return undefined
  try {
    return JSON.parse(fs.readFileSync(samplePath, 'utf8'))
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`[internal] malformed SAMPLE.json at ${dir}: ${detail}`)
  }
}

const FACT_SOURCES = ['input', 'payload', 'output'] as const
const FACT_FORMATS = ['text', 'number', 'boolean', 'percent'] as const

/**
 * Read the optional `agents/<id>/FACTS.json` declarations that drive the
 * Caseload decision panel's facts grid (label + dot-path into the run input,
 * proposal payload, or run output). Accepts `{ "facts": [...] }` or a bare
 * array. A missing file is fine; a malformed one fails generation LOUDLY
 * (naming the dir). Must stay in sync with `lib/sdk/defineFileAgent.ts`
 * `loadFacts`.
 */
function discoverFacts(dir: string): DiscoveredFact[] | undefined {
  const factsPath = path.join(dir, 'FACTS.json')
  if (!fs.existsSync(factsPath)) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(factsPath, 'utf8'))
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`[internal] malformed FACTS.json at ${dir}: ${detail}`)
  }
  const entries = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { facts?: unknown }).facts)
      ? ((parsed as { facts: unknown[] }).facts)
      : null
  if (!entries) {
    throw new Error(`[internal] malformed FACTS.json at ${dir}: expected an array or { "facts": [...] }`)
  }
  return entries.map((entry, index) => {
    const fact = entry as Partial<DiscoveredFact> | null
    if (
      !fact ||
      typeof fact.label !== 'string' ||
      !fact.label.trim() ||
      typeof fact.path !== 'string' ||
      !fact.path.trim() ||
      !FACT_SOURCES.includes(fact.source as (typeof FACT_SOURCES)[number])
    ) {
      throw new Error(
        `[internal] malformed FACTS.json at ${dir}: entry ${index} needs label (string), source (${FACT_SOURCES.join('|')}), path (string)`,
      )
    }
    if (fact.format !== undefined && !FACT_FORMATS.includes(fact.format as (typeof FACT_FORMATS)[number])) {
      throw new Error(
        `[internal] malformed FACTS.json at ${dir}: entry ${index} format must be one of ${FACT_FORMATS.join('|')}`,
      )
    }
    return {
      label: fact.label.trim(),
      source: fact.source as DiscoveredFact['source'],
      path: fact.path.trim(),
      ...(fact.format !== undefined ? { format: fact.format as DiscoveredFact['format'] } : {}),
    }
  })
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
 *   1. OUTCOME `kind: researcher` (sub-agents inform; only the primary proposes);
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
    if (outcome.kind !== 'researcher') {
      throw new Error(
        `[internal] sub-agent at ${dir} must be researcher (kind: researcher); only the primary proposes`,
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
      tools: effectiveTools,
      skills: agent.skills,
      subAgents: [],
      skillsContent: effectiveSkillsContent,
      subAgentsContent: [],
      maxSteps: agent.maxSteps,
      provider: agent.provider,
      model: agent.model,
      sampleInput: discoverSampleInput(dir),
      facts: discoverFacts(dir),
      tokenUsage: discoverAgentTokenUsage(dir),
      sourceFiles: collectAgentFiles(dir),
    })
  }
  return subAgents
}

// --- Token accounting (MIRRORS lib/tokens/computeAgentTokenUsage.ts) ---

const TOKEN_TOOL_EXTENSIONS = ['.ts', '.js']

/**
 * MIRRORS `toPosixRelativePath` in lib/tokens/computeAgentTokenUsage.ts.
 *
 * These relative paths are baked into `file-agents.generated.ts` and split into
 * a folder tree in the browser, so they must be `/`-separated whatever machine
 * ran `yarn generate`. `path.join` answers with the native separator, which on
 * Windows baked backslashes into the artifact and flattened the Files tab.
 */
function toPosixRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join('/')
}

function tokenCountFile(agentDir: string, relativePath: string): TokenizedFile | null {
  const absolute = path.join(agentDir, relativePath)
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return null
  return { path: toPosixRelativePath(relativePath), tokens: countTokens(fs.readFileSync(absolute, 'utf8')) }
}

function tokenListFiles(dir: string, extensions?: string[]): string[] {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => !extensions || extensions.includes(path.extname(name)))
    .sort((a, b) => a.localeCompare(b))
}

function tokenListDirs(dir: string): string[] {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== '__tests__')
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
}

function tokenComputeSkills(agentDir: string): SkillTokenUsage[] {
  return tokenListDirs(path.join(agentDir, 'skills')).map((skillId) => {
    const skillRel = path.join('skills', skillId)
    const files: TokenizedFile[] = []
    for (const name of ['SKILL.md', 'TEMPLATE.md']) {
      const file = tokenCountFile(agentDir, path.join(skillRel, name))
      if (file) files.push(file)
    }
    for (const subdir of ['examples', 'scripts']) {
      for (const name of tokenListFiles(path.join(agentDir, skillRel, subdir))) {
        const file = tokenCountFile(agentDir, path.join(skillRel, subdir, name))
        if (file) files.push(file)
      }
    }
    return { id: skillId, tokens: files.reduce((sum, f) => sum + f.tokens, 0), files }
  })
}

function tokenComputeTools(agentDir: string): ToolTokenUsage[] {
  return tokenListFiles(path.join(agentDir, 'tools'), TOKEN_TOOL_EXTENSIONS).map((name) => {
    const rel = path.join('tools', name)
    return {
      name: name.replace(/\.[^.]+$/, ''),
      path: toPosixRelativePath(rel),
      tokens: countTokens(fs.readFileSync(path.join(agentDir, rel), 'utf8')),
    }
  })
}

function discoverAgentTokenUsage(agentDir: string, depth = 0): FileAgentTokenUsage {
  const agent = tokenCountFile(agentDir, 'AGENT.md')?.tokens ?? 0
  const outcome = tokenCountFile(agentDir, 'OUTCOME.md')?.tokens ?? 0
  const skills = tokenComputeSkills(agentDir)
  const tools = tokenComputeTools(agentDir)

  const subAgents: SubAgentTokenUsage[] = []
  if (depth === 0) {
    for (const subId of tokenListDirs(path.join(agentDir, 'sub-agents'))) {
      const nested = discoverAgentTokenUsage(path.join(agentDir, 'sub-agents', subId), depth + 1)
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

// --- Raw source-file collection (feeds the read-only Files tab, #12 files) ---

/** Files present at the agent root but NOT part of the constructed prompt. */
const AGENT_AUX_FILES = ['SAMPLE.json', 'FACTS.json']

/**
 * Walks every construction file of a file-defined agent and returns its raw
 * content + `o200k_base` token count, paths relative to the agent root. Recurses
 * `sub-agents/<id>/` once (depth cap = 1, matching `discoverAgentTokenUsage`),
 * prefixing nested paths with `sub-agents/<id>/`. The `inContext` sum of a tree
 * equals `discoverAgentTokenUsage(...).total`, so the Files tab and the baked
 * token estimate stay consistent.
 */
function collectAgentFiles(agentDir: string, prefix = '', depth = 0): FileAgentSourceFile[] {
  const files: FileAgentSourceFile[] = []
  const add = (relativePath: string, inContext: boolean): void => {
    const absolute = path.join(agentDir, relativePath)
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return
    const content = fs.readFileSync(absolute, 'utf8')
    files.push({ path: toPosixRelativePath(path.join(prefix, relativePath)), content, tokens: countTokens(content), inContext })
  }
  add('AGENT.md', true)
  add('OUTCOME.md', true)
  for (const name of AGENT_AUX_FILES) add(name, false)
  for (const skillId of tokenListDirs(path.join(agentDir, 'skills'))) {
    const skillRel = path.join('skills', skillId)
    for (const name of ['SKILL.md', 'TEMPLATE.md']) add(path.join(skillRel, name), true)
    for (const subdir of ['examples', 'scripts']) {
      for (const name of tokenListFiles(path.join(agentDir, skillRel, subdir))) {
        add(path.join(skillRel, subdir, name), true)
      }
    }
  }
  for (const name of tokenListFiles(path.join(agentDir, 'tools'), TOKEN_TOOL_EXTENSIONS)) {
    add(path.join('tools', name), true)
  }
  if (depth === 0) {
    for (const subId of tokenListDirs(path.join(agentDir, 'sub-agents'))) {
      files.push(
        ...collectAgentFiles(
          path.join(agentDir, 'sub-agents', subId),
          path.join(prefix, 'sub-agents', subId),
          depth + 1,
        ),
      )
    }
  }
  return files
}

/** Walk up from a known in-repo path until a dir containing both `docker` and `packages` is found. */
function findRepoRoot(start: string): string | null {
  let current = path.resolve(start)
  for (let depth = 0; depth < 40; depth += 1) {
    if (
      fs.existsSync(path.join(current, 'package.json')) &&
      fs.existsSync(path.join(current, 'packages', 'enterprise'))
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

const ORCHESTRATOR_MODULE_ID = 'agent_orchestrator'

/**
 * Render one agent descriptor as a key-per-line object literal at `indent`.
 * Used for both top-level agents and nested sub-agents (Phase 4). A primary that
 * declares sub-agents emits them as a nested `subAgentDescriptors` array so
 * `ensureAgentsLoaded` can register each sub-agent too (researcher, individually
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
  if (agent.sampleInput !== undefined) {
    optional.push(`${indent}  sampleInput: ${JSON.stringify(agent.sampleInput)},`)
  }
  if (agent.facts !== undefined) {
    optional.push(`${indent}  facts: ${JSON.stringify(agent.facts)},`)
  }
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
    `${indent}  skillsContent: ${JSON.stringify(skillsContent)},`,
    `${indent}  tokenUsage: ${JSON.stringify(agent.tokenUsage)},`,
    `${indent}  sourceFiles: ${JSON.stringify(agent.sourceFiles)},`,
    ...optional,
    `${indent}},`,
  ].join('\n')
}

function renderManifest(agents: DiscoveredAgent[]): string {
  const descriptors = agents.map((agent) => renderDescriptor(agent, '  ')).join('\n')

  return `// AUTO-GENERATED by mercato generate registry — DO NOT EDIT BY HAND.
//
// Committed, generator-owned manifest of file-defined business agents,
// discovered from \`agents/<id>/\` directories across every enabled module. It
// stores PLAIN data (raw JSON-Schema, not a Zod instance) so this file is pure
// data and travels with the repo (survives \`yarn clean-generated\`).
// \`ensureAgentsLoaded()\` recompiles each \`outcomeSchema\` to Zod via
// \`compileOutcome\` at load time and registers it with \`runtime:'business-harness'\`.
//
// Regenerate with \`yarn generate\`.
import type { JsonSchemaNode, OutcomeKind } from '../lib/sdk/outcomeSchema'
import type { AgentTokenUsage, FileAgentFile } from '../lib/tokens/types'

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
   * Never copied to the runtime process. The synthetic skill id
   * \`__agent_tools__\` carries an agent's LOCAL \`tools/*.ts\` sources.
   */
  scripts?: FileAgentScript[]
}

export type FileAgentFact = {
  /** Human label shown in the Caseload facts grid. */
  label: string
  /** Where to resolve the value: run input, proposal payload, or run output. */
  source: 'input' | 'payload' | 'output'
  /** Dot-path into the source (array indexes allowed), e.g. "actions.0.payload.amount". */
  path: string
  format?: 'text' | 'number' | 'boolean' | 'percent'
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
  skillsContent?: FileAgentSkillContent[]
  /**
   * Baked token-usage estimate of the agent's construction files (AGENT.md,
   * OUTCOME.md, skills, tools, sub-agents), counted with the shared
   * \`o200k_base\` tokenizer. Surfaced on the Agent detail page and the
   * \`agent_orchestrator token-usage\` CLI. An estimate, not an exact count.
   */
  tokenUsage?: AgentTokenUsage
  /**
   * Baked raw content of every construction file (AGENT.md, OUTCOME.md, skills,
   * tools, sub-agents, and auxiliary SAMPLE.json/FACTS.json), for the read-only
   * Files tab. Each carries its \`o200k_base\` token count; paths are relative to
   * the agent root (sub-agent files prefixed \`sub-agents/<id>/\`). Baked so the
   * runtime never reads agent dirs from disk.
   */
  sourceFiles?: FileAgentFile[]
  /**
   * Nested descriptors for this agent's sub-agents (Phase 4). Each is an
   * researcher, non-delegating file agent registered individually (depth cap =
   * 1). Absent for agents without sub-agents and for sub-agents themselves.
   */
  subAgentDescriptors?: FileAgentDescriptor[]
  maxSteps?: number
  provider?: string
  model?: string
  /**
   * Optional example \`input\` for the Playground "Insert sample" button, read
   * from \`agents/<id>/SAMPLE.json\`. Any JSON value the agent accepts as input.
   */
  sampleInput?: unknown
  /**
   * Optional fact declarations for the Caseload decision panel, read from
   * \`agents/<id>/FACTS.json\`. Each maps a labelled dot-path into the run
   * input / proposal payload / run output.
   */
  facts?: FileAgentFact[]
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
  let sawOrchestratorModule = false

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
      // The id is the registry key and the stable execution identity.
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
              },
            ]
          : skillsContent
      const effectiveTools = Array.from(
        new Set([...agent.tools, ...skillTools, ...toolFiles.refs]),
      )
      // Phase 4: discover + validate sub-agents (throws on a malformed/proposal/
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
        tools: effectiveTools,
        skills: agent.skills,
        subAgents: agent.subAgents,
          skillsContent: effectiveSkillsContent,
        subAgentsContent,
        maxSteps: agent.maxSteps,
        provider: agent.provider,
        model: agent.model,
        sampleInput: discoverSampleInput(dir),
        facts: discoverFacts(dir),
        tokenUsage: discoverAgentTokenUsage(dir),
        sourceFiles: collectAgentFiles(dir),
      })
    }
  }

  return {
    id: 'registry.agent-files',
    outputFiles: [],
    scanModule(ctx: ModuleScanContext) {
      if (ctx.moduleId === ORCHESTRATOR_MODULE_ID) sawOrchestratorModule = true
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

      if (!sawOrchestratorModule && sorted.length === 0) {
        // Neither the orchestrator (the manifest's only consumer) nor any agent
        // module is part of this run — the enterprise agents flag is off. The
        // committed manifest belongs to modules
        // that are merely switched off, so pruning them here would delete
        // tracked artifacts on every `yarn generate`. Leave the tree untouched.
        return new Map<string, string>()
      }

      const manifestPath = path.join(
        repoRoot,
        'packages',
        'enterprise',
        'src',
        'modules',
        'agent_orchestrator',
        'generated',
        'file-agents.generated.ts',
      )
      fs.mkdirSync(path.dirname(manifestPath), { recursive: true })
      fs.writeFileSync(manifestPath, renderManifest(sorted), 'utf8')

      return new Map<string, string>()
    },
  }
}
