import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { processInboundDispatchJob, type InboundDispatchJob } from '../lib/inbound-dispatch'

const logger = createLogger('webhooks')

export const metadata = {
  queue: 'webhook-inbound-dispatch',
  id: 'webhooks:inbound-dispatch-worker',
  concurrency: 5,
}

export default async function handler(
  job: { data: InboundDispatchJob },
  ctx: { resolve: <T = unknown>(name: string) => T },
) {
  const em = (ctx.resolve('em') as EntityManager).fork()
  try {
    await processInboundDispatchJob(em, job.data, {
      resolve: <T,>(name: string) => ctx.resolve(name) as T,
    })
  } catch (error) {
    logger.error('Inbound dispatch job processing failed', {
      ingestionId: job.data.ingestionId,
      sourceKey: job.data.sourceKey,
      tenantId: job.data.tenantId,
      err: error,
    })
    throw error
  }
}
