import type { EntityManager } from '@mikro-orm/postgresql'
import { createQueue, type Queue } from '@open-mercato/queue'
import { getRedisUrl } from '@open-mercato/shared/lib/redis/connection'
import type { WebhookDeliveryJob } from './delivery'

const queues = new Map<string, Queue<WebhookDeliveryJob>>()
const LOCAL_WORKER_PROMISE_KEY = '__openMercatoWebhookLocalWorkerPromise__'

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

async function ensureLocalWebhookQueueWorkerStarted(): Promise<void> {
  if (process.env.QUEUE_STRATEGY === 'async') return

  const globalStore = globalThis as typeof globalThis & {
    [LOCAL_WORKER_PROMISE_KEY]?: Promise<void>
  }

  if (globalStore[LOCAL_WORKER_PROMISE_KEY]) {
    await globalStore[LOCAL_WORKER_PROMISE_KEY]
    return
  }

  globalStore[LOCAL_WORKER_PROMISE_KEY] = (async () => {
    const queue = getWebhookQueue()

    await queue.process(async (job) => {
      const [{ createRequestContainer }, { processWebhookDeliveryJob }] = await Promise.all([
        import('@open-mercato/shared/lib/di/container'),
        import('./delivery'),
      ])

      const container = await createRequestContainer()
      const em = (container.resolve('em') as EntityManager).fork()
      await processWebhookDeliveryJob(em, job.payload)
    })
  })().catch((error) => {
    delete globalStore[LOCAL_WORKER_PROMISE_KEY]
    console.error('[webhooks] Failed to start local delivery worker:', error)
    throw error
  })

  await globalStore[LOCAL_WORKER_PROMISE_KEY]
}

export async function enqueueWebhookDelivery(job: WebhookDeliveryJob, delayMs?: number): Promise<string> {
  const queue = getWebhookQueue()
  const jobId = await queue.enqueue(job, delayMs && delayMs > 0 ? { delayMs } : undefined)
  await ensureLocalWebhookQueueWorkerStarted()
  return jobId
}
