import { AsyncLocalStorage } from 'node:async_hooks'
import type { IntegrityToolCall } from '../guardrails/integrity/types'
import type { AgentInvoker } from './persistence'

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
export type RunToolCallSink = (toolCall: IntegrityToolCall) => void

type RunContext = {
  runId: string
  source?: 'runtime' | 'eval'
  invoker?: AgentInvoker
  toolCallSink?: RunToolCallSink
}

const runIdStorage = new AsyncLocalStorage<RunContext>()

/**
 * Run `fn` with the current in-process agent run bound.
 *
 * `source` rides along for the same reason `runId` does: a nested
 * `delegate_agent` call builds a fresh `AgentRunCtx` and would otherwise lose the
 * eval tag, so an eval replay's sub-agent runs would be stamped `runtime` and
 * counted in the agent's PRODUCTION metric rollups.
 *
 * `invoker` rides along so a nested `delegate_agent` run is invoke-checked
 * against the PARENT run's invoker, never laundered through the tool caller.
 *
 * `toolCallSink` lets a nested in-process run forward its tool calls to the
 * parent run (the `tool_consulted` rule's `includeSubRuns`).
 */
export function withRunContext<T>(
  runId: string,
  fn: () => Promise<T>,
  source?: 'runtime' | 'eval',
  invoker?: AgentInvoker,
  toolCallSink?: RunToolCallSink,
): Promise<T> {
  return runIdStorage.run({ runId, source, invoker, ...(toolCallSink ? { toolCallSink } : {}) }, fn)
}

/** The current in-process agent run id, or undefined outside a run context. */
export function getCurrentRunId(): string | undefined {
  return runIdStorage.getStore()?.runId
}

/** The current run's origin, so nested delegations can inherit the eval tag. */
export function getCurrentRunSource(): 'runtime' | 'eval' | undefined {
  return runIdStorage.getStore()?.source
}

/** The current run's invoker, so a nested delegation is checked against it. */
export function getCurrentRunInvoker(): AgentInvoker | undefined {
  return runIdStorage.getStore()?.invoker
}

/** The current run's tool-call sink, so a nested run can forward its tool calls. */
export function getCurrentRunToolCallSink(): RunToolCallSink | undefined {
  return runIdStorage.getStore()?.toolCallSink
}
