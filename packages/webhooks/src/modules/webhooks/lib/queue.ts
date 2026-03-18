import { createQueue, type Queue } from '@open-mercato/queue'
import { getRedisUrl } from '@open-mercato/shared/lib/redis/connection'
import type { WebhookDeliveryJob } from './delivery'

const queues = new Map<string, Queue<WebhookDeliveryJob>>()

export const WEBHOOK_DELIVERIES_QUEUE = 'webhook-deliveries'

export function getWebhookQueue(queueName: string = WEBHOOK_DELIVERIES_QUEUE): Queue<WebhookDeliveryJob> {
  const existing = queues.get(queueName)
  if (existing) return existing

  const created = process.env.QUEUE_STRATEGY === 'async'
    ? createQueue<WebhookDeliveryJob>(queueName, 'async', {
      connection: { url: getRedisUrl('QUEUE') },
      concurrency: Math.max(1, Number.parseInt(process.env.WEBHOOK_QUEUE_CONCURRENCY ?? '10', 10) || 10),
    })
    : createQueue<WebhookDeliveryJob>(queueName, 'local')

  queues.set(queueName, created)
  return created
}
