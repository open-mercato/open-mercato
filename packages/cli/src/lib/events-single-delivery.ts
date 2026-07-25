import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import type { AutoSpawnWorkersMode } from './auto-spawn-workers'

// Keep these env names in sync with the runtime source of truth,
// `@open-mercato/events/single-delivery`. The CLI cannot import the events
// package (no dependency edge), so the reconcile logic is mirrored here for the
// server-bootstrap guard only; the bus and worker own the runtime behavior.
const EVENTS_SINGLE_DELIVERY_ENV = 'OM_EVENTS_SINGLE_DELIVERY'
const EVENTS_EXTERNAL_WORKER_ENV = 'OM_EVENTS_EXTERNAL_WORKER'

type EnvSource = NodeJS.ProcessEnv | Record<string, string | undefined>

export type SingleDeliveryReconciliation = {
  effective: boolean
  warning?: string
}

/**
 * Server-bootstrap guard for the default-on single-delivery dispatch.
 *
 * With single-delivery on, persistent subscribers are skipped inline and ONLY
 * the events worker dispatches them. A process that runs NO events worker
 * (auto-spawn off and no acknowledged external worker) would skip those
 * subscribers with nothing to drain the queue — silently dropping notifications,
 * queued emails, and indexing. This fails safe by disabling single-delivery for
 * such a process (back to inline dual-dispatch) and returning a loud warning.
 *
 * Transient worker downtime is NOT this guard's concern: the durable queue holds
 * the job until a worker returns. Only the "no worker at all" config is guarded.
 */
export function reconcileEventsSingleDelivery(
  env: EnvSource,
  autoSpawnWorkersMode: AutoSpawnWorkersMode,
): SingleDeliveryReconciliation {
  const requested = parseBooleanWithDefault(env[EVENTS_SINGLE_DELIVERY_ENV], true)
  if (!requested) return { effective: false }
  const externalWorker = parseBooleanWithDefault(env[EVENTS_EXTERNAL_WORKER_ENV], false)
  const workersAvailable = autoSpawnWorkersMode !== 'off' || externalWorker
  if (workersAvailable) return { effective: true }
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

/**
 * Applies {@link reconcileEventsSingleDelivery} and writes the effective value
 * into both the current process env (for the in-process app/bus) and the spawned
 * worker/child env (so a child worker reads the same value the bus does). Logs
 * the warning once when single-delivery is disabled for safety.
 */
export function applyEventsSingleDeliveryGuard(args: {
  processEnv: NodeJS.ProcessEnv
  runtimeEnv: NodeJS.ProcessEnv
  autoSpawnWorkersMode: AutoSpawnWorkersMode
}): SingleDeliveryReconciliation {
  const result = reconcileEventsSingleDelivery(args.processEnv, args.autoSpawnWorkersMode)
  if (result.warning) console.error(result.warning)
  const value = result.effective ? 'true' : 'false'
  args.processEnv[EVENTS_SINGLE_DELIVERY_ENV] = value
  args.runtimeEnv[EVENTS_SINGLE_DELIVERY_ENV] = value
  return result
}
