import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { runXraySuggestionJob } from '../lib/suggestions/job'
import { XrayScopeMismatchError, readSuggestionPayload } from '../lib/projection/payloads'

const logger = createLogger('insights').child({ component: 'xray-suggestions-worker' })

const XRAY_SUGGESTIONS_QUEUE = 'insights-xray-suggestions'

export const metadata: WorkerMeta = {
  queue: XRAY_SUGGESTIONS_QUEUE,
  id: 'insights:xray-suggestions',
  concurrency: 1,
}

/**
 * One automation suggestion mining pass of an organization, enqueued by the system ingest tick
 * when the organization is enabled, completely projected and its last pass is older than 24 hours
 * (or by the manage-only on-demand request, `force`). Bounded by the background analytics
 * statement timeout and event budget per process. Idempotent: suggestions are upserted by
 * signature and a duplicate job finds the fresh pass marker and stops. A job whose organization
 * does not belong to its tenant is dropped (a retry cannot fix it).
 */
export default async function handle(job: QueuedJob<unknown>, _ctx: JobContext): Promise<void> {
  const payload = readSuggestionPayload(job.payload)
  if (!payload) {
    logger.warn('Skipping X-Ray suggestion mining: the job payload is invalid')
    return
  }
  const scope = payload.scope
  try {
    const container = await createRequestContainer()
    const result = await runXraySuggestionJob(container, scope, { force: payload.force === true })
    logger.debug('X-Ray suggestion mining finished', { organizationId: scope.organizationId, ...result })
  } catch (error) {
    if (error instanceof XrayScopeMismatchError) {
      logger.warn(error.message, { tenantId: scope.tenantId, organizationId: scope.organizationId })
      return
    }
    logger.error('[internal] X-Ray suggestion mining failed', { organizationId: scope.organizationId, err: error })
    getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.xray_suggestions_failed' })
    throw error
  }
}
