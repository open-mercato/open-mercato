/**
 * Client-side view model for the EXTERNAL half of an agent run (tracker 3.4).
 *
 * Kept pure and React-free for the same reason `playgroundRunError.ts` and
 * `playgroundToolCalls.ts` are: the interesting logic here is a contract seam
 * (a REST projection) and a derivation (the two clocks), and both are worth
 * testing without mounting a page.
 */

export type ExternalRunStatus = 'pending' | 'completed' | 'failed' | 'expired' | 'cancelled'

export type ExternalRunView = {
  id: string
  connectorId: string
  status: ExternalRunStatus
  /** The provider's own run id (an ElevenLabs `conversation_id`); null before it is known. */
  externalRunId: string | null
  expiresAt: string | null
  createdAt: string | null
  updatedAt: string | null
  /** The parked workflow step, when the run was started by one. */
  processId: string | null
  stepId: string | null
  signalName: string | null
}

export type ExternalConnectorView = {
  id: string
  /** Whether the connector's package is loaded in the process serving this request. */
  registered: boolean
  /** Whether it implements `fetchRecording` — the ONLY thing that may reveal the recording control. */
  supportsRecording: boolean
}

export type ExternalRunStateView = {
  externalRun: ExternalRunView | null
  connector: ExternalConnectorView | null
}

const EXTERNAL_RUN_STATUSES: readonly ExternalRunStatus[] = [
  'pending',
  'completed',
  'failed',
  'expired',
  'cancelled',
]

/**
 * DS status variants for the correlation row's status.
 *
 * `pending` is `info`, not `warning`: a call in progress is the expected state
 * for most of its life, and colouring the normal case as a problem trains
 * operators to ignore the colour. `expired` and `cancelled` are `warning` rather
 * than `error` — nothing malfunctioned, we stopped waiting.
 */
export const EXTERNAL_RUN_STATUS_VARIANT: Record<ExternalRunStatus, 'info' | 'success' | 'error' | 'warning'> = {
  pending: 'info',
  completed: 'success',
  failed: 'error',
  expired: 'warning',
  cancelled: 'warning',
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function asStatus(value: unknown): ExternalRunStatus | null {
  return typeof value === 'string' && (EXTERNAL_RUN_STATUSES as readonly string[]).includes(value)
    ? (value as ExternalRunStatus)
    : null
}

/**
 * Map `GET /runs/:id/external`.
 *
 * Degrades to `{ externalRun: null, connector: null }` for every shape it does
 * not recognise — a native run (the common case), a server that predates the
 * route, a failed request whose `fallback` was an empty object. The run detail
 * simply renders no external card, which is the correct answer to all of them:
 * "there is no external run here" is exactly what the caller should conclude,
 * and an error banner would be one for the operator to act on when there is
 * nothing to act on.
 */
export function mapExternalRunState(payload: Record<string, unknown> | null | undefined): ExternalRunStateView {
  const raw = payload?.externalRun
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { externalRun: null, connector: null }
  const row = raw as Record<string, unknown>
  const id = asString(row.id)
  const connectorId = asString(row.connectorId)
  const status = asStatus(row.status)
  // A row missing any of the three identity facts is not a row we can describe
  // honestly, so it is treated as absent rather than rendered half-blank.
  if (!id || !connectorId || !status) return { externalRun: null, connector: null }

  const connectorRaw = payload?.connector
  const connectorRecord =
    connectorRaw && typeof connectorRaw === 'object' && !Array.isArray(connectorRaw)
      ? (connectorRaw as Record<string, unknown>)
      : null

  return {
    externalRun: {
      id,
      connectorId,
      status,
      externalRunId: asString(row.externalRunId),
      expiresAt: asString(row.expiresAt),
      createdAt: asString(row.createdAt),
      updatedAt: asString(row.updatedAt),
      processId: asString(row.processId),
      stepId: asString(row.stepId),
      signalName: asString(row.signalName),
    },
    connector: {
      id: asString(connectorRecord?.id) ?? connectorId,
      registered: connectorRecord?.registered === true,
      // Fails CLOSED: anything other than a literal `true` means no control is
      // offered. A button that cannot work is worse than a missing one.
      supportsRecording: connectorRecord?.supportsRecording === true,
    },
  }
}

export type ExternalRunClock = {
  /**
   * WALL CLOCK: how long the run existed, start to terminal state.
   *
   * T3.2 established that `completed_at − created_at` IS the park duration and
   * needs no column of its own: the run row opens before `connector.start()`
   * dials, and `completed_at` is stamped once at the terminal transition. Null
   * while the run is still in flight, and null for a legacy row that never had
   * `completed_at` backfilled.
   */
  parkedMs: number | null
  /**
   * The PROVIDER-REPORTED duration of the effector's work — for a voice run, how
   * long the two people talked. This is what `agent_runs.latency_ms` holds for an
   * external run (T3.2's decision), deliberately excluding the wait, so it stays
   * comparable to a native run's model latency.
   */
  talkedMs: number | null
}

/**
 * The two clocks of an external run, which are NOT the same number and are
 * routinely two orders of magnitude apart.
 *
 * "Parked for 28m, talked for 74s" is the sentence an operator needs: the first
 * number is how long the workflow waited on a human, the second is how much of
 * that was a conversation. Showing only the latency tile (all the run detail
 * could do before) makes a half-hour park look like a 74-millisecond-scale
 * event; showing only the wall clock makes every agent look slow because someone
 * took twenty minutes to answer their phone.
 */
export function deriveExternalRunClock(run: {
  createdAt: string | null
  completedAt: string | null
  latencyMs: number | null
}): ExternalRunClock {
  const startedMs = parseTimestamp(run.createdAt)
  const completedMs = parseTimestamp(run.completedAt)
  const parkedMs =
    startedMs != null && completedMs != null && completedMs >= startedMs ? completedMs - startedMs : null
  const talkedMs = typeof run.latencyMs === 'number' && Number.isFinite(run.latencyMs) && run.latencyMs >= 0
    ? run.latencyMs
    : null
  return { parkedMs, talkedMs }
}

/**
 * The PARK duration, in units a human waits in.
 *
 * `formatDurationMs` is right for everything it already formats — model
 * latencies and span bars, which live between milliseconds and a minute — and
 * renders a half-hour park as `1680.0s`. That is unreadable, and widening the
 * shared helper would silently re-render the span timeline and the duration tile
 * for every native run, which is not this task's to change. So the coarse clock
 * gets its own coarse formatter and the fine one is left alone.
 *
 * Two units at most: `28m`, `1h 5m`, `45s`. A third would be noise on a number
 * whose whole job is to be read at a glance.
 */
export function formatParkedDuration(ms: number | null): string | null {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainderMinutes = minutes % 60
  return remainderMinutes === 0 ? `${hours}h` : `${hours}h ${remainderMinutes}m`
}

function parseTimestamp(value: string | null): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}
