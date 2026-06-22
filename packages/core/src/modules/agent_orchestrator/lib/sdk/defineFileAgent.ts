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
  const submitTool = 'agent_orchestrator.submit_outcome'
  const mode = args.mode ?? 'primary'
  const subAgentNames = mode === 'primary' ? (args.subAgentNames ?? []) : []
  const hasSubAgents = subAgentNames.length > 0
  const allowedTools = Array.from(
    new Set([...args.tools, submitTool, ...(hasSubAgents ? [TASK_TOOL_NAME] : [])]),
  )
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
  const terminalInstruction =
    'Finish by calling `agent_orchestrator.submit_outcome` with a value matching the outcome contract. Do not answer in prose.'
  const subAgentSection = hasSubAgents
    ? `## Sub-agents\nYou may delegate independent read-only sub-tasks to these sub-agents by calling the \`task\` tool. When several sub-tasks are independent, issue multiple \`task\` calls in the SAME step so they run in parallel, then combine their results before submitting your outcome. Available sub-agents: ${subAgentNames.join(', ')}.`
    : null
  const body = [args.instructions.trim(), ...(subAgentSection ? [subAgentSection] : []), terminalInstruction]
    .filter(Boolean)
    .join('\n\n')
  return `${frontmatterLines.join('\n')}\n${body}\n`
}

/**
 * Read one agent-local skill dir `agents/<id>/skills/<skill_id>/`:
 *  - `SKILL.md` (required; parsed with `parseAgentLocalSkillMarkdown`, moduleId
 *    tolerated/absent, id defaulting to the dir name),
 *  - optional `TEMPLATE.md`,
 *  - optional `examples/*.md` (ordered by filename).
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
  }
}

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
  const effectiveTools = Array.from(new Set([...agent.tools, ...skillTools]))

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
    skillsContent,
    subAgents,
  }
}
