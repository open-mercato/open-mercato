import { AsyncLocalStorage } from 'node:async_hooks'
import type { AgentProcessSubject } from '../../data/validators'

/**
 * Async-scoped binding of the process `subject` descriptor during an
 * `INVOKE_AGENT` run (process subject & caseload projection spec, 2026-06-25).
 *
 * The workflow bridge wraps `agentRuntime.run(...)` in
 * `withProcessSubject(subject, …)`; the `proposals.create` command executes in
 * the SAME async context and attaches `getProcessSubject()` to the
 * `proposal.created` event payload — WITHOUT threading a new field through the
 * runner call chain and WITHOUT persisting a subject column on runs/proposals
 * (the descriptor lands only on the `agent_processes` projection). Same pattern
 * as `runtime/rerunContext.ts` / `runtime/runContext.ts`.
 */
const subjectStorage = new AsyncLocalStorage<AgentProcessSubject>()

/** Run `fn` with the INVOKE_AGENT node's subject descriptor bound. */
export function withProcessSubject<T>(
  subject: AgentProcessSubject | null,
  fn: () => Promise<T>,
): Promise<T> {
  if (!subject) return fn()
  return subjectStorage.run(subject, fn)
}

/** The in-flight run's subject descriptor, or undefined outside one. */
export function getProcessSubject(): AgentProcessSubject | undefined {
  return subjectStorage.getStore()
}
