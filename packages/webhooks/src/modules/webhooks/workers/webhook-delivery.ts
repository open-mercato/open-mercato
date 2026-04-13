import type { EntityManager } from '@mikro-orm/postgresql'
import { processWebhookDeliveryJob, type WebhookDeliveryJob } from '../lib/delivery'

export const metadata = {
  queue: 'webhook-deliveries',
  id: 'webhooks:delivery-worker',
  concurrency: 10,
}

export default async function handler(
  job: { data: WebhookDeliveryJob },
  ctx: { resolve: <T = unknown>(name: string) => T },
) {
  const em = (ctx.resolve('em') as EntityManager).fork()
  try {
    await processWebhookDeliveryJob(em, job.data)
  } catch (error) {
    console.error('[webhooks:delivery] Job processing failed', {
      deliveryId: job.data.deliveryId,
      tenantId: job.data.tenantId,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
