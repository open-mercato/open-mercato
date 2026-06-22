import fs from 'node:fs'
import path from 'node:path'
import type { AgentRegistryEntry } from './defineAgent'
import { parseAgentMarkdown } from './agentMarkdown'
import { parseAgentLocalSkillMarkdown } from './skillMarkdown'
import { compileOutcome, type JsonSchemaNode, type OutcomeKind } from './outcomeSchema'

/**
 * Re-export so callers that have a loaded entry can register it. File agents
 * register into the same in-memory registry as `defineAgent` agents.
 */
export { registerFileAgent } from './defineAgent'

/**
 * Resolved content of one agent-local skill (Phase 3). Plain data so it can be
 * persisted to the committed manifest and returned by the `load_skill` MCP tool
 * at runtime without fs access.
 */
/** One sandboxed skill/tool script carried as plain data (Phase 5). */
export type LoadedScript = {
  /** Script basename without extension (`scripts/score.ts` → `score`). */
  name: string
  /** Raw TS/JS source, run server-side in the Code Mode sandbox. */
  source: string
}

export type LoadedSkillContent = {
  /** Skill id (frontmatter `id` or, when absent, the skill dir name). */
  id: string
  /** SKILL.md body → progressive-disclosure instructions. */
  instructions: string
  /** Optional TEMPLATE.md body (output template). */
  template?: string
  /** Optional examples/*.md bodies (few-shot blocks), ordered by filename. */
  examples: string[]
  /** Read-only tool ids the skill contributes to the agent allowlist. */
  tools: string[]
  /**
   * Optional sandboxed helper scripts (`scripts/*.ts`), Phase 5. Carried as
   * plain `{ name, source }` data (NOT copied to the OpenCode container); the
   * agent runs them via the `run_skill_script` MCP tool, server-side in the
   * Code Mode `isolated-vm` sandbox (no fs/net, 30s cap, per-call ACL).
   */
  scripts: LoadedScript[]
}

export type LoadedFileAgent = {
  /** runtime: 'opencode'; schema = compiled OUTCOME resultSchema. */
  entry: AgentRegistryEntry
  /** Raw JSON-Schema subset from OUTCOME.md (plain data for the committed manifest). */
  outcomeSchema: JsonSchemaNode
  /** OUTCOME.md kind. */
  resultKind: OutcomeKind
  /** Rendered OpenCode agent .md (frontmatter + body). */
  openCodeAgentFile: string
  /** Sanitized filename-id passed in the message `agent` field. */
  openCodeAgentName: string
  /**
   * Resolved agent-local skill content (Phase 3). One entry per skill referenced
   * by CLAUDE.md `skills:` that resolved to an `agents/<id>/skills/<skill_id>/`
   * dir. Each skill's read-only tools are also unioned into `entry.tools`.
   */
  skillsContent: LoadedSkillContent[]
  /** Phase 4 sub-agent file loading; [] in Phase 1-3 (ids still carried on entry). */
  subAgents: LoadedFileAgent[]
}

/**
 * OUTCOME.md authoring format (Phase 1):
 *
 *   ---
 *   kind: actionable            # informative | actionable
 *   ---
 *   ```json
 *   { "type": "object", "required": [...], "properties": { ... } }
 *   ```
 *
 *   Optional prose guidance after the JSON block …
 *
 * The frontmatter carries ONLY `kind`. The result JSON-Schema is authored as the
 * FIRST fenced ```json code block in the body (robust for a line-based parser —
 * no YAML dependency). Any text after the JSON block is human guidance.
 */
const OUTCOME_FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/
const JSON_FENCE_RE = /```json\s*\n([\s\S]*?)\n```/

type OutcomeDescriptor = {
  kind: OutcomeKind
  schema: JsonSchemaNode
}

