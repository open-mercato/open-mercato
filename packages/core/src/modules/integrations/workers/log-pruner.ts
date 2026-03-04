import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { IntegrationLogService } from '../lib/log-service'

type LogPrunerPayload = {
  retentionDays: number
  scope: {
    organizationId: string
    tenantId: string
  }
}

export const metadata: WorkerMeta = {
  queue: 'integration-log-pruner',
  id: 'integrations:log-pruner',
  concurrency: 1,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(job: QueuedJob<LogPrunerPayload>, ctx: HandlerContext): Promise<void> {
  const logService = ctx.resolve<IntegrationLogService>('integrationLogService')
  const pruned = await logService.pruneOlderThan(job.payload.retentionDays, job.payload.scope)

  if (pruned > 0) {
    const logger = logService.scoped('integrations', job.payload.scope)
    await logger.info(`Pruned ${pruned} log entries older than ${job.payload.retentionDays} days`)
  }
}
