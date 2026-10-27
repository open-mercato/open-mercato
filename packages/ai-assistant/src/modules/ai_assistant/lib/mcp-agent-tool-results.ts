import { z, type ZodType, type ZodTypeAny } from 'zod'
import { getAgent, loadAgentRegistry } from './agent-registry'
import { resolveAiAgentRunDispatcher } from './agent-run-dispatcher'
import { jsonSchemaToZod } from './schema-utils'
import type { AiToolAgentRef, AiToolMcpOptions } from './types'

export type McpStructuredResultTool = {
  name: string
  isMutation?: boolean
  mcp?: AiToolMcpOptions
  agentRef?: AiToolAgentRef
}

export type AgentToolCallPayload = {
  result: unknown
  agentId: string
  runId: string | null
  agentRunId: string | null
}

export type AgentToolAuditIds = {
  agentId?: string | null
  aiAgentRunId?: string | null
  agentRunId?: string | null
}

export type McpToolSuccessResponse = {
  content: Array<{ type: 'text'; text: string }>
  structuredContent?: Record<string, unknown>
}

type DispatcherContainer = {
  resolve<T>(name: string): T
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function resolveAdvertisedOutputSchema(tool: McpStructuredResultTool): ZodTypeAny | null {
  if (tool.isMutation === true) return null
  return tool.mcp?.outputSchema ?? null
}

export function toolOutputJsonSchema(schema: ZodTypeAny): Record<string, unknown> | null {
  try {
    const jsonSchema = z.toJSONSchema(schema, { io: 'output', unrepresentable: 'any' }) as Record<string, unknown>
    return jsonSchema.type === 'object' ? jsonSchema : null
  } catch {
    return null
  }
}

export function advertisedOutputJsonSchema(tool: McpStructuredResultTool): Record<string, unknown> | null {
  const schema = resolveAdvertisedOutputSchema(tool)
  return schema ? toolOutputJsonSchema(schema) : null
}

export function advertisedOutputZodSchema(tool: McpStructuredResultTool): ZodType | null {
  const jsonSchema = advertisedOutputJsonSchema(tool)
  if (!jsonSchema) return null
  try {
    const converted = jsonSchemaToZod(jsonSchema)
    return converted instanceof z.ZodObject ? converted.passthrough() : null
  } catch {
    return null
  }
}

export function toAgentToolCallPayload(
  tool: McpStructuredResultTool,
  value: unknown,
): AgentToolCallPayload | null {
  if (!tool.agentRef) return null
  const record = isPlainRecord(value) ? value : {}
  return {
    result: 'result' in record ? record.result : value,
    agentId: readNullableString(record.agentId) ?? tool.agentRef.agentId,
    runId: readNullableString(record.runId),
    agentRunId: readNullableString(record.agentRunId),
  }
}

export function buildToolSuccessResponse(tool: McpStructuredResultTool, value: unknown): McpToolSuccessResponse {
  const agentPayload = toAgentToolCallPayload(tool, value)
  if (agentPayload) {
    return {
      content: [{ type: 'text', text: JSON.stringify(agentPayload, null, 2) }],
      structuredContent: agentPayload,
    }
  }
  const response: McpToolSuccessResponse = {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  }
  if (resolveAdvertisedOutputSchema(tool) && isPlainRecord(value)) {
    response.structuredContent = value
  }
  return response
}

export function resolveAgentToolAuditIds(
  tool: McpStructuredResultTool | undefined,
  value?: unknown,
): AgentToolAuditIds {
  if (!tool?.agentRef) return {}
  const payload = value === undefined ? null : toAgentToolCallPayload(tool, value)
  return {
    agentId: tool.agentRef.agentId,
    aiAgentRunId: payload?.runId ?? null,
    agentRunId: payload?.agentRunId ?? null,
  }
}

async function isAgentToolRunnable(
  agentRef: AiToolAgentRef,
  container: DispatcherContainer | null | undefined,
): Promise<boolean> {
  const dispatcher = resolveAiAgentRunDispatcher(container)
  if (dispatcher && dispatcher.owns(agentRef.agentId)) {
    try {
      return await dispatcher.isAvailable(agentRef.agentId)
    } catch {
      return false
    }
  }
  await loadAgentRegistry()
  return Boolean(getAgent(agentRef.agentId))
}

export async function filterRunnableAgentTools<TTool extends McpStructuredResultTool>(
  tools: TTool[],
  container: DispatcherContainer | null | undefined,
): Promise<TTool[]> {
  if (!tools.some((tool) => tool.agentRef)) return tools
  const runnable = await Promise.all(
    tools.map((tool) => (tool.agentRef ? isAgentToolRunnable(tool.agentRef, container) : Promise.resolve(true))),
  )
  return tools.filter((_tool, index) => runnable[index])
}
