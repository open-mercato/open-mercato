import {
  defineAiAgent,
  type AiAgentDefinition,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-agent-definition'
import { sanitizeToolNameForModel } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-tools'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  DELEGATE_TOOL_ID,
  FILE_AGENT_LOAD_SKILL_TOOL_ID,
  FILE_AGENT_RUN_SKILL_SCRIPT_TOOL_ID,
  type AgentRegistryEntry,
  type AgentRuntime,
} from './defineAgent'
import { compileOutcome, type JsonSchemaNode } from './outcomeSchema'
import { stripOptionalNulls, toStrictOutcomeSchema } from './strictOutcomeSchema'
import type { FileAgentFile } from '../tokens/types'

const logger = createLogger('agent_orchestrator').child({ component: 'file-agent-native' })

export const FILE_AGENT_DELEGATE_TOOL_ID = DELEGATE_TOOL_ID
export { FILE_AGENT_LOAD_SKILL_TOOL_ID, FILE_AGENT_RUN_SKILL_SCRIPT_TOOL_ID }
const AGENT_TOOLS_SKILL_ID = '__agent_tools__'
const OPENCODE_MCP_SERVER_KEY = 'open-mercato'

/**
 * Deprecation bridge for the native flip (lightweight-agent-runtime spec Phase 3).
 * `opencode` routes every file agent back to the OpenCode runner for one minor
 * version; anything else (the default) runs file agents natively.
 */
export const FILE_AGENT_RUNTIME_ENV = 'OM_AGENT_FILE_AGENT_RUNTIME'

// On globalThis, not a module-level flag: Next.js can bootstrap the app again in
// the same process with a fresh copy of this module, which re-armed a module flag.
const BRIDGE_WARNING_KEY = '__openMercatoFileAgentRuntimeBridgeWarningEmitted__'
const bridgeWarningState = globalThis as Record<string, unknown>

export type FileAgentSkillSource = {
  id: string
  instructions: string
  template?: string
  scripts?: Array<{ name: string }>
}

/**
 * Pick the runtime a file-defined agent registers with.
 *
 * Native is the default. The file plane is not supported on native (no sandbox
 * filesystem): a manifest-loaded agent whose AGENT.md opts into `files` runs
 * natively WITHOUT it, and the native runner drops its `__files` envelope. The
 * generated manifest does not carry `files`, so the `files.enabled` branch below
 * only applies to entries registered directly via `registerFileAgent`. An
 * `artifact` agent, whose contract is "write files to `out/`", stays on OpenCode.
 * The `OM_AGENT_FILE_AGENT_RUNTIME=opencode` bridge sends every file agent back to
 * OpenCode and logs a deprecation warning once per process.
 */
export function resolveFileAgentRuntime(
  entry: Pick<AgentRegistryEntry, 'id' | 'resultKind' | 'files'>,
): AgentRuntime {
  if ((process.env[FILE_AGENT_RUNTIME_ENV] ?? '').trim().toLowerCase() === 'opencode') {
    if (bridgeWarningState[BRIDGE_WARNING_KEY] !== true) {
      bridgeWarningState[BRIDGE_WARNING_KEY] = true
      logger.warn(
        `${FILE_AGENT_RUNTIME_ENV}=opencode is deprecated: file-defined agents run on the native runtime by default and the OpenCode runtime will be removed`,
      )
    }
    return 'opencode'
  }
  if (entry.files?.enabled) {
    logger.warn('file agent opts into the file plane, which only the OpenCode runtime provides; keeping it on OpenCode', {
      agentId: entry.id,
    })
    return 'opencode'
  }
  if (entry.resultKind === 'artifact') return 'opencode'
  return 'native'
}

/**
 * Give a native file agent a strict-mode variant of its OUTCOME schema for the
 * model, plus the mapping back onto the authored schema (see
 * `strictOutcomeSchema.ts`). The authored `schema` stays the validation contract.
 * A schema with an open object keeps the authored shape and is logged, because a
 * strict provider will reject it.
 */
