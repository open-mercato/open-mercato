import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { processWebhookDeliveryJob, type WebhookDeliveryJob } from '../lib/delivery'

const logger = createLogger('webhooks').child({ component: 'delivery' })

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
    logger.error('Job processing failed', {
      deliveryId: job.data.deliveryId,
      tenantId: job.data.tenantId,
      err: error,
    })
    throw error
  }
}
