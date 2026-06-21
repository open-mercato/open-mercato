import {
  defineAiAgent,
  type AiAgentDefinition,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-agent-definition'
import type { ZodTypeAny } from 'zod'

export type AgentResultKind = 'actionable' | 'informative'

export interface DefineAgentInput {
  /** 'module.agent' — STABLE contract id (see BACKWARD_COMPATIBILITY.md). */
  id: string
  moduleId: string
  label: string
  description: string
  /** System prompt → AiAgentDefinition.systemPrompt. */
  instructions: string
  /** defineAiTool ids, READ-ONLY (propose-only is structural; see the runtime). */
  tools?: string[]
  /** SKILL.md pack ids — MVP appends to instructions; progressive disclosure deferred. */
  skills?: string[]
  defaultProvider?: string
  defaultModel?: string
  /** Object-safe loop subset only. */
  loop?: { maxSteps?: number }
  /** Zod from data/validators.ts; IS the output.schema (single source). */
  result: { kind: AgentResultKind; schema: ZodTypeAny }
}

export interface AgentRegistryEntry {
  id: string
  resultKind: AgentResultKind
  schema: ZodTypeAny
  tools: string[]
  skills: string[]
  label: string
  description: string
}

const registry = new Map<string, AgentRegistryEntry>()

export function defineAgent(input: DefineAgentInput): AiAgentDefinition {
  if (registry.has(input.id)) {
    throw new Error(`[internal] duplicate agent id "${input.id}"`)
  }
  registry.set(input.id, {
    id: input.id,
    resultKind: input.result.kind,
    schema: input.result.schema,
    tools: input.tools ?? [],
    skills: input.skills ?? [],
    label: input.label,
    description: input.description,
  })
  const systemPrompt = input.skills?.length
    ? `${input.instructions}\n\n${input.skills.map((skill) => `[skill:${skill}]`).join('\n')}`
    : input.instructions
  return defineAiAgent({
    id: input.id,
    moduleId: input.moduleId,
    label: input.label,
    description: input.description,
    systemPrompt,
    // READ-only allowlist; object mode never passes tools to the model.
    allowedTools: input.tools ?? [],
    executionMode: 'object',
    readOnly: true,
    mutationPolicy: 'read-only',
    defaultProvider: input.defaultProvider,
    defaultModel: input.defaultModel,
    loop: input.loop,
    output: { schemaName: input.id.replace(/\W+/g, '_'), schema: input.result.schema },
  })
}

export function getAgentEntry(id: string): AgentRegistryEntry | undefined {
  return registry.get(id)
}

export function listAgentEntries(): AgentRegistryEntry[] {
  return [...registry.values()]
}