export function attachStrictModelSchema(entry: AgentRegistryEntry): void {
  const authored = entry.outcomeSchema
  if (!authored || entry.resultKind === 'artifact') return
  const strict = toStrictOutcomeSchema(authored)
  if (!strict) {
    logger.warn('OUTCOME schema has an open object; strict structured-output providers will reject it', {
      agentId: entry.id,
    })
    return
  }
  entry.modelSchema = compileOutcome({ kind: entry.resultKind, schema: strict }).resultSchema
  const key = entry.resultKind === 'proposal' ? 'proposal' : 'data'
  entry.normalizeModelOutput = (raw) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || !(key in raw)) return raw
    const record = raw as Record<string, unknown>
    return { ...record, [key]: stripOptionalNulls(record[key], authored) }
  }
}

/** @internal Test hook — re-arm the once-per-process bridge warning. */
export function resetFileAgentRuntimeWarningForTests(): void {
  delete bridgeWarningState[BRIDGE_WARNING_KEY]
}

/**
 * Rewrite OpenCode MCP tool names (`open-mercato_<module>_<tool>`) that an
 * AGENT.md or skill names explicitly into the names the native tool loop exposes
 * to the model. Only tools on the agent's own allowlist are mapped, so the
 * rewrite can never point the model at a tool it cannot call.
 */
export function rewriteOpenCodeToolNames(text: string, allowedTools: readonly string[]): string {
  let rewritten = text
  const byLength = [...allowedTools].sort((left, right) => right.length - left.length)
  for (const toolId of byLength) {
    const openCodeName = `${OPENCODE_MCP_SERVER_KEY}_${toolId.replace(/\./g, '_')}`
    if (!rewritten.includes(openCodeName)) continue
    rewritten = rewritten.split(openCodeName).join(sanitizeToolNameForModel(toolId))
  }
  return rewritten
}

const OUTCOME_FENCE_RE = /```json\s*\n[\s\S]*?\n```/

/**
 * The OUTCOME.md guidance that follows the JSON-Schema fence (or, for a
 * schemaless artifact outcome, the whole body). Read from the baked source files
 * so the native prompt carries the same guidance OpenCode rendered.
 */
export function extractOutcomeProse(sourceFiles: readonly FileAgentFile[] | undefined): string {
  const outcome = sourceFiles?.find((file) => file.path === 'OUTCOME.md')
  if (!outcome) return ''
  const body = outcome.content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '')
  const fence = OUTCOME_FENCE_RE.exec(body)
  if (!fence) return body.trim()
  return body.slice(fence.index + fence[0].length).trim()
}

function renderSkillsSection(skills: readonly FileAgentSkillSource[], loadSkillTool: string, runScriptTool: string): string | null {
  const playbooks = skills.filter((skill) => skill.id !== AGENT_TOOLS_SKILL_ID)
  const localTools = skills.find((skill) => skill.id === AGENT_TOOLS_SKILL_ID)?.scripts ?? []
  const lines: string[] = []
  if (playbooks.length) {
    lines.push(
      '## Skills',
      `Load a skill's full instructions, template and examples by calling \`${loadSkillTool}\` with \`{ skillId }\` before you rely on it. Available skills: ${playbooks.map((skill) => skill.id).join(', ')}.`,
    )
    const scripted = playbooks.flatMap((skill) =>
      (skill.scripts ?? []).map((script) => `${skill.id}/${script.name}`),
    )
    if (scripted.length) {
      lines.push(
        `Run a skill script with \`${runScriptTool}\` and \`{ skillId, scriptName, args }\`. Scripts: ${scripted.join(', ')}.`,
      )
    }
  }
  if (localTools.length) {
    lines.push(
      ...(lines.length ? [''] : []),
      '## Local tools',
      `Call a local tool with \`${runScriptTool}\` and \`{ skillId: "${AGENT_TOOLS_SKILL_ID}", scriptName, args }\`. Local tools: ${localTools.map((script) => script.name).join(', ')}.`,
    )
  }
  return lines.length ? lines.join('\n') : null
}

