import type { AwilixContainer } from 'awilix'
import type { AgentRunSessionStore } from './agentRunSessionStore'
import { getCurrentRunAgentId } from './runContext'

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
  } catch {
    return null
  }
}
