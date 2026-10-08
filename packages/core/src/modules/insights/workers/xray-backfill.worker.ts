import type { AbandonedJobInfo, JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { failAbandonedXrayScan, runXrayBackfillJob } from '../lib/projection/jobs'
import { readBackfillPayload } from '../lib/projection/payloads'

const logger = createLogger('insights').child({ component: 'xray-backfill-worker' })

const XRAY_BACKFILL_QUEUE = 'insights-xray-backfill'

/**
 * Clears the range scan behind a job the queue gave up on and fails its progress job, so the
 * organization is not left `backfilling` with nothing running. Repeated delivery is a no-op:
 * the scan is cleared only while it is still the active one.
 */
export async function onXrayBackfillAbandoned(job: unknown, info: AbandonedJobInfo): Promise<void> {
  const payload = readBackfillPayload((job as { payload?: unknown } | null)?.payload)
  if (!payload) return
  const container = await createRequestContainer()
  await failAbandonedXrayScan(container, payload, info.reason)
}

export const metadata: WorkerMeta = {
  queue: XRAY_BACKFILL_QUEUE,
  id: 'insights:xray-backfill',
  concurrency: 1,
  onJobAbandoned: onXrayBackfillAbandoned,
}

/**
 * One slice of a resumable range scan (backfill, nightly or weekly reconciliation). The scan
 * position is persisted after every page, so a killed or retried job resumes where the last
 * committed page ended; a slice that runs out of budget enqueues the next one.
 */
export default async function handle(job: QueuedJob<unknown>, _ctx: JobContext): Promise<void> {
  const payload = readBackfillPayload(job.payload)
  if (!payload) {
    logger.warn('Skipping X-Ray backfill: the job payload is invalid')
    return
  }
  try {
    const container = await createRequestContainer()
    const status = await runXrayBackfillJob(container, payload)
    logger.debug('X-Ray backfill slice finished', { organizationId: payload.scope.organizationId, scanId: payload.scanId, status })
  } catch (error) {
    logger.error('[internal] X-Ray backfill slice failed', { organizationId: payload.scope.organizationId, scanId: payload.scanId, err: error })
    getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.xray_backfill_failed' })
    throw error
  }
}
