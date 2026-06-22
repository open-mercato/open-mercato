import type { ZodTypeAny } from 'zod'

/**
 * In-process correlation store binding an active OpenCode file-agent run to the
 * agent id + compiled OUTCOME schema the `submit_outcome` MCP tool must validate
 * against. The MCP HTTP server and the `OpenCodeAgentRunner` share a single Node
 * process, so a module-level Map is the correct, simplest seam:
 *
 *   1. The runner mints a per-run session token, derives the correlation key
 *      from it, and `register(...)`s the entry BEFORE sending the message.
 *   2. OpenCode calls `agent_orchestrator.submit_outcome`; the MCP server
 *      resolves the run's session token into the tool ctx (`ctx.sessionId`),
 *      the handler `get(...)`s the entry, validates the outcome, and
 *      `complete(...)`s it.
 *   3. The runner awaits the entry's deferred promise and reads the validated
 *      outcome back as the `AgentResult`.
 *
 * The key is the per-run session token (NOT trusted from the model): it is the
 * most reliable correlation handle the tool ctx exposes (the http-server sets
 * `ctx.sessionId = sessionToken`), and it is minted fresh per run so it cannot
 * collide across concurrent runs.
 */

export type OpenCodeRunEntry = {
  agentId: string
  resultSchema: ZodTypeAny
  /** The validated outcome captured by `submit_outcome`, once it arrives. */
  outcome?: unknown
}

type InternalEntry = OpenCodeRunEntry & {
  resolve: (outcome: unknown) => void
  promise: Promise<unknown>
  settled: boolean
}

export type OpenCodeRunHandle = {
  /** Resolves with the validated outcome once `complete(key, outcome)` runs. */
  readonly outcomePromise: Promise<unknown>
}

const registry = new Map<string, InternalEntry>()

/**
 * Register an active run. Returns a handle whose `outcomePromise` resolves when
 * `complete(key, outcome)` is called for the same key. Throws on a duplicate
 * key (a session token is minted fresh per run, so a collision is a bug).
 */
export function register(
  key: string,
  input: { agentId: string; resultSchema: ZodTypeAny },
): OpenCodeRunHandle {
  if (registry.has(key)) {
    throw new Error('[internal] duplicate OpenCode run correlation key')
  }
  let resolve!: (outcome: unknown) => void
  const promise = new Promise<unknown>((res) => {
    resolve = res
  })
  registry.set(key, {
    agentId: input.agentId,
    resultSchema: input.resultSchema,
    resolve,
    promise,
    settled: false,
  })
  return { outcomePromise: promise }
}

/** Look up a run entry by correlation key. Returns undefined for missing/stale keys. */
export function get(key: string): OpenCodeRunEntry | undefined {
  const entry = registry.get(key)
  if (!entry) return undefined
  return { agentId: entry.agentId, resultSchema: entry.resultSchema, outcome: entry.outcome }
}

/**
 * Store the validated outcome and signal completion so the waiting runner
 * resolves. No-op when the key is missing or already completed. Returns true
 * when this call performed the completion.
 */
export function complete(key: string, outcome: unknown): boolean {
  const entry = registry.get(key)
  if (!entry || entry.settled) return false
  entry.outcome = outcome
  entry.settled = true
  entry.resolve(outcome)
  return true
}

/** Remove a run entry. Always called by the runner in a finally. */
export function dispose(key: string): void {
  registry.delete(key)
}
