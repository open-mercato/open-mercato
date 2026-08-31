import fs from 'node:fs'
import path from 'node:path'
import type { AgentFact, AgentRegistryEntry } from './defineAgent'
import { parseAgentMarkdown } from './agentMarkdown'
import { parseAgentLocalSkillMarkdown } from './skillMarkdown'
import { compileOutcome, type JsonSchemaNode, type OutcomeKind } from './outcomeSchema'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('agent_orchestrator').child({ component: 'define-file-agent' })

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
   * plain `{ name, source }` data (NOT copied to the runtime process); the
   * agent runs them via the `run_skill_script` MCP tool, server-side in the
   * Code Mode `isolated-vm` sandbox (no fs/net, 30s cap, per-call ACL).
   */
  scripts: LoadedScript[]
}

export type LoadedFileAgent = {
  /** Runtime registry entry with a schema compiled from OUTCOME.md. */
  entry: AgentRegistryEntry
  /** Raw JSON-Schema subset from OUTCOME.md (plain data for the committed manifest). */
  outcomeSchema: JsonSchemaNode
  /** OUTCOME.md kind. */
  resultKind: OutcomeKind
  /**
   * Resolved agent-local skill content (Phase 3). One entry per skill referenced
   * by AGENT.md `skills:` that resolved to an `agents/<id>/skills/<skill_id>/`
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
 *   kind: proposal            # researcher | proposal
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
  /** Human guidance after the JSON-Schema fence — injected into the agent prompt. */
  prose: string
}

function parseOutcomeKind(frontmatterBlock: string): OutcomeKind | null {
  for (const line of frontmatterBlock.split('\n')) {
    const match = /^kind:\s*(.*)$/.exec(line.trim())
    if (!match) continue
    const value = match[1].trim().replace(/^['"]/, '').replace(/['"]$/, '').trim()
    if (value === 'researcher' || value === 'proposal') return value
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
  const prose = body.slice(fenceMatch.index + fenceMatch[0].length).trim()
  return { kind, schema: parsed as JsonSchemaNode, prose }
}

/**
 * Read the optional `agents/<id>/SAMPLE.json` example input, surfaced by the
 * Playground's "Insert sample" button. Pure JSON (no markdown/frontmatter) so it
 * needs no custom parser. Returns undefined when the file is absent or invalid
 * (a malformed sample must never block agent loading — the button just hides).
 * Must stay in sync with the generator's `discoverSampleInput`.
 */
function loadSampleInput(dir: string): unknown {
  const samplePath = path.join(dir, 'SAMPLE.json')
  if (!fs.existsSync(samplePath)) return undefined
  try {
    return JSON.parse(fs.readFileSync(samplePath, 'utf8'))
  } catch {
    logger.warn('malformed SAMPLE.json; ignoring', { dir })
    return undefined
  }
}

const FACT_SOURCES = ['input', 'payload', 'output'] as const
const FACT_FORMATS = ['text', 'number', 'boolean', 'percent'] as const

/**
 * Read the optional `agents/<id>/FACTS.json` Caseload fact declarations
 * (`{ "facts": [...] }` or a bare array of `{ label, source, path, format? }`).
 * Returns undefined when the file is absent or invalid — a malformed file must
 * never block agent loading; the Caseload panel just falls back to its generic
 * derivation. Must stay in sync with the generator's `discoverFacts`.
 */
function loadFacts(dir: string): AgentFact[] | undefined {
  const factsPath = path.join(dir, 'FACTS.json')
  if (!fs.existsSync(factsPath)) return undefined
  try {
    const parsed = JSON.parse(fs.readFileSync(factsPath, 'utf8')) as unknown
    const entries = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { facts?: unknown }).facts)
        ? ((parsed as { facts: unknown[] }).facts)
        : null
    if (!entries) throw new Error('expected an array or { "facts": [...] }')
    const facts = entries.filter((entry): entry is AgentFact => {
      const fact = entry as Partial<AgentFact> | null
      return Boolean(
        fact &&
          typeof fact.label === 'string' &&
          fact.label.trim() &&
          typeof fact.path === 'string' &&
          fact.path.trim() &&
          FACT_SOURCES.includes(fact.source as (typeof FACT_SOURCES)[number]) &&
          (fact.format === undefined ||
            FACT_FORMATS.includes(fact.format as (typeof FACT_FORMATS)[number])),
      )
    })
    return facts.length > 0 ? facts : undefined
  } catch (err) {
    logger.warn('malformed FACTS.json; ignoring', {
      dir,
      error: err instanceof Error ? err.message : String(err),
    })
    return undefined
  }
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
 *     the agent's `tools` allowlist exactly like a AGENT.md `tools:` entry, so
 *     it flows through the SAME central ACL + propose-only mutation gate (a
 *     referenced `isMutation:true` tool is rejected at load by `defineAgent`'s
 *     gate). Recommended — no new execution surface.
 *  2. LOCAL SANDBOXED form: any other `tools/*.ts` file is carried as a script
 *     (`{ name, source }`) registered under the synthetic skill id
 *     `__agent_tools__` and executed through the SAME `isolated-vm` sandbox as
 *     skill scripts via `run_skill_script` (skillId `__agent_tools__`). It can
 *     never touch fs/net/mutation or escape the sandbox, and is `isMutation:false`
 *     at the MCP boundary — so propose-only holds without generating an
 *     unsandboxed native unsandboxed tool file that would bypass the MCP ACL gate.
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
 * Resolve the agent-local skills referenced by AGENT.md `skills:`. For each id
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
      logger.warn('file agent skill not found; skipping', { skillId, skillsBase })
      continue
    }
    resolved.push(skill)
  }
  return resolved
}