function parseOutcomeKind(frontmatterBlock: string): OutcomeKind | null {
  for (const line of frontmatterBlock.split('\n')) {
    const match = /^kind:\s*(.*)$/.exec(line.trim())
    if (!match) continue
    const value = match[1].trim().replace(/^['"]/, '').replace(/['"]$/, '').trim()
    if (value === 'informative' || value === 'actionable') return value
    return null
  }
  return null
}

/** Parse OUTCOME.md into a `{ kind, schema }` descriptor. Returns null when malformed. */
function parseOutcomeMarkdown(raw: string): OutcomeDescriptor | null {
  const frontmatterMatch = OUTCOME_FRONTMATTER_RE.exec(raw)
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
  return { kind, schema: parsed as JsonSchemaNode }
}

function sanitizeAgentName(id: string): string {
  return id.replace(/[^a-z0-9_-]/gi, '_')
}

function renderToolPermissionLine(toolName: string): string {
  return `  ${JSON.stringify(toolName)}: true`
}

/** Built-in OpenCode delegation tool a primary agent uses to fan out to sub-agents. */
const TASK_TOOL_NAME = 'task'

/**
 * The MCP server key OpenCode connects under (the `mcp.<key>` in opencode.jsonc;
 * `open-mercato` in OM's container). OpenCode exposes each MCP tool as
 * `<serverKey>_<toolName with dots→underscores>`, so a file-agent's `tools`
 * allowlist + prompt MUST reference that id — verified against the running image.
 */
const OPENCODE_MCP_SERVER_KEY = 'open-mercato'

/** Core MCP tools every file agent may call (terminal outcome + progressive disclosure + sandboxed scripts). */
const CORE_FILE_AGENT_TOOL_IDS = [
  'agent_orchestrator.submit_outcome',
  'agent_orchestrator.load_skill',
  'agent_orchestrator.run_skill_script',
]

/** Map an OM tool id (`module.tool`) to OpenCode's MCP tool id (`<serverKey>_module_tool`). */
function toOpenCodeMcpToolId(omToolId: string): string {
  return `${OPENCODE_MCP_SERVER_KEY}_${omToolId.replace(/\./g, '_')}`
}

/**
 * Render the OpenCode agent .md file: YAML-ish frontmatter (description,
 * optional model/provider, mode, a read-only tools/permission block) plus the
 * body = instructions + the terminal `submit_outcome` instruction.
 *
 * The `tools` block denies everything by default and allows ONLY the agent's
 * declared read-only MCP tool ids plus `submit_outcome` (propose-only gate; see
 * findings §C8). Writes (`write`/`edit`/`bash`) are denied via `permission`.
 *
 * Sub-agent files (`mode: subagent`, Phase 4) are rendered with NO `task`
 * allowance and `permission.task: deny`, so they cannot delegate further (depth
 * cap = 1). The PRIMARY, when it declares sub-agents, additionally allows the
 * built-in `task` tool, whitelists ONLY its sub-agents' sanitized names under
 * `permission.task`, and gets a "Sub-agents" prompt section nudging parallel
 * fan-out (mirrors `defineAgent`'s `subAgentSection`).
 */
function renderOpenCodeAgentFile(args: {
  description: string
  provider?: string
  model?: string
  instructions: string
  tools: string[]
  /** `'primary'` (default) or `'subagent'` for a generated sub-agent file. */
  mode?: 'primary' | 'subagent'
  /** Sanitized OpenCode names of this primary's reachable sub-agents (empty otherwise). */
  subAgentNames?: string[]
}): string {
  const mode = args.mode ?? 'primary'
  const subAgentNames = mode === 'primary' ? (args.subAgentNames ?? []) : []
  const hasSubAgents = subAgentNames.length > 0
  // The agent's MCP tools = its declared read tools + the core file-agent tools
  // (submit_outcome / load_skill / run_skill_script). OpenCode names every MCP
  // tool `<serverKey>_<toolName with dots→underscores>`, so the allowlist key and
  // the prompt MUST use that form — a dotted OM id never matches and `"*": false`
  // would silently drop it. `task` is an OpenCode built-in (not prefixed).
  const omMcpToolIds = Array.from(new Set([...args.tools, ...CORE_FILE_AGENT_TOOL_IDS]))
  const allowedTools = [
    ...omMcpToolIds.map(toOpenCodeMcpToolId),
    ...(hasSubAgents ? [TASK_TOOL_NAME] : []),
  ]
  const modelLine =
    args.provider && args.model
      ? `model: ${args.provider}/${args.model}`
      : args.model
        ? `model: ${args.model}`
        : null
  // Sub-agents may NOT delegate further: deny `task` entirely. A primary that
  // declares sub-agents denies `task` by default then whitelists ONLY its own
  // sub-agents' sanitized names.
  const taskPermissionLines = hasSubAgents
    ? ['  task:', '    "*": deny', ...subAgentNames.map((name) => `    ${JSON.stringify(name)}: allow`)]
    : ['  task: deny']
  const frontmatterLines = [
    '---',
    `description: ${JSON.stringify(args.description)}`,
    ...(modelLine ? [modelLine] : []),
    `mode: ${mode}`,
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
  const submitToolId = toOpenCodeMcpToolId('agent_orchestrator.submit_outcome')
  const terminalInstruction =
    `Finish by calling the \`${submitToolId}\` tool with a value matching the outcome contract (pass it as the \`outcome\` argument). You MUST call the tool — do not answer in prose or emit the result as a code block.`
  const subAgentSection = hasSubAgents
    ? `## Sub-agents\nYou may delegate independent read-only sub-tasks to these sub-agents by calling the \`task\` tool. When several sub-tasks are independent, issue multiple \`task\` calls in the SAME step so they run in parallel, then combine their results before submitting your outcome. Available sub-agents: ${subAgentNames.join(', ')}.`
    : null
  const body = [args.instructions.trim(), ...(subAgentSection ? [subAgentSection] : []), terminalInstruction]
    .filter(Boolean)
    .join('\n\n')
  return `${frontmatterLines.join('\n')}\n${body}\n`
}

/**
 * Read sandboxed scripts from a `scripts/` dir (`scripts/*.ts` / `*.js`), Phase 5.
 * Each file's basename (without extension) becomes the script `name`; the raw
 * source is carried as plain data (run server-side in the sandbox, never copied
 * to the container). Ordered by filename for determinism. Returns [] when the
 * dir is absent.
 */
function loadScriptsDir(scriptsDir: string): LoadedScript[] {
  if (!fs.existsSync(scriptsDir) || !fs.statSync(scriptsDir).isDirectory()) return []
  const scripts: LoadedScript[] = []
  const files = fs
    .readdirSync(scriptsDir)
    .filter((name) => name.endsWith('.ts') || name.endsWith('.js'))
    .sort((a, b) => a.localeCompare(b))
  for (const file of files) {
    const source = fs.readFileSync(path.join(scriptsDir, file), 'utf8')
    scripts.push({ name: file.replace(/\.(ts|js)$/, ''), source })
  }
  return scripts
}

/**
 * Read one agent-local skill dir `agents/<id>/skills/<skill_id>/`:
 *  - `SKILL.md` (required; parsed with `parseAgentLocalSkillMarkdown`, moduleId
 *    tolerated/absent, id defaulting to the dir name),
 *  - optional `TEMPLATE.md`,
 *  - optional `examples/*.md` (ordered by filename),
 *  - optional `scripts/*.ts` (Phase 5; carried as plain source for sandboxed
 *    execution via `run_skill_script`).
 *
 * Returns null when SKILL.md is missing or has no parseable frontmatter.
 */
function loadSkillDir(skillDir: string): LoadedSkillContent | null {
  const skillPath = path.join(skillDir, 'SKILL.md')
  if (!fs.existsSync(skillPath)) return null
  const dirName = path.basename(skillDir)
  const parsed = parseAgentLocalSkillMarkdown(fs.readFileSync(skillPath, 'utf8'), dirName)
  if (!parsed) return null

  const templatePath = path.join(skillDir, 'TEMPLATE.md')
  const template = fs.existsSync(templatePath)
    ? fs.readFileSync(templatePath, 'utf8').trim() || undefined
    : undefined

  const examplesDir = path.join(skillDir, 'examples')
  const examples: string[] = []
  if (fs.existsSync(examplesDir) && fs.statSync(examplesDir).isDirectory()) {
    const files = fs
      .readdirSync(examplesDir)
      .filter((name) => name.endsWith('.md'))
      .sort((a, b) => a.localeCompare(b))
    for (const file of files) {
      const body = fs.readFileSync(path.join(examplesDir, file), 'utf8').trim()
      if (body) examples.push(body)
    }
  }

  return {
    id: parsed.id,
    instructions: parsed.instructions,
    template,
    examples,
    tools: parsed.tools,
    scripts: loadScriptsDir(path.join(skillDir, 'scripts')),
  }
}

/**
 * Load `agents/<id>/tools/*.ts` local tool files (Phase 5). Honors §7.4's v1
 * guidance with TWO clearly-separated forms, both propose-only-safe:
 *
 *  1. REFERENCE form (preferred): a file whose first line is a directive
 *     `// @ref <defineAiTool id>` (or `// @ref: <id>`). The id is unioned into
 *     the agent's `tools` allowlist exactly like a CLAUDE.md `tools:` entry, so
 *     it flows through the SAME central ACL + propose-only mutation gate (a
 *     referenced `isMutation:true` tool is rejected at load by `defineAgent`'s
 *     gate). Recommended — no new execution surface.
 *  2. LOCAL SANDBOXED form: any other `tools/*.ts` file is carried as a script
 *     (`{ name, source }`) registered under the synthetic skill id
 *     `__agent_tools__` and executed through the SAME `isolated-vm` sandbox as
 *     skill scripts via `run_skill_script` (skillId `__agent_tools__`). It can
 *     never touch fs/net/mutation or escape the sandbox, and is `isMutation:false`
 *     at the MCP boundary — so propose-only holds without generating an
 *     unsandboxed native `.opencode/tool/` file that would bypass the MCP ACL gate.
 *
 * Returns `{ refs, scripts }`: `refs` union into the allowlist; `scripts` carry
 * local sandboxed tool sources.
 */
const TOOL_REF_RE = /^\s*\/\/\s*@ref:?\s+(\S+)/

function loadToolFiles(agentDir: string): { refs: string[]; scripts: LoadedScript[] } {
  const toolsBase = path.join(agentDir, 'tools')
  if (!fs.existsSync(toolsBase) || !fs.statSync(toolsBase).isDirectory()) {
    return { refs: [], scripts: [] }
  }
  const refs: string[] = []
  const scripts: LoadedScript[] = []
  const files = fs
    .readdirSync(toolsBase)
    .filter((name) => name.endsWith('.ts') || name.endsWith('.js'))
    .sort((a, b) => a.localeCompare(b))
  for (const file of files) {
    const source = fs.readFileSync(path.join(toolsBase, file), 'utf8')
    const firstLine = source.split('\n', 1)[0] ?? ''
    const refMatch = TOOL_REF_RE.exec(firstLine)
    if (refMatch) {
      refs.push(refMatch[1])
      continue
    }
    scripts.push({ name: file.replace(/\.(ts|js)$/, ''), source })
  }
  return { refs, scripts }
}

/** Synthetic skill id under which an agent's LOCAL sandboxed tool files register. */
export const AGENT_TOOLS_SKILL_ID = '__agent_tools__'

/**
 * Resolve the agent-local skills referenced by CLAUDE.md `skills:`. For each id
 * we look for an `agents/<id>/skills/<skill_id>/` dir whose resolved skill id
 * (frontmatter id or dir name) matches. Unknown ids are skipped (warned) so a
 * stale reference never blocks the agent.
 */
function loadAgentSkills(agentDir: string, skillIds: string[]): LoadedSkillContent[] {
  if (skillIds.length === 0) return []
  const skillsBase = path.join(agentDir, 'skills')
  const hasSkillsDir = fs.existsSync(skillsBase) && fs.statSync(skillsBase).isDirectory()

  const bySkillId = new Map<string, LoadedSkillContent>()
  if (hasSkillsDir) {
    for (const entry of fs.readdirSync(skillsBase, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const loaded = loadSkillDir(path.join(skillsBase, entry.name))
      if (loaded) bySkillId.set(loaded.id, loaded)
    }
  }

  const resolved: LoadedSkillContent[] = []
  for (const skillId of skillIds) {
    const skill = bySkillId.get(skillId)
    if (!skill) {
      console.warn(
        `[internal] file agent skill "${skillId}" not found under ${skillsBase}; skipping.`,
      )
      continue
    }
    resolved.push(skill)
  }
  return resolved
}

/**
 * Load one sub-agent dir `agents/<id>/sub-agents/<subid>/` (Phase 4). Sub-agents
 * are full file agents (CLAUDE.md + OUTCOME.md) but constrained: each is rendered
 * `mode: subagent`, read-only, and MUST satisfy two hard rules (matching the
 * in-process `delegate_agent` contract):
 *
 *   1. OUTCOME `kind` MUST be `informative` (sub-agents inform; only the primary
 *      proposes);
 *   2. it MUST NOT itself declare `subAgents` (depth cap = 1).
 *
 * A malformed sub-agent dir or a constraint violation THROWS with a clear
 * `[internal]` reason naming the dir (so the generator fails loudly), rather than
 * returning null — a present-but-invalid sub-agent must never be silently dropped.
 */
function loadSubAgentDir(dir: string): LoadedFileAgent {
  const claudePath = path.join(dir, 'CLAUDE.md')
  const outcomePath = path.join(dir, 'OUTCOME.md')
  if (!fs.existsSync(claudePath) || !fs.existsSync(outcomePath)) {
    throw new Error(`[internal] malformed sub-agent at ${dir}: both CLAUDE.md and OUTCOME.md are required`)
  }

  const agent = parseAgentMarkdown(fs.readFileSync(claudePath, 'utf8'))
  if (!agent) {
    throw new Error(`[internal] malformed CLAUDE.md at ${dir}: missing id/label/description`)
  }
  const outcome = parseOutcomeMarkdown(fs.readFileSync(outcomePath, 'utf8'))
  if (!outcome) {
    throw new Error(`[internal] malformed OUTCOME.md at ${dir}: missing kind or JSON-Schema block`)
  }
  if (outcome.kind !== 'informative') {
    throw new Error(
      `[internal] sub-agent at ${dir} must be informative (kind: informative); sub-agents inform, only the primary proposes`,
    )
  }
  if (agent.subAgents.length > 0) {
    throw new Error(
      `[internal] sub-agent at ${dir} may not declare subAgents (depth cap = 1); sub-agents may not delegate further`,
    )
  }

  let resultSchema
  try {
    resultSchema = compileOutcome({ kind: outcome.kind, schema: outcome.schema }).resultSchema
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`[internal] malformed OUTCOME.md at ${dir}: ${detail}`)
  }

  const skillsContent = loadAgentSkills(dir, agent.skills)
  const skillTools = skillsContent.flatMap((skill) => skill.tools)
  const effectiveTools = Array.from(new Set([...agent.tools, ...skillTools]))

  const openCodeAgentName = sanitizeAgentName(agent.id)
  const entry: AgentRegistryEntry = {
    id: agent.id,
    moduleId: '',
    resultKind: outcome.kind,
    schema: resultSchema,
    tools: effectiveTools,
    skills: agent.skills,
    subAgents: [],
    label: agent.label,
    description: agent.description,
    instructions: agent.instructions,
    defaultProvider: agent.provider,
    defaultModel: agent.model,
    loop: agent.maxSteps != null ? { maxSteps: agent.maxSteps } : undefined,
    runtime: 'opencode',
  }

  const openCodeAgentFile = renderOpenCodeAgentFile({
    description: agent.description,
    provider: agent.provider,
    model: agent.model,
    instructions: agent.instructions,
    tools: effectiveTools,
    mode: 'subagent',
  })

  return {
    entry,
    outcomeSchema: outcome.schema,
    resultKind: outcome.kind,
    openCodeAgentFile,
    openCodeAgentName,
    skillsContent,
    subAgents: [],
  }
}

/**
 * Load every sub-agent under `agents/<id>/sub-agents/<subid>/` (Phase 4). Each
 * resolved child carries its own loaded `LoadedFileAgent` (full file agent,
 * constrained to informative + non-delegating). Returns [] when the agent has no
 * `sub-agents/` dir.
 */
function loadSubAgents(agentDir: string): LoadedFileAgent[] {
  const base = path.join(agentDir, 'sub-agents')
  if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) return []
  const loaded: LoadedFileAgent[] = []
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '__tests__') continue
    loaded.push(loadSubAgentDir(path.join(base, entry.name)))
  }
  return loaded
}

