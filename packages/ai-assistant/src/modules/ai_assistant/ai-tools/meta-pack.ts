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
import { listAgents, getAgent, loadAgentRegistry } from '../lib/agent-registry'
import { hasRequiredFeatures } from '../lib/auth'
import { defineAiTool } from '../lib/ai-tool-definition'
import {
  TASK_PLAN_DETAIL_MAX_CHARS,
  TASK_PLAN_ID_MAX_CHARS,
  TASK_PLAN_LABEL_MAX_CHARS,
  TASK_PLAN_MAX_TASKS,
  TASK_PLAN_TOOL_NAME_MAX_CHARS,
  looksLikeHiddenReasoning,
  sanitizeAgentTaskPlanInput,
} from '../lib/task-plan-labels'

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
    suggestions: agent.suggestions ?? [],
    taskPlan: agent.taskPlan ?? { enabled: false },
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
      // Lazy-load the registry on first use. The in-app agents route loads it
      // at request time; standalone MCP servers have no such bootstrap, so the
      // tool must ensure it itself. Idempotent — subsequent calls are no-ops.
      await loadAgentRegistry()
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
      // Lazy-load the registry on first use (see meta.list_agents). Idempotent.
      await loadAgentRegistry()
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

const visibleTaskLabel = z
  .string()
  .min(1)
  .max(TASK_PLAN_LABEL_MAX_CHARS)
  .superRefine((value, ctx) => {
    if (!looksLikeHiddenReasoning(value)) return
    ctx.addIssue({
      code: 'custom',
      message: 'Task-plan labels are user-visible UI copy and must not include private reasoning.',
    })
  })

const visibleTaskDetail = z
  .string()
  .max(TASK_PLAN_DETAIL_MAX_CHARS)
  .optional()
  .superRefine((value, ctx) => {
    if (!value || !looksLikeHiddenReasoning(value)) return
    ctx.addIssue({
      code: 'custom',
      message: 'Task-plan details must not include private reasoning.',
    })
  })

const updateTaskPlanInput = z.object({
  tasks: z
    .array(
      z.object({
        id: z.string().min(1).max(TASK_PLAN_ID_MAX_CHARS).optional(),
        label: visibleTaskLabel.describe('Concise user-visible step label. Do not include private reasoning.'),
        detail: visibleTaskDetail.describe('Optional short visible detail, not private reasoning.'),
        toolName: z
          .string()
          .min(1)
          .max(TASK_PLAN_TOOL_NAME_MAX_CHARS)
          .optional()
          .describe('Optional whitelisted tool name that this planned step maps to.'),
      }),
    )
    .min(1)
    .max(TASK_PLAN_MAX_TASKS),
})

const updateTaskPlanTool = defineAiTool({
  name: 'meta.update_task_plan',
  displayName: 'Update task plan',
  description:
    'Set the concise user-visible task plan for this assistant turn before calling domain tools. Labels are progress UI, not hidden reasoning.',
  inputSchema: updateTaskPlanInput,
  requiredFeatures: ['ai_assistant.view'],
  tags: ['read', 'meta', 'task-plan'],
  isMutation: false,
  handler: async (rawInput) => {
    const input = updateTaskPlanInput.parse(rawInput)
    const sanitized = sanitizeAgentTaskPlanInput(input)
    return {
      ok: sanitized.tasks.length > 0,
      tasks: sanitized.tasks,
      accepted: sanitized.tasks.length,
      dropped: input.tasks.length - sanitized.tasks.length,
    }
  },
})

export const metaAiTools = [
  listAgentsTool,
  describeAgentTool,
  updateTaskPlanTool,
]

export default metaAiTools
