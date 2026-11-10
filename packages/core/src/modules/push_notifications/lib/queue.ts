import { createModuleQueue, type Queue } from '@open-mercato/queue'

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

export function getPushQueue(queueName: string = PUSH_DELIVERIES_QUEUE): Queue<PushDeliveryJob> {
  const existing = queues.get(queueName)
  if (existing) return existing

  const concurrency = Math.max(1, Number.parseInt(process.env.PUSH_QUEUE_CONCURRENCY ?? '8', 10) || 8)
  const created = createModuleQueue<PushDeliveryJob>(queueName, { concurrency })

  queues.set(queueName, created)
  return created
}

/**
 * Enqueue only. The send is owned by the auto-discovered `workers/send-push.worker.ts`
 * in BOTH queue strategies — a worker process in `async` mode, the local worker runner
 * (`yarn dev`, `drainIntegrationQueue`) in local mode.
 *
 * This deliberately never starts a consumer itself. Booting one from the request path
 * deadlocked the caller: the local strategy's `process()` does not return until its
 * first drain finishes, so awaiting it ran the send handler INSIDE the enqueueing
 * request — and a retryable send re-enqueues from within that handler, which awaited
 * the very bootstrap promise it was running under. The first push whose delivery failed
 * retryably therefore wedged `POST /api/notifications` forever, and because the promise
 * was cached on `globalThis` every later push in the process awaited it too. It also put
 * a second consumer on a queue directory the local strategy documents as single-consumer.
 */
export async function enqueuePushDelivery(job: PushDeliveryJob, delayMs?: number): Promise<string> {
  const queue = getPushQueue()
  return queue.enqueue(job, delayMs && delayMs > 0 ? { delayMs } : undefined)
}
