import type { AwilixContainer } from 'awilix'
import type { AgentRunSessionStore } from './agentRunSessionStore'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { getCurrentRunAgentId } from './runContext'

const logger = createLogger('agent_orchestrator').child({ component: 'active-agent' })

/**
 * Resolve the agent whose run a tool call belongs to, server-side — never from
 * model-supplied arguments.
 *
 * Native runs execute the tool loop inside `withRunContext`, so the agent id is
 * read from the async run context the runner bound. OpenCode runs reach the tool
 * through the separate MCP process, where that context is empty; there the run's
 * session token (`McpToolContext.sessionId`) is correlated through the
 * `agentRunSessionStore`. Returns null when neither source names an active run.
 */
export async function resolveActiveAgentId(
  container: AwilixContainer,
  sessionToken: string | null | undefined,
): Promise<string | null> {
  const inProcess = getCurrentRunAgentId()
  if (inProcess) return inProcess
  if (!sessionToken) return null
  try {
    const store = container.resolve('agentRunSessionStore') as AgentRunSessionStore
    return await store.resolveActiveAgentId(sessionToken)
  } catch (error) {
    logger.warn('could not resolve the active agent from the run session store', {
      error: error instanceof Error ? error.message : String(error),
    })
    getTelemetryRuntime()?.reportError(error, {
      module: 'agent_orchestrator',
      code: 'active_agent_resolve_failed',
    })
    return null
  }
}
