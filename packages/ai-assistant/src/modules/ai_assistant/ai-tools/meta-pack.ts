/**
 * General-purpose `meta.*` tool pack (Phase 1 WS-C, Step 3.8).
 *
 * `list_agents` enumerates agents the caller can invoke; `describe_agent`
 * returns a serializable description (Zod output schema → JSON-Schema when
 * possible, otherwise a `non-serializable` marker). Both tools treat a
 * missing agent registry as an empty list — the chat runtime must not
 * crash if `ai-agents.generated.ts` has not been emitted yet.
 */
import { z } from 'zod'
import type { AiAgentDefinition } from '../lib/ai-agent-definition'
import { listAgents, getAgent } from '../lib/agent-registry'
import { hasRequiredFeatures } from '../lib/auth'
import { defineAiTool } from '../lib/ai-tool-definition'
import type { AiToolDefinition } from '../lib/types'

function summarizeAgent(agent: AiAgentDefinition): Record<string, unknown> {
  return {
    id: agent.id,
    moduleId: agent.moduleId,
    label: agent.label,
    description: agent.description,
    requiredFeatures: agent.requiredFeatures ?? [],
    allowedTools: agent.allowedTools,
    executionMode: agent.executionMode ?? 'chat',
    mutationPolicy: agent.mutationPolicy ?? 'read-only',
    readOnly: typeof agent.readOnly === 'boolean' ? agent.readOnly : true,
    maxSteps: agent.maxSteps ?? null,
    acceptedMediaTypes: agent.acceptedMediaTypes ?? [],
    domain: agent.domain ?? null,
    keywords: agent.keywords ?? [],
    dataCapabilities: agent.dataCapabilities ?? null,
    hasOutputSchema: Boolean(agent.output),
    hasPageContextResolver: typeof agent.resolvePageContext === 'function',
  }
}

function serializeStructuredOutput(
  output: AiAgentDefinition['output'],
): Record<string, unknown> | null {
  if (!output) return null
  try {
    const jsonSchema = z.toJSONSchema(output.schema as unknown as z.ZodType, {
      unrepresentable: 'any',
    })
    return {
      schemaName: output.schemaName,
      mode: output.mode ?? 'generate',
      jsonSchema,
    }
  } catch (error) {
    return {
      schemaName: output.schemaName,
      mode: output.mode ?? 'generate',
      note: 'non-serializable',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function serializePrompt(agent: AiAgentDefinition): Record<string, unknown> {
  return {
    systemPrompt: agent.systemPrompt,
    hasDynamicPageContext: typeof agent.resolvePageContext === 'function',
  }
}

const listAgentsInput = z.object({
  moduleId: z.string().optional().describe('Restrict results to one module id.'),
})

const listAgentsTool = defineAiTool({
  name: 'meta.list_agents',
  displayName: 'List agents',
  description:
    'List registered AI agents the caller can invoke. Filters by requiredFeatures RBAC; returns { agents: [] } if the registry is empty.',
  inputSchema: listAgentsInput,
  requiredFeatures: ['ai_assistant.view'],
  tags: ['read', 'meta'],
  handler: async (rawInput, ctx) => {
    const input = listAgentsInput.parse(rawInput)
    let all: AiAgentDefinition[] = []
    try {
      all = listAgents()
    } catch {
      all = []
    }
    const filtered = all.filter((agent) => {
      if (input.moduleId && agent.moduleId !== input.moduleId) return false
      const features = agent.requiredFeatures ?? []
      return hasRequiredFeatures(features, ctx.userFeatures, ctx.isSuperAdmin)
    })
    return {
      agents: filtered.map(summarizeAgent),
      total: filtered.length,
    }
  },
})

const describeAgentInput = z.object({
  agentId: z.string().min(1).describe('Agent id (e.g. "catalog.merchandising_assistant").'),
})

const describeAgentTool = defineAiTool({
  name: 'meta.describe_agent',
  displayName: 'Describe agent',
  description:
    'Return metadata, RBAC, allowed tools, execution mode, output schema (JSON-Schema when representable), and prompt shape for a single agent. Never throws — returns { agent: null, reason } if missing or forbidden.',
  inputSchema: describeAgentInput,
  requiredFeatures: ['ai_assistant.view'],
  tags: ['read', 'meta'],
  handler: async (rawInput, ctx) => {
    const input = describeAgentInput.parse(rawInput)
    let agent: AiAgentDefinition | undefined
    try {
      agent = getAgent(input.agentId)
    } catch {
      agent = undefined
    }
    if (!agent) {
      return { agent: null, reason: 'not_found' as const }
    }
    const features = agent.requiredFeatures ?? []
    if (!hasRequiredFeatures(features, ctx.userFeatures, ctx.isSuperAdmin)) {
      return { agent: null, reason: 'forbidden' as const }
    }
    return {
      agent: {
        ...summarizeAgent(agent),
        output: serializeStructuredOutput(agent.output),
        prompt: serializePrompt(agent),
      },
    }
  },
})

export const metaAiTools: AiToolDefinition<any, any>[] = [listAgentsTool, describeAgentTool]

export default metaAiTools
