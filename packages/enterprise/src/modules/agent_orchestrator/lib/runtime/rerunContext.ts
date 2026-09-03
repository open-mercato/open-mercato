import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Async-scoped binding of the source run id during a trace-inspector "Re-run",
 * used to stamp `agent_runs.rerun_of_run_id` on the new top-level run WITHOUT
 * threading a new field through the runner call chain (`agentRuntime.run` →
 * runner → `createRun`) — the same pattern as `runContext.ts` for
 * `parent_run_id`.
 *
 * The rerun route wraps `agentRuntime.run(...)` in `withRerunOf(sourceRunId, …)`;
 * the `runs.create` command executes in the SAME async context and reads
 * `getRerunOfRunId()`. Only the top-level run is stamped: nested sub-agent runs
 * created during the re-run carry a `parentRunId`, which the command uses to
 * skip the stamp.
 */
const rerunOfStorage = new AsyncLocalStorage<string>()

/** Run `fn` with `sourceRunId` bound as the run being re-run. */
export function withRerunOf<T>(sourceRunId: string, fn: () => Promise<T>): Promise<T> {
  return rerunOfStorage.run(sourceRunId, fn)
}

/** The source run id of the in-flight re-run, or undefined outside one. */
export function getRerunOfRunId(): string | undefined {
  return rerunOfStorage.getStore()
}
