import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { attachCorrelationMeta } from './mcp-audit'

const logger = createLogger('ai_assistant').child({ component: 'mcp-sdk-refusal-audit' })

const TOOLS_CALL_METHOD = 'tools/call'

export const MAX_REFUSED_TOOL_NAME_LENGTH = 128

export type McpSdkRefusalErrorCode = 'NOT_FOUND' | 'VALIDATION_ERROR'

export type McpSdkRefusedToolCall = {
  toolName: string
  args: Record<string, unknown>
  errorCode: McpSdkRefusalErrorCode
  durationMs: number
}

export type McpSdkRefusalAudit = {
  markHandled(extra: unknown): void
  markRegistered(toolName: string): void
  attach(server: McpServer): void
}

type ProtocolRequestHandler = (request: unknown, extra: object) => Promise<unknown>

type ToolCallParams = { name?: unknown; arguments?: unknown }

function readRequestHandlers(server: McpServer): Map<string, ProtocolRequestHandler> | null {
  const protocol = (server as { server?: unknown }).server
  if (!protocol || typeof protocol !== 'object') return null
  const handlers = (protocol as { _requestHandlers?: unknown })._requestHandlers
  return handlers instanceof Map ? (handlers as Map<string, ProtocolRequestHandler>) : null
}

function readToolCallParams(request: unknown): ToolCallParams {
  if (!request || typeof request !== 'object') return {}
  const params = (request as { params?: unknown }).params
  return params && typeof params === 'object' ? (params as ToolCallParams) : {}
}

function toArgsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function sanitizeRefusedToolName(name: string): string {
  return name.slice(0, MAX_REFUSED_TOOL_NAME_LENGTH).replace(/[\p{Cc}\p{Cf}]/gu, '?')
}

let missingHandlerLogged = false

function logMissingHandlerOnce(): void {
  if (missingHandlerLogged) return
  missingHandlerLogged = true
  logger.error('[internal] MCP SDK tools/call handler not found; refused tool calls will not be audited')
}

/**
 * The SDK `McpServer` refuses a `tools/call` for an unregistered name or invalid arguments before the
 * registered callback runs, so the callback-level audit never sees it. Every registered callback calls
 * `markHandled(extra)` and `markRegistered(name)`; `attach(server)` runs after registration and wraps the
 * SDK handler so any call that comes back unhandled is reported to `onRefused` (and gets
 * `_meta.correlationId`). The SDK's refusal result is otherwise unchanged.
 */
export function createMcpSdkRefusalAudit(
  onRefused: (call: McpSdkRefusedToolCall) => Promise<string>,
): McpSdkRefusalAudit {
  const handled = new WeakSet<object>()
  const registeredToolNames = new Set<string>()

  const reportRefusal = async (request: unknown, startedAt: number): Promise<string | null> => {
    const params = readToolCallParams(request)
    if (typeof params.name !== 'string' || params.name.length === 0) return null
    return onRefused({
      toolName: sanitizeRefusedToolName(params.name),
      args: toArgsRecord(params.arguments),
      errorCode: registeredToolNames.has(params.name) ? 'VALIDATION_ERROR' : 'NOT_FOUND',
      durationMs: Date.now() - startedAt,
    })
  }

  return {
    markHandled(extra: unknown) {
      if (extra && typeof extra === 'object') handled.add(extra)
    },
    markRegistered(toolName: string) {
      registeredToolNames.add(toolName)
    },
    attach(server: McpServer) {
      const handlers = readRequestHandlers(server)
      const sdkHandler = handlers?.get(TOOLS_CALL_METHOD)
      if (!handlers || !sdkHandler) {
        if (registeredToolNames.size > 0) logMissingHandlerOnce()
        return
      }
      handlers.set(TOOLS_CALL_METHOD, async (request: unknown, extra: object) => {
        const startedAt = Date.now()
        let result: unknown
        try {
          result = await sdkHandler(request, extra)
        } catch (error) {
          if (!handled.has(extra)) await reportRefusal(request, startedAt)
          throw error
        }
        if (handled.has(extra)) return result
        const correlationId = await reportRefusal(request, startedAt)
        if (!correlationId || !result || typeof result !== 'object') return result
        return attachCorrelationMeta(result, correlationId)
      })
    },
  }
}
