import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import {
  AGENT_ORCHESTRATOR_TRACE_CONTENT_RETENTION_QUEUE,
  type TraceContentRetentionJobPayload,
} from '../lib/queue'
import { purgeExpiredTraceContent } from '../lib/trace/contentRetention'

const logger = createLogger('agent_orchestrator').child({ worker: 'trace-content-retention' })

/**
 * Daily per-org purge of full-fidelity trace content artifacts older than the
 * tenant's `retentionDays`. Enqueued per org by the scheduler; keys come from
 * the scope's own spans and context bundles, so one job never touches another
 * tenant's content. Idempotent: an already-deleted object counts as deleted.
 */
export const metadata: WorkerMeta = {
  queue: AGENT_ORCHESTRATOR_TRACE_CONTENT_RETENTION_QUEUE,
  id: 'agent_orchestrator:trace-content-retention',
  concurrency: 1,
}

export default async function handle(
  job: QueuedJob<TraceContentRetentionJobPayload>,
  _ctx: JobContext,
): Promise<void> {
  const { scope } = job.payload
  if (!scope?.tenantId || !scope?.organizationId) return

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  try {
    const result = await purgeExpiredTraceContent(container, em, scope)
    logger.info('trace content retention finished', { scope, ...result })
  } catch (error) {
    logger.warn('trace content retention failed', {
      scope,
      error: error instanceof Error ? error.message : String(error),
    })
    getTelemetryRuntime()?.reportError(error, {
      module: 'agent_orchestrator',
      code: 'agent_orchestrator.trace_content_retention_failed',
      attributes: { tenantId: scope.tenantId, organizationId: scope.organizationId },
    })
  }
}