function renderOutcomeSection(
  kind: AgentRegistryEntry['resultKind'],
  schema: JsonSchemaNode | undefined,
  prose: string,
): string | null {
  if (!schema && !prose) return null
  const target = kind === 'proposal' ? 'the `proposal` object' : 'the `data` object'
  return [
    '## Outcome contract',
    ...(schema
      ? [
          `Return your result as the structured output. ${target[0].toUpperCase()}${target.slice(1)} MUST match this JSON Schema:`,
          '',
          '```json',
          JSON.stringify(schema, null, 2),
          '```',
        ]
      : []),
    ...(prose ? ['', prose] : []),
  ].join('\n')
}

/**
 * Build the ai-assistant definition a file-defined agent runs with on the native
 * runtime.
 *
 * This is the load-bearing propose-only gate for native file agents: on OpenCode
 * it was the generated agent file's deny-by-default allowlist plus the per-call
 * session ACL; on native it is `readOnly: true` + `mutationPolicy: 'read-only'`,
 * which makes the ai-assistant runtime strip every `isMutation: true` tool. The
 * allowlist is the agent's own tools, plus the skill tools when it has skills or
 * local tools, plus the delegation tool when it declares sub-agents — the same
 * set OpenCode allowed, minus `submit_outcome` (native returns structured output).
 *
 * `moduleId` defaults to the entry's own; a sub-agent descriptor carries none, so
 * the loader passes its parent's (it drives `OM_AI_<MODULE>_MODEL` resolution).
 */
export function buildFileAgentAiDefinition(
  entry: AgentRegistryEntry,
  skills: readonly FileAgentSkillSource[],
  moduleId: string = entry.moduleId,
): AiAgentDefinition {
  const skillTools = skills.length ? [FILE_AGENT_LOAD_SKILL_TOOL_ID, FILE_AGENT_RUN_SKILL_SCRIPT_TOOL_ID] : []
  const delegationTools = entry.subAgents.length ? [FILE_AGENT_DELEGATE_TOOL_ID] : []
  const allowedTools = Array.from(new Set([...entry.tools, ...skillTools, ...delegationTools]))
  const delegateTool = sanitizeToolNameForModel(FILE_AGENT_DELEGATE_TOOL_ID)
  const subAgentSection = entry.subAgents.length
    ? `## Sub-agents\nDelegate a sub-task by calling the \`${delegateTool}\` tool with \`{ agentId: "<sub-agent id>", input: <sub-task input object> }\`. Issue multiple \`${delegateTool}\` calls in the SAME step to fan out in parallel, then combine their results before returning your outcome. Available sub-agents: ${entry.subAgents.join(', ')}.`
    : null
  const skillsSection = renderSkillsSection(
    skills,
    sanitizeToolNameForModel(FILE_AGENT_LOAD_SKILL_TOOL_ID),
    sanitizeToolNameForModel(FILE_AGENT_RUN_SKILL_SCRIPT_TOOL_ID),
  )
  const outcomeSection = renderOutcomeSection(
    entry.resultKind,
    entry.outcomeSchema,
    extractOutcomeProse(entry.sourceFiles),
  )
  const systemPrompt = rewriteOpenCodeToolNames(
    [entry.instructions.trim(), skillsSection, subAgentSection, outcomeSection]
      .filter((section): section is string => Boolean(section))
      .join('\n\n'),
    allowedTools,
  )
  return defineAiAgent({
    id: entry.id,
    moduleId,
    label: entry.label,
    description: entry.description,
    systemPrompt,
    allowedTools,
    executionMode: 'object',
    readOnly: true,
    mutationPolicy: 'read-only',
    defaultProvider: entry.defaultProvider,
    defaultModel: entry.defaultModel,
    loop: entry.loop,
    output: { schemaName: entry.id.replace(/\W+/g, '_'), schema: entry.modelSchema ?? entry.schema },
    ...(entry.requiredFeatures ? { requiredFeatures: entry.requiredFeatures } : {}),
  })
}
