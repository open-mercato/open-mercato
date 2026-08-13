/**
 * Pure reader for the Playground's SUSPENDED arm (tracker 3.4).
 *
 * `POST /agents/:id/run` answers 202 with `{ status: 'suspended', runId }` when
 * the agent runs at an external provider: the call was placed and the answer
 * arrives on the callback minutes later. That is a 2xx, so the page's ordinary
 * `call.ok` path receives it — and would otherwise render it as an `AgentResult`
 * with no `kind`, i.e. as a blank success. This says which it is.
 *
 * Kept in its own file rather than beside `runErrorStateFromBody`: that helper
 * is documented as the mapping for a FAILED run, and a suspension is the exact
 * opposite — it is the one case where nothing went wrong and something real is
 * still happening.
 */

export type SuspendedRunState = {
  /** The persisted `AgentRun` id, so the operator can open the trace and watch it settle. */
  runId: string | null
  /** The provider's own run id, when the connector reported one. */
  externalRunId: string | null
}

/**
 * Returns the suspension when the body is one, `null` otherwise.
 *
 * Keyed off `status === 'suspended'` and nothing else: the field is explicit in
 * the route's 202 body, whereas "the result has no `kind`" would also match a
 * malformed success and would silently start claiming a call was placed when
 * none was.
 */
export function readSuspendedRun(body: unknown): SuspendedRunState | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const record = body as Record<string, unknown>
  if (record.status !== 'suspended') return null
  return {
    runId: typeof record.runId === 'string' && record.runId ? record.runId : null,
    externalRunId:
      typeof record.externalRunId === 'string' && record.externalRunId ? record.externalRunId : null,
  }
}
