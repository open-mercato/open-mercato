import type { AbandonedJobInfo, JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { failAbandonedSimulationRun, runSimulationMaintenance, runSimulationSlice } from '../lib/simulation/jobs'
import { isSimulationMaintenancePayload, readSimulationSlicePayload } from '../lib/simulation/queue'

const logger = createLogger('insights').child({ component: 'simulation-worker' })

const SIMULATION_QUEUE = 'insights-simulation'

/** Fails the run behind a slice job the queue gave up on (idempotent: terminal runs are left alone). */
export async function onSimulationJobAbandoned(job: unknown, info: AbandonedJobInfo): Promise<void> {
  const payload = readSimulationSlicePayload((job as { payload?: unknown } | null)?.payload)
  if (!payload) return
  logger.warn('[internal] The queue abandoned a simulation slice', { runId: payload.runId, reason: info.reason })
  const container = await createRequestContainer()
  await failAbandonedSimulationRun(container, payload)
}

export const metadata: WorkerMeta = {
  queue: SIMULATION_QUEUE,
  id: 'insights:simulation',
  concurrency: 2,
  onJobAbandoned: onSimulationJobAbandoned,
}

/**
 * Two kinds of jobs share the queue: slices of simulation runs (payload `{ runId, tenantId,
 * organizationId }` only) and the daily maintenance tick (`{ kind: 'simulation_maintenance' }`, a
 * system schedule). A slice never throws for a domain outcome (forbidden, cancelled, busy tenant,
 * failure): the run records it. Infrastructure failures are rethrown so the queue retries.
 */
export default async function handle(job: QueuedJob<unknown>, _ctx: JobContext): Promise<void> {
  if (isSimulationMaintenancePayload(job.payload)) {
    try {
      const container = await createRequestContainer()
      const result = await runSimulationMaintenance(container)
      logger.debug('Simulation maintenance finished', { ...result })
    } catch (error) {
      logger.error('[internal] Simulation maintenance failed', { err: error })
      getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.simulation_maintenance_failed' })
      throw error
    }
    return
  }
  const payload = readSimulationSlicePayload(job.payload)
  if (!payload) {
    logger.warn('Skipping a simulation job: the payload is invalid')
    return
  }
  try {
    const container = await createRequestContainer()
    const outcome = await runSimulationSlice(container, payload)
    logger.debug('Simulation slice finished', { runId: payload.runId, outcome })
  } catch (error) {
    logger.error('[internal] Simulation slice crashed', { runId: payload.runId, err: error })
    getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.simulation_worker_failed' })
    throw error
  }
}
