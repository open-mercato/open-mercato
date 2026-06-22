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

/**
 * Render the OpenCode agent .md file: YAML-ish frontmatter (description,
 * optional model/provider, mode: primary, a read-only tools/permission block)
 * plus the body = instructions + the terminal `submit_outcome` instruction.
 *
 * The `tools` block denies everything by default and allows ONLY the agent's
 * declared read-only MCP tool ids plus `submit_outcome` (propose-only gate; see
 * findings §C8). Writes (`write`/`edit`/`bash`) are denied via `permission`.
 */
function renderOpenCodeAgentFile(args: {
  description: string
  provider?: string
  model?: string
  instructions: string
  tools: string[]
}): string {
  const submitTool = 'agent_orchestrator.submit_outcome'
  const allowedTools = Array.from(new Set([...args.tools, submitTool]))
  const modelLine =
    args.provider && args.model
      ? `model: ${args.provider}/${args.model}`
      : args.model
        ? `model: ${args.model}`
        : null
  const frontmatterLines = [
    '---',
    `description: ${JSON.stringify(args.description)}`,
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
  const body = [args.instructions.trim(), terminalInstruction].filter(Boolean).join('\n\n')
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
 * Read `agents/<id>/{CLAUDE.md,OUTCOME.md}`, validate, compile the OUTCOME schema,
 * and build an `AgentRegistryEntry` with `runtime:'opencode'`. Pure and fs-based
 * (unit-testable against fixtures). Returns null when the dir is not a valid
 * agent (missing/malformed CLAUDE.md or OUTCOME.md); the generator turns a null
 * into a hard generation error naming the dir.
 *
 * In Phase 1 `subAgents` (loaded children) is always `[]`; the declared sub-agent
 * ids are still carried on `entry.subAgents`.
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
