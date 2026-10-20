import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { runXrayIngestFanout, runXrayIngestJob } from '../lib/projection/jobs'
import { XrayScopeMismatchError, readIngestPayload } from '../lib/projection/payloads'
import { ensureXrayIngestSchedule, type XrayIngestJobPayload } from '../lib/projection/queue'

const logger = createLogger('insights').child({ component: 'xray-ingest-worker' })

const XRAY_INGEST_QUEUE = 'insights-xray-ingest'

export const metadata: WorkerMeta = {
  queue: XRAY_INGEST_QUEUE,
  id: 'insights:xray-ingest',
  concurrency: 2,
}

/**
 * Two kinds of jobs share the queue. The system tick (`{ kind: 'xray_fanout' }`, one schedule for
 * the whole installation, see `setup.ts`) enqueues one job per organization cursor. An
 * organization job runs one bounded, lease-guarded incremental ingest slice. Idempotent: every
 * write is an `ON CONFLICT DO NOTHING` insert or a void of already-projected rows, and a
 * concurrent job for the same organization skips on the lease. A job fired by a per-organization
 * schedule of the previous design first migrates the installation to the system tick. A job whose
 * organization does not belong to its tenant is dropped (a retry cannot fix it).
 */
export default async function handle(job: QueuedJob<XrayIngestJobPayload>, _ctx: JobContext): Promise<void> {
  const payload = readIngestPayload(job.payload)
  if (!payload) {
    logger.warn('Skipping X-Ray ingest: the job payload is neither the system tick nor an organization scope')
    return
  }
  if (payload.kind === 'fanout') {
    try {
      const container = await createRequestContainer()
      const result = await runXrayIngestFanout(container)
      logger.debug('X-Ray ingest tick fanned out', { ...result })
    } catch (error) {
      logger.error('[internal] X-Ray ingest tick fan-out failed', { err: error })
      getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.xray_fanout_failed' })
      throw error
    }
    return
  }
  const scope = payload.scope
  try {
    const container = await createRequestContainer()
    if (payload.legacySchedule) await ensureXrayIngestSchedule(container)
    const result = await runXrayIngestJob(container, scope)
    logger.debug('X-Ray ingest job finished', { organizationId: scope.organizationId, status: result.status })
  } catch (error) {
    if (error instanceof XrayScopeMismatchError) {
      logger.warn(error.message, { tenantId: scope.tenantId, organizationId: scope.organizationId })
      return
    }
    logger.error('[internal] X-Ray ingest job failed', { organizationId: scope.organizationId, err: error })
    getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.xray_ingest_failed' })
    throw error
  }
}
