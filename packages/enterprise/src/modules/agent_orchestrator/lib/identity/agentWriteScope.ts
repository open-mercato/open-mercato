import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Runtime no-bypass enforcement scopes (agent identity & on-behalf-of, Wave 4
 * Phase 3, layer B-b — the fail-closed flush-time write-interceptor).
 *
 * The invariant: every write whose actor is a `kind='agent'` principal MUST flow
 * through the audited Command path; a raw `em.flush()` reached with an agent actor
 * and no audited-command context is impossible at runtime — it throws.
 *
 * We thread TWO async-scoped signals through `AsyncLocalStorage` (the same
 * mechanism the in-process runtime already uses for `runContext`, so the signals
 * propagate across the whole agent run without plumbing a flag through every call
 * site):
 *
 *   1. The AGENT-ACTOR scope (`withAgentActor`) — set by the agent runtime for the
 *      duration of a run bound to a provisioned agent principal. While it is
 *      active, the flush-time subscriber treats EVERY write as an agent write and
 *      fails closed UNLESS the audited-command scope (2) is also active. This is
 *      what makes a raw `em.flush()` inside an agent run throw.
 *   2. The AUDITED-COMMAND scope (`withAuditedCommand`) — set by the agent's own
 *      audited Command writes (AgentRun / AgentProposal via the Command bus). A
 *      write nested inside it is the agent's legitimate, audited write and passes.
 *
 * Keying on "audited-command context present" (not "actor is agent") is the gap
 * doc's requirement: the agent's own AgentRun/AgentProposal Command writes carry
 * the flag and pass; any other write under an agent actor throws.
 */

export type AgentActorScope = {
  /** The provisioned agent principal's `auth.User` id (the run's actor). */
  agentUserId: string
  /** The invoking human (or null for system-invoked runs). */
  onBehalfOfUserId?: string | null
}

const agentActorStorage = new AsyncLocalStorage<AgentActorScope>()
const auditedCommandStorage = new AsyncLocalStorage<true>()

/**
 * Run `fn` with `scope` bound as the current agent-actor context. Established by
 * the runtime around the WHOLE run of a principal-bound agent so the flush-time
 * subscriber knows the active actor is `kind='agent'` without a DB lookup on the
 * hot path. Nesting (sub-agent delegation) re-binds the inner scope; the inner
 * actor is the one enforced for that frame.
 */
export function withAgentActor<T>(scope: AgentActorScope, fn: () => Promise<T>): Promise<T> {
  return agentActorStorage.run(scope, fn)
}

/** The active agent-actor scope, or undefined when no agent run is executing. */
export function getAgentActorScope(): AgentActorScope | undefined {
  return agentActorStorage.getStore()
}

/**
 * Run `fn` inside an audited-command scope. The agent's own audited Command
 * writes (AgentRun/AgentProposal through the Command bus) execute inside this so
 * they pass the flush-time guard; everything else under an agent actor does not.
 */
export function withAuditedCommand<T>(fn: () => Promise<T>): Promise<T> {
  return auditedCommandStorage.run(true, fn)
}

/** True iff the current async context is inside an audited Command write. */
export function isAuditedCommandActive(): boolean {
  return auditedCommandStorage.getStore() === true
}
