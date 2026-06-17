import type { EntityManager } from '@mikro-orm/postgresql'
import { createModuleQueue, type Queue } from '@open-mercato/queue'
import type { WebhookDeliveryJob } from './delivery'
import type { InboundDispatchJob } from './inbound-dispatch'

const queues = new Map<string, Queue<WebhookDeliveryJob>>()
const inboundQueues = new Map<string, Queue<InboundDispatchJob>>()
const LOCAL_WORKER_PROMISE_KEY = '__openMercatoWebhookLocalWorkerPromise__'
const LOCAL_INBOUND_WORKER_PROMISE_KEY = '__openMercatoWebhookLocalInboundWorkerPromise__'

export const WEBHOOK_DELIVERIES_QUEUE = 'webhook-deliveries'
export const WEBHOOK_INBOUND_DISPATCH_QUEUE = 'webhook-inbound-dispatch'

export function getWebhookQueue(queueName: string = WEBHOOK_DELIVERIES_QUEUE): Queue<WebhookDeliveryJob> {
  const existing = queues.get(queueName)
  if (existing) return existing

  const concurrency = Math.max(1, Number.parseInt(process.env.WEBHOOK_QUEUE_CONCURRENCY ?? '10', 10) || 10)
  const created = createModuleQueue<WebhookDeliveryJob>(queueName, { concurrency })

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

export function getInboundDispatchQueue(
  queueName: string = WEBHOOK_INBOUND_DISPATCH_QUEUE,
): Queue<InboundDispatchJob> {
  const existing = inboundQueues.get(queueName)
  if (existing) return existing

  const concurrency = Math.max(1, Number.parseInt(process.env.WEBHOOK_INBOUND_QUEUE_CONCURRENCY ?? '5', 10) || 5)
  const created = createModuleQueue<InboundDispatchJob>(queueName, { concurrency })

  inboundQueues.set(queueName, created)
  return created
}

async function ensureLocalInboundQueueWorkerStarted(): Promise<void> {
  if (process.env.QUEUE_STRATEGY === 'async') return

  const globalStore = globalThis as typeof globalThis & {
    [LOCAL_INBOUND_WORKER_PROMISE_KEY]?: Promise<void>
  }

  if (globalStore[LOCAL_INBOUND_WORKER_PROMISE_KEY]) {
    await globalStore[LOCAL_INBOUND_WORKER_PROMISE_KEY]
    return
  }

  globalStore[LOCAL_INBOUND_WORKER_PROMISE_KEY] = (async () => {
    const queue = getInboundDispatchQueue()

    await queue.process(async (job) => {
      const [{ createRequestContainer }, { processInboundDispatchJob }] = await Promise.all([
        import('@open-mercato/shared/lib/di/container'),
        import('./inbound-dispatch'),
      ])

      const container = await createRequestContainer()
      const em = (container.resolve('em') as EntityManager).fork()
      await processInboundDispatchJob(em, job.payload, {
        resolve: <T,>(name: string) => container.resolve(name) as T,
      })
    })
  })().catch((error) => {
    delete globalStore[LOCAL_INBOUND_WORKER_PROMISE_KEY]
    console.error('[webhooks] Failed to start local inbound dispatch worker:', error)
    throw error
  })

  await globalStore[LOCAL_INBOUND_WORKER_PROMISE_KEY]
}

export async function enqueueInboundDispatch(job: InboundDispatchJob): Promise<string> {
  const queue = getInboundDispatchQueue()
  const jobId = await queue.enqueue(job)
  await ensureLocalInboundQueueWorkerStarted()
  return jobId
}
