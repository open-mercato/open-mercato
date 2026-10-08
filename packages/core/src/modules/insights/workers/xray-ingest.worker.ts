import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { runXrayIngestJob } from '../lib/projection/jobs'
import { readIngestScope } from '../lib/projection/payloads'
import type { XrayIngestJobPayload } from '../lib/projection/queue'

const logger = createLogger('insights').child({ component: 'xray-ingest-worker' })

const XRAY_INGEST_QUEUE = 'insights-xray-ingest'

export const metadata: WorkerMeta = {
  queue: XRAY_INGEST_QUEUE,
  id: 'insights:xray-ingest',
  concurrency: 2,
}

/**
 * Scheduler tick (per organization, see `setup.ts`): one bounded, lease-guarded incremental
 * ingest run. Idempotent: every write is an `ON CONFLICT DO NOTHING` insert or a void of
 * already-projected rows, and a concurrent tick for the same organization skips on the lease.
 */
export default async function handle(job: QueuedJob<XrayIngestJobPayload>, _ctx: JobContext): Promise<void> {
  const scope = readIngestScope(job.payload)
  if (!scope) {
    logger.warn('Skipping X-Ray ingest: the job payload carries no tenant/organization scope')
    return
  }
  try {
    const container = await createRequestContainer()
    const result = await runXrayIngestJob(container, scope)
    logger.debug('X-Ray ingest tick finished', { organizationId: scope.organizationId, status: result.status })
  } catch (error) {
    logger.error('[internal] X-Ray ingest tick failed', { organizationId: scope.organizationId, err: error })
    getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.xray_ingest_failed' })
    throw error
  }
}