/**
 * Read `agents/<id>/{CLAUDE.md,OUTCOME.md}` (+ skills + sub-agents), validate,
 * compile the OUTCOME schema, and build an `AgentRegistryEntry` with
 * `runtime:'opencode'`. Pure and fs-based (unit-testable against fixtures).
 * Returns null when the dir is not a valid agent (missing/malformed CLAUDE.md or
 * OUTCOME.md); the generator turns a null into a hard generation error naming the
 * dir. A present-but-invalid SUB-agent throws (so a constraint violation fails
 * loudly rather than being silently dropped).
 *
 * `subAgents` (loaded children) is populated from `agents/<id>/sub-agents/`; the
 * declared sub-agent ids are still carried on `entry.subAgents`. When sub-agents
 * are present, the rendered primary agent file additionally allows the `task`
 * tool, whitelists ONLY its sub-agents' sanitized names under `permission.task`,
 * and gains a "Sub-agents" prompt section.
 */
export function loadFileAgentDir(dir: string): LoadedFileAgent | null {
  const claudePath = path.join(dir, 'CLAUDE.md')
  const outcomePath = path.join(dir, 'OUTCOME.md')
  if (!fs.existsSync(claudePath) || !fs.existsSync(outcomePath)) return null

  const claudeRaw = fs.readFileSync(claudePath, 'utf8')
  const outcomeRaw = fs.readFileSync(outcomePath, 'utf8')

  const agent = parseAgentMarkdown(claudeRaw)
  if (!agent) return null

  const outcome = parseOutcomeMarkdown(outcomeRaw)
  if (!outcome) return null

  let resultSchema
  try {
    resultSchema = compileOutcome({ kind: outcome.kind, schema: outcome.schema }).resultSchema
  } catch {
    return null
  }

  // Phase 3: resolve agent-local skills referenced by CLAUDE.md `skills:` and
  // UNION each resolved skill's read-only tools into the agent allowlist (deduped),
  // mirroring how the in-process `defineAgent` unions skill tools.
  const skillsContent = loadAgentSkills(dir, agent.skills)
  const skillTools = skillsContent.flatMap((skill) => skill.tools)

  // Phase 5: load `tools/*.ts` local tool files. Reference-form ids union into the
  // allowlist (flow through the central ACL + propose-only gate); local sandboxed
  // tool sources are carried under the synthetic `__agent_tools__` skill, run via
  // `run_skill_script` in the same sandbox as skill scripts.
  const toolFiles = loadToolFiles(dir)
  const effectiveSkillsContent =
    toolFiles.scripts.length > 0
      ? [
          ...skillsContent,
          { id: AGENT_TOOLS_SKILL_ID, instructions: '', examples: [], tools: [], scripts: toolFiles.scripts },
        ]
      : skillsContent
  const effectiveTools = Array.from(new Set([...agent.tools, ...skillTools, ...toolFiles.refs]))

  // Phase 4: load sub-agent dirs (constraints enforced — throws on violation).
  const subAgents = loadSubAgents(dir)
  const subAgentNames = subAgents.map((sub) => sub.openCodeAgentName)

  const openCodeAgentName = sanitizeAgentName(agent.id)
  const entry: AgentRegistryEntry = {
    id: agent.id,
    moduleId: '',
    resultKind: outcome.kind,
    schema: resultSchema,
    tools: effectiveTools,
    skills: agent.skills,
    subAgents: agent.subAgents,
    label: agent.label,
    description: agent.description,
    instructions: agent.instructions,
    defaultProvider: agent.provider,
    defaultModel: agent.model,
    loop: agent.maxSteps != null ? { maxSteps: agent.maxSteps } : undefined,
    runtime: 'opencode',
  }

  const openCodeAgentFile = renderOpenCodeAgentFile({
    description: agent.description,
    provider: agent.provider,
    model: agent.model,
    instructions: agent.instructions,
    tools: effectiveTools,
    mode: 'primary',
    subAgentNames,
  })

  return {
    entry,
    outcomeSchema: outcome.schema,
    resultKind: outcome.kind,
    openCodeAgentFile,
    openCodeAgentName,
    skillsContent: effectiveSkillsContent,
    subAgents,
  }
}
