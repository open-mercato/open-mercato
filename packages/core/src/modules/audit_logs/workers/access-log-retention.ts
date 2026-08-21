import { createModuleQueue, type JobContext, type Queue, type QueuedJob, type WorkerMeta } from '@open-mercato/queue'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  ACCESS_LOG_RETENTION_QUEUE,
  AccessLogService,
  resolveAccessLogRetentionBatchSize,
  resolveAccessLogRetentionDays,
} from '@open-mercato/core/modules/audit_logs/services/accessLogService'

export type AccessLogRetentionJobPayload = {
  accessClass?: 'all' | 'core' | 'non_core'
  batchSize?: number
  dryRun?: boolean
  organizationId?: string
  retentionDays?: number
  tenantId: string
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

const logger = createLogger('audit_logs').child({ component: 'access-log-retention-worker' })
let continuationQueue: Queue<AccessLogRetentionJobPayload> | null = null

function getContinuationQueue(): Queue<AccessLogRetentionJobPayload> {
  continuationQueue ??= createModuleQueue<AccessLogRetentionJobPayload>(
    ACCESS_LOG_RETENTION_QUEUE,
    { concurrency: 1 },
  )
  return continuationQueue
}

export const metadata: WorkerMeta = {
  queue: ACCESS_LOG_RETENTION_QUEUE,
  id: 'audit_logs:access-log-retention',
  concurrency: 1,
}

export default async function handle(
  job: QueuedJob<AccessLogRetentionJobPayload>,
  context: HandlerContext,
): Promise<void> {
  const accessClass = job.payload.accessClass ?? 'all'
  const batchSize = job.payload.batchSize ?? resolveAccessLogRetentionBatchSize()
  const retentionDays = job.payload.retentionDays ?? resolveAccessLogRetentionDays(accessClass)
  const service = context.resolve<AccessLogService>('accessLogService')
  const result = await service.applyRetention({
    accessClass,
    batchSize,
    dryRun: job.payload.dryRun ?? false,
    organizationId: job.payload.organizationId,
    retentionDays,
    tenantId: job.payload.tenantId,
  })

  logger.info('Access-log retention batch completed', {
    accessClass: result.accessClass,
    deleted: result.deleted,
    dryRun: result.dryRun,
    matched: result.matched,
    organizationId: job.payload.organizationId ?? null,
    retentionDays: result.retentionDays,
    tenantId: job.payload.tenantId,
  })

  if (!result.dryRun && result.deleted >= result.batchSize) {
    await getContinuationQueue().enqueue(job.payload, { delayMs: 1000 })
  }
}
