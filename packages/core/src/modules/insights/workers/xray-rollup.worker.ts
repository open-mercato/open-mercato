import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { runXrayRollupJob } from '../lib/projection/jobs'
import { XrayScopeMismatchError, readRollupPayload } from '../lib/projection/payloads'

const logger = createLogger('insights').child({ component: 'xray-rollup-worker' })

const XRAY_ROLLUP_QUEUE = 'insights-xray-rollup'

export const metadata: WorkerMeta = {
  queue: XRAY_ROLLUP_QUEUE,
  id: 'insights:xray-rollup',
  concurrency: 1,
}

/**
 * One rollup pass of an organization, enqueued by the system ingest tick when the
 * organization's last pass is older than 15 minutes: precomputes the 7/30/90-day analytics in
 * the organization's time zone and prunes rollups of windows that ended. Idempotent (rollups are
 * upserted and never overwrite newer ones; a duplicate job finds the fresh pass and stops). A job
 * whose organization does not belong to its tenant is dropped (a retry cannot fix it).
 */
export default async function handle(job: QueuedJob<unknown>, _ctx: JobContext): Promise<void> {
  const payload = readRollupPayload(job.payload)
  if (!payload) {
    logger.warn('Skipping X-Ray rollup: the job payload is invalid')
    return
  }
  const scope = payload.scope
  try {
    const container = await createRequestContainer()
    const result = await runXrayRollupJob(container, scope)
    logger.debug('X-Ray rollup job finished', { organizationId: scope.organizationId, status: result.status })
  } catch (error) {
    if (error instanceof XrayScopeMismatchError) {
      logger.warn(error.message, { tenantId: scope.tenantId, organizationId: scope.organizationId })
      return
    }
    logger.error('[internal] X-Ray rollup job failed', { organizationId: scope.organizationId, err: error })
    getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.xray_rollup_failed' })
    throw error
  }
}
