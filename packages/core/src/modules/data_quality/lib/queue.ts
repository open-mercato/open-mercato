import { createModuleQueue, type Queue } from '@open-mercato/queue'

const queues = new Map<string, Queue<unknown>>()

export function getDataQualityQueue<T>(queueName: string): Queue<T> {
  const existing = queues.get(queueName)
  if (existing) {
    return existing as Queue<T>
  }

  const created = createModuleQueue<T>(queueName, {
    concurrency: Number(process.env.DATA_QUALITY_QUEUE_CONCURRENCY ?? 2),
  })

  queues.set(queueName, created as Queue<unknown>)
  return created
}
