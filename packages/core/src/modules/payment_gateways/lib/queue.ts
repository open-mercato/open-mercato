import { createQueue, type Queue } from '@open-mercato/queue'
import { getRedisUrl } from '@open-mercato/shared/lib/redis/connection'

const queues = new Map<string, Queue<Record<string, unknown>>>()

export function getPaymentGatewayQueue(queueName: string): Queue<Record<string, unknown>> {
  const existing = queues.get(queueName)
  if (existing) return existing

  const created = process.env.QUEUE_STRATEGY === 'async'
    ? createQueue<Record<string, unknown>>(queueName, 'async', {
      connection: { url: getRedisUrl('QUEUE') },
      concurrency: Math.max(1, Number.parseInt(process.env.PAYMENT_GATEWAY_QUEUE_CONCURRENCY ?? '5', 10) || 5),
    })
    : createQueue<Record<string, unknown>>(queueName, 'local')

  queues.set(queueName, created)
  return created
}
