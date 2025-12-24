import { Queue } from 'bullmq'
import type { WebhookQueueJob } from '../data/types'

let webhookQueue: Queue<WebhookQueueJob> | null = null

export function getWebhookQueue(): Queue<WebhookQueueJob> {
  if (!webhookQueue) {
    const redisUrl = process.env.REDIS_URL || process.env.EVENTS_REDIS_URL
    if (!redisUrl) throw new Error('REDIS_URL required for webhook queue')

    webhookQueue = new Queue<WebhookQueueJob>('webhook-deliveries', {
      connection: { url: redisUrl },
      defaultJobOptions: {
        removeOnComplete: { count: 1000, age: 7 * 24 * 3600 }, // 7 days
        removeOnFail: { count: 5000, age: 30 * 24 * 3600 }, // 30 days
      },
    })
  }
  return webhookQueue
}
