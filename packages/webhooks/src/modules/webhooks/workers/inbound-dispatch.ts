import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { processInboundDispatchJob, type InboundDispatchJob } from '../lib/inbound-dispatch'

const logger = createLogger('webhooks')

export const metadata: WorkerMeta = {
  queue: 'webhook-inbound-dispatch',
  id: 'webhooks:inbound-dispatch-worker',
  concurrency: 5,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export default async function handler(
  job: QueuedJob<InboundDispatchJob>,
  ctx: HandlerContext,
) {
  const em = (ctx.resolve('em') as EntityManager).fork()
  try {
    await processInboundDispatchJob(em, job.payload, {
      resolve: <T,>(name: string) => ctx.resolve(name) as T,
    })
  } catch (error) {
    logger.error('Inbound dispatch job processing failed', {
      ingestionId: job.payload?.ingestionId,
      sourceKey: job.payload?.sourceKey,
      tenantId: job.payload?.tenantId,
      organizationId: job.payload?.organizationId,
      err: error,
    })
    throw error
  }
}
