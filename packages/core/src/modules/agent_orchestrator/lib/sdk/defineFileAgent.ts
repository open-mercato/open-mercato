import fs from 'node:fs'
import path from 'node:path'
import type { AgentRegistryEntry } from './defineAgent'
import { parseAgentMarkdown } from './agentMarkdown'
import { compileOutcome, type JsonSchemaNode, type OutcomeKind } from './outcomeSchema'

/**
 * Re-export so callers that have a loaded entry can register it. File agents
 * register into the same in-memory registry as `defineAgent` agents.
 */
export { registerFileAgent } from './defineAgent'

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

  const openCodeAgentName = sanitizeAgentName(agent.id)
  const entry: AgentRegistryEntry = {
    id: agent.id,
    moduleId: '',
    resultKind: outcome.kind,
    schema: resultSchema,
    tools: agent.tools,
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
    tools: agent.tools,
  })

  return {
    entry,
    outcomeSchema: outcome.schema,
    resultKind: outcome.kind,
    openCodeAgentFile,
    openCodeAgentName,
    subAgents: [],
  }
}
