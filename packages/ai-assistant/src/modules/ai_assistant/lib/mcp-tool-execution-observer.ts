import { createLogger } from '@open-mercato/shared/lib/logger'
import { reportAiAssistantError } from './report-ai-assistant-error'

const logger = createLogger('ai_assistant').child({ component: 'mcp-tool-execution-observer' })

export const MCP_TOOL_EXECUTION_OBSERVER_DI_KEY = 'mcpToolExecutionObserver'

export type McpToolExecutionObserverContext = {
  sessionId?: string
  toolName: string
  tenantId: string | null
  organizationId: string | null
  correlationId?: string
}

/**
 * Optional DI hook (`mcpToolExecutionObserver`) wrapped around every MCP tool
 * execution in the HTTP server. A module registers it to bind async-scoped
 * state (run observation, audit correlation) for the duration of the call.
 * The session id is a credential: implementations MUST NOT log or persist it.
 */
export interface McpToolExecutionObserver {
  wrap<T>(ctx: McpToolExecutionObserverContext, fn: () => Promise<T>): Promise<T>
}

type ContainerLike = {
  resolve: (name: string, options?: { allowUnregistered?: boolean }) => unknown
}

function isObserver(value: unknown): value is McpToolExecutionObserver {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { wrap?: unknown }).wrap === 'function'
  )
}

function resolveObserver(container: ContainerLike): McpToolExecutionObserver | null {
  try {
    const resolved = container.resolve(MCP_TOOL_EXECUTION_OBSERVER_DI_KEY, { allowUnregistered: true })
    return isObserver(resolved) ? resolved : null
  } catch {
    return null
  }
}

type FnOutcome<T> = { status: 'ok'; value: T } | { status: 'error'; error: unknown }

/**
 * Runs `fn` through the registered observer, or directly when none is
 * registered. The tool runs at most once: a hook failure before `fn` started
 * falls back to calling `fn` directly; a hook failure after `fn` settled keeps
 * the tool's own outcome. Hook failures are logged and reported, never thrown.
 */
export async function runWithMcpToolExecutionObserver<T>(
  container: ContainerLike,
  ctx: McpToolExecutionObserverContext,
  fn: () => Promise<T>,
): Promise<T> {
  const observer = resolveObserver(container)
  if (!observer) return fn()
  let outcome: FnOutcome<T> | null = null
  const trackedFn = async (): Promise<T> => {
    if (outcome) {
      if (outcome.status === 'ok') return outcome.value
      throw outcome.error
    }
    try {
      const value = await fn()
      outcome = { status: 'ok', value }
      return value
    } catch (error) {
      outcome = { status: 'error', error }
      throw error
    }
  }
  try {
    return await observer.wrap(ctx, trackedFn)
  } catch (error) {
    const settled = outcome as FnOutcome<T> | null
    if (settled?.status === 'error' && settled.error === error) throw error
    logger.warn('MCP tool execution observer failed; continuing without it', {
      toolName: ctx.toolName,
      correlationId: ctx.correlationId,
      err: error instanceof Error ? error.message : String(error),
    })
    reportAiAssistantError(error, 'mcp_tool_execution_observer_failed', { toolName: ctx.toolName })
    if (!settled) return fn()
    if (settled.status === 'ok') return settled.value
    throw settled.error
  }
}
