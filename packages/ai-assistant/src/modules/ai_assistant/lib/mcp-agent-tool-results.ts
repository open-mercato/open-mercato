import { z, type ZodType, type ZodTypeAny } from 'zod'
import { getAgent, loadAgentRegistry } from './agent-registry'
import {
  resolveAiAgentRunDispatcher,
  resolveDispatchOwner,
  type AiAgentRunDispatcher,
} from './agent-run-dispatcher'
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
  pendingActionIds?: string[]
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

function readPendingActionIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const ids = value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
  return ids.length > 0 ? ids : null
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

type AdvertisedOutputSchema = { jsonSchema: Record<string, unknown>; zodSchema: ZodType }

function toPassthroughZod(jsonSchema: Record<string, unknown>): ZodType | null {
  try {
    const converted = jsonSchemaToZod(jsonSchema)
    return converted instanceof z.ZodObject ? converted.passthrough() : null
  } catch {
    return null
  }
}

function resolveAdvertisedOutput(tool: McpStructuredResultTool): AdvertisedOutputSchema | null {
  const schema = resolveAdvertisedOutputSchema(tool)
  const jsonSchema = schema ? toolOutputJsonSchema(schema) : null
  const zodSchema = jsonSchema ? toPassthroughZod(jsonSchema) : null
  return jsonSchema && zodSchema ? { jsonSchema, zodSchema } : null
}

export function advertisedOutputJsonSchema(tool: McpStructuredResultTool): Record<string, unknown> | null {
  return resolveAdvertisedOutput(tool)?.jsonSchema ?? null
}

export function advertisedOutputZodSchema(tool: McpStructuredResultTool): ZodType | null {
  return resolveAdvertisedOutput(tool)?.zodSchema ?? null
}

export function toAgentToolCallPayload(
  tool: McpStructuredResultTool,
  value: unknown,
): AgentToolCallPayload | null {
  if (!tool.agentRef) return null
  const record = isPlainRecord(value) ? value : {}
  const pendingActionIds = readPendingActionIds(record.pendingActionIds)
  return {
    result: 'result' in record ? record.result : value,
    agentId: readNullableString(record.agentId) ?? tool.agentRef.agentId,
    runId: readNullableString(record.runId),
    agentRunId: readNullableString(record.agentRunId),
    ...(pendingActionIds ? { pendingActionIds } : {}),
  }
}

export function resolveAgentToolPendingActionIds(
  tool: McpStructuredResultTool | undefined,
  value: unknown,
): string[] | null {
  if (!tool?.agentRef || value === undefined) return null
  return toAgentToolCallPayload(tool, value)?.pendingActionIds ?? null
}

export function buildToolSuccessResponse(tool: McpStructuredResultTool, value: unknown): McpToolSuccessResponse {
  const payload: unknown = toAgentToolCallPayload(tool, value) ?? value
  const response: McpToolSuccessResponse = {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  }
  if (resolveAdvertisedOutput(tool) && isPlainRecord(payload)) {
    response.structuredContent = payload
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
    return isDispatcherAgentAvailable(dispatcher, agentRef.agentId)
  }
  await loadAgentRegistry()
  const knownLocally = Boolean(getAgent(agentRef.agentId))
  if (knownLocally) return true
  return resolveDispatchOwner(dispatcher, agentRef.agentId, { knownLocally })
}

async function isDispatcherAgentAvailable(dispatcher: AiAgentRunDispatcher, agentId: string): Promise<boolean> {
  try {
    return await dispatcher.isAvailable(agentId)
  } catch {
    return false
  }
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
