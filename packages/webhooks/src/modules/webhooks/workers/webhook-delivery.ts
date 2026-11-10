import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { processWebhookDeliveryJob, type WebhookDeliveryJob } from '../lib/delivery'

const logger = createLogger('webhooks').child({ component: 'delivery' })

export const metadata: WorkerMeta = {
  queue: 'webhook-deliveries',
  id: 'webhooks:delivery-worker',
  concurrency: 10,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export default async function handler(
  job: QueuedJob<WebhookDeliveryJob>,
  ctx: HandlerContext,
) {
  const em = (ctx.resolve('em') as EntityManager).fork()
  try {
    await processWebhookDeliveryJob(em, job.payload, { resolver: ctx.resolve })
  } catch (error) {
    logger.error('Job processing failed', {
      deliveryId: job.payload?.deliveryId,
      tenantId: job.payload?.tenantId,
      organizationId: job.payload?.organizationId,
      err: error,
    })
    throw error
  }
}
