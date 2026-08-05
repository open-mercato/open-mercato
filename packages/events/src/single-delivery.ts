import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'

/** Env var that toggles single-path persistent delivery. Defaults ON (see below). */
export const EVENTS_SINGLE_DELIVERY_ENV = 'OM_EVENTS_SINGLE_DELIVERY'
/**
 * Operator acknowledgment that an events worker runs OUT OF PROCESS (separate
 * `mercato queue worker` container/process), so the server bootstrap must not
 * disable single-delivery just because it does not auto-spawn workers itself.
 */
export const EVENTS_EXTERNAL_WORKER_ENV = 'OM_EVENTS_EXTERNAL_WORKER'

type EnvSource = Record<string, string | undefined>

/**
 * Whether single-path persistent delivery is requested.
 *
 * Default ON: a persistent emit is delivered on exactly one path — persistent
 * subscribers run in the events worker (matched by pattern, so wildcard
 * persistent subscribers are reached), ephemeral subscribers still run inline.
 * This is the correct behavior; the legacy dual-dispatch (inline AND worker)
 * double-ran exact-match persistent subscribers and never reached wildcard
 * persistent subscribers in the worker. Set the env to a false token to run
 * persistent subscribers inline instead. That is no longer dual-dispatch: the
 * producer stamps the queued job with what it already delivered, so the worker
 * skips it. Either way a persistent emit runs its subscribers exactly once.
 *
 * The `mercato server` bootstrap may rewrite the env to `false` for a process it
 * knows runs no worker (see {@link reconcileSingleDelivery}). The bus does NOT
 * second-guess the flag itself: the queue is durable, so a persistent emit with
 * no worker yet is delayed, not lost, and a worker started later drains the
 * backlog. The bus and the events worker read the same env, so they always agree
 * within a process.
 */
export function isSingleDeliveryRequested(env: EnvSource = process.env): boolean {
  return parseBooleanWithDefault(env[EVENTS_SINGLE_DELIVERY_ENV], true)
}

export function isExternalWorkerAcknowledged(env: EnvSource = process.env): boolean {
  return parseBooleanWithDefault(env[EVENTS_EXTERNAL_WORKER_ENV], false)
}

export type SingleDeliveryReconciliation = {
  /** The value the process should actually use. */
  effective: boolean
  /** Set when single-delivery was requested but disabled for safety. */
  warning?: string
}

/**
 * Guards the default-on single-delivery against the silent-loss failure mode:
 * with single-delivery on, persistent subscribers are skipped inline and ONLY
 * the events worker dispatches them. If no worker drains the queue, those
 * persistent side effects (notifications, queued emails, indexing) never run.
 *
 * The durable queue already covers transient worker downtime — a job persists
 * and drains when a worker returns. The dangerous case is a process configured
 * to run with NO events worker at all (auto-spawn off and no external worker).
 * For that case this fails safe: it disables single-delivery so persistent
 * subscribers run inline (dual-dispatch) and side effects are never dropped,
 * and surfaces a loud warning telling the operator how to opt back in.
 */
export function reconcileSingleDelivery(input: {
  requested: boolean
  workersAvailable: boolean
}): SingleDeliveryReconciliation {
  if (!input.requested) return { effective: false }
  if (input.workersAvailable) return { effective: true }
  return {
    effective: false,
    warning:
      `[events] ${EVENTS_SINGLE_DELIVERY_ENV} is on (default) but this process auto-spawns no events worker ` +
      `(AUTO_SPAWN_WORKERS=off) and ${EVENTS_EXTERNAL_WORKER_ENV} is not set. Persistent subscribers would be ` +
      `skipped inline with nothing to drain the queue, silently dropping notifications, queued emails, and ` +
      `indexing. Falling back to legacy inline dual-dispatch for safety. To keep single-delivery, run an events ` +
      `worker (\`mercato queue worker events\`) and set ${EVENTS_EXTERNAL_WORKER_ENV}=true, or enable ` +
      `AUTO_SPAWN_WORKERS.`,
  }
}
