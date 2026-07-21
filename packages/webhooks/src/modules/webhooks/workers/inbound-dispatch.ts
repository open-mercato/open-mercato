import type { EntityManager } from '@mikro-orm/postgresql'
import { processInboundDispatchJob, type InboundDispatchJob } from '../lib/inbound-dispatch'

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
    console.error('[webhooks:inbound-dispatch] Job processing failed', {
      ingestionId: job.data.ingestionId,
      sourceKey: job.data.sourceKey,
      tenantId: job.data.tenantId,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
