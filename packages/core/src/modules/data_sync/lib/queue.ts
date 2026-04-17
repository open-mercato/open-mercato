import { createModuleQueue, type Queue } from '@open-mercato/queue'

const queues = new Map<string, Queue<Record<string, unknown>>>()

export function getSyncQueue(queueName: string): Queue<Record<string, unknown>> {
  const existing = queues.get(queueName)
  if (existing) return existing

  const concurrency = Math.max(1, Number.parseInt(process.env.DATA_SYNC_QUEUE_CONCURRENCY ?? '5', 10) || 5)
  const created = createModuleQueue<Record<string, unknown>>(queueName, { concurrency })

  queues.set(queueName, created)
  return created
}