/**
 * Load one sub-agent dir `agents/<id>/sub-agents/<subid>/` (Phase 4). Sub-agents
 * are full file agents (AGENT.md + OUTCOME.md) and MUST satisfy two hard
 * rules matching the
 * in-process `delegate_agent` contract):
 *
 *   1. OUTCOME `kind` MUST be `researcher` (sub-agents inform; only the primary
 *      proposes);
 *   2. it MUST NOT itself declare `subAgents` (depth cap = 1).
 *
 * A malformed sub-agent dir or a constraint violation THROWS with a clear
 * `[internal]` reason naming the dir (so the generator fails loudly), rather than
 * returning null — a present-but-invalid sub-agent must never be silently dropped.
 */
function loadSubAgentDir(dir: string): LoadedFileAgent {
  const agentMdPath = path.join(dir, 'AGENT.md')
  const outcomePath = path.join(dir, 'OUTCOME.md')
  if (!fs.existsSync(agentMdPath) || !fs.existsSync(outcomePath)) {
    throw new Error(`[internal] malformed sub-agent at ${dir}: both AGENT.md and OUTCOME.md are required`)
  }

  const agent = parseAgentMarkdown(fs.readFileSync(agentMdPath, 'utf8'))
  if (!agent) {
    throw new Error(`[internal] malformed AGENT.md at ${dir}: missing id/label/description`)
  }
  const outcome = parseOutcomeMarkdown(fs.readFileSync(outcomePath, 'utf8'))
  if (!outcome) {
    throw new Error(`[internal] malformed OUTCOME.md at ${dir}: missing kind or JSON-Schema block`)
  }
  if (outcome.kind !== 'researcher') {
    throw new Error(
      `[internal] sub-agent at ${dir} must be researcher (kind: researcher); sub-agents inform, only the primary proposes`,
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
    runtime: 'business-harness',
    sampleInput: loadSampleInput(dir),
    facts: loadFacts(dir),
  }

  return {
    entry,
    outcomeSchema: outcome.schema,
    resultKind: outcome.kind,
    skillsContent,
    subAgents: [],
  }
}

/**
 * Load every sub-agent under `agents/<id>/sub-agents/<subid>/` (Phase 4). Each
 * resolved child carries its own loaded `LoadedFileAgent` (full file agent,
 * constrained to researcher + non-delegating). Returns [] when the agent has no
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
 * Read `agents/<id>/{AGENT.md,OUTCOME.md}` (+ skills + sub-agents), validate,
 * compile the OUTCOME schema, and build an `AgentRegistryEntry` with
 * `runtime:'business-harness'`. Pure and fs-based (unit-testable against fixtures).
 * Returns null when the dir is not a valid agent (missing/malformed AGENT.md or
 * OUTCOME.md); the generator turns a null into a hard generation error naming the
 * dir. A present-but-invalid SUB-agent throws (so a constraint violation fails
 * loudly rather than being silently dropped).
 *
 * `subAgents` (loaded children) is populated from `agents/<id>/sub-agents/`; the
 * declared sub-agent ids are still carried on `entry.subAgents`.
 */
export function loadFileAgentDir(dir: string): LoadedFileAgent | null {
  const agentMdPath = path.join(dir, 'AGENT.md')
  const outcomePath = path.join(dir, 'OUTCOME.md')
  if (!fs.existsSync(agentMdPath) || !fs.existsSync(outcomePath)) return null

  const agentMdRaw = fs.readFileSync(agentMdPath, 'utf8')
  const outcomeRaw = fs.readFileSync(outcomePath, 'utf8')

  const agent = parseAgentMarkdown(agentMdRaw)
  if (!agent) return null

  const outcome = parseOutcomeMarkdown(outcomeRaw)
  if (!outcome) return null

  let resultSchema
  try {
    resultSchema = compileOutcome({ kind: outcome.kind, schema: outcome.schema }).resultSchema
  } catch {
    return null
  }

  // Phase 3: resolve agent-local skills referenced by AGENT.md `skills:` and
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
    runtime: 'business-harness',
    sampleInput: loadSampleInput(dir),
    facts: loadFacts(dir),
    files: agent.files,
  }

  return {
    entry,
    outcomeSchema: outcome.schema,
    resultKind: outcome.kind,
    skillsContent: effectiveSkillsContent,
    subAgents,
  }
}
