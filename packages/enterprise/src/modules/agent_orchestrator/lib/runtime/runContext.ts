import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Async-scoped binding of the currently-executing in-process agent run id, used
 * to wire the `agent_runs.parent_run_id` nested trace (Phase 4) for the
 * IN-PROCESS `delegate_agent` path WITHOUT threading a new field through the
 * cross-package AI tool-execution plumbing (`runAiAgentObject` → tool ctx).
 *
 * The in-process runner runs the agent body inside `withRunContext(runId, …)`.
 * When that agent calls the read-only `delegate_agent` tool, the tool handler
 * runs in the SAME async context, so `getCurrentRunId()` returns the parent run's
 * id; the handler passes it as `ctx.parentRunId` to the nested `agentRuntime.run`,
 * which stamps it onto the nested AgentRun.
 *
 * OpenCode-NATIVE `task` delegation runs sub-agents inside OpenCode (not via our
 * runner / not in this async context), so it does NOT populate `parent_run_id` —
 * that path's nested-run recording is a documented follow-up.
 */
type RunContext = { runId: string; source?: 'runtime' | 'eval' }

const runIdStorage = new AsyncLocalStorage<RunContext>()

/**
 * Run `fn` with the current in-process agent run bound.
 *
 * `source` rides along for the same reason `runId` does: a nested
 * `delegate_agent` call builds a fresh `AgentRunCtx` and would otherwise lose the
 * eval tag, so an eval replay's sub-agent runs would be stamped `runtime` and
 * counted in the agent's PRODUCTION metric rollups.
 */
export function withRunContext<T>(
  runId: string,
  fn: () => Promise<T>,
  source?: 'runtime' | 'eval',
): Promise<T> {
  return runIdStorage.run({ runId, source }, fn)
}

/** The current in-process agent run id, or undefined outside a run context. */
export function getCurrentRunId(): string | undefined {
  return runIdStorage.getStore()?.runId
}

/** The current run's origin, so nested delegations can inherit the eval tag. */
export function getCurrentRunSource(): 'runtime' | 'eval' | undefined {
  return runIdStorage.getStore()?.source
}
