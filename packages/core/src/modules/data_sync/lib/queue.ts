import { createModuleQueue, type Queue } from '@open-mercato/queue'
import { DATA_SYNC_QUEUE_ATTEMPTS, DATA_SYNC_MAX_STALLED_COUNT } from './queue-policy'

const queues = new Map<string, Queue<Record<string, unknown>>>()

const resumableQueueNames = new Set(['data-sync-import', 'data-sync-export'])

export function getSyncQueue(queueName: string): Queue<Record<string, unknown>> {
  const existing = queues.get(queueName)
  if (existing) return existing

  const concurrency = Math.max(1, Number.parseInt(process.env.DATA_SYNC_QUEUE_CONCURRENCY ?? '5', 10) || 5)
  const created = createModuleQueue<Record<string, unknown>>(
    queueName,
    resumableQueueNames.has(queueName)
      ? {
        concurrency,
        attempts: DATA_SYNC_QUEUE_ATTEMPTS,
        maxStalledCount: DATA_SYNC_MAX_STALLED_COUNT,
      }
      : { concurrency },
  )

  queues.set(queueName, created)
  return created
}
