import type { EntityManager } from '@mikro-orm/postgresql'
import type { QueuedJob } from '@open-mercato/queue'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { processInboundDispatchJob, type InboundDispatchJob } from '../lib/inbound-dispatch'

const logger = createLogger('webhooks')

export const metadata = {
  queue: 'webhook-inbound-dispatch',
  id: 'webhooks:inbound-dispatch-worker',
  concurrency: 5,
}

export default async function handler(
  job: QueuedJob<InboundDispatchJob>,
  ctx: { resolve: <T = unknown>(name: string) => T },
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
      err: error,
    })
    throw error
  }
}
