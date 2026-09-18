import type { EntityManager } from '@mikro-orm/postgresql'
import { createModuleQueue, type Queue } from '@open-mercato/queue'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('push_notifications')

export interface PushDeliveryJob {
  deliveryId: string
  tenantId: string
  organizationId: string | null
}

export const PUSH_DELIVERIES_QUEUE = 'push-deliveries'
// Scheduler-driven tick that recovers rows stranded in `sending` by a crashed worker (see
// lib/push-reaper.ts). The `@open-mercato/scheduler` interval entry registered in setup.ts enqueues
// one tick per tenant onto this queue; the reclaim-stuck worker processes it.
export const PUSH_STUCK_RECLAIM_QUEUE = 'push-stuck-reclaim'

const queues = new Map<string, Queue<PushDeliveryJob>>()
const LOCAL_WORKER_PROMISE_KEY = '__openMercatoPushLocalWorkerPromise__'

export function getPushQueue(queueName: string = PUSH_DELIVERIES_QUEUE): Queue<PushDeliveryJob> {
  const existing = queues.get(queueName)
  if (existing) return existing

  const concurrency = Math.max(1, Number.parseInt(process.env.PUSH_QUEUE_CONCURRENCY ?? '8', 10) || 8)
  const created = createModuleQueue<PushDeliveryJob>(queueName, { concurrency })

  queues.set(queueName, created)
  return created
}

// In local (dev/test) queue mode jobs are processed in-process. In async mode the
// auto-discovered `workers/send-push.worker.ts` handles them, so this is a no-op there.
async function ensureLocalPushQueueWorkerStarted(): Promise<void> {
  if (process.env.QUEUE_STRATEGY === 'async') return

  const globalStore = globalThis as typeof globalThis & {
    [LOCAL_WORKER_PROMISE_KEY]?: Promise<void>
  }

  if (globalStore[LOCAL_WORKER_PROMISE_KEY]) {
    await globalStore[LOCAL_WORKER_PROMISE_KEY]
    return
  }

  globalStore[LOCAL_WORKER_PROMISE_KEY] = (async () => {
    const queue = getPushQueue()

    await queue.process(async (job) => {
      const [{ createRequestContainer }, { processPushDeliveryJob }] = await Promise.all([
        import('@open-mercato/shared/lib/di/container'),
        import('./push-delivery'),
      ])

      const container = await createRequestContainer()
      const em = (container.resolve('em') as EntityManager).fork()
      await processPushDeliveryJob(em, job.payload, (name) => container.resolve(name))
    })
  })().catch((error) => {
    delete globalStore[LOCAL_WORKER_PROMISE_KEY]
    logger.error('Failed to start local delivery worker', { error })
    throw error
  })

  await globalStore[LOCAL_WORKER_PROMISE_KEY]
}

export async function enqueuePushDelivery(job: PushDeliveryJob, delayMs?: number): Promise<string> {
  const queue = getPushQueue()
  const jobId = await queue.enqueue(job, delayMs && delayMs > 0 ? { delayMs } : undefined)
  await ensureLocalPushQueueWorkerStarted()
  return jobId
}
