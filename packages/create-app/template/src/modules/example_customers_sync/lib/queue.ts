import { createModuleQueue, type Queue } from '@open-mercato/queue'

export const EXAMPLE_CUSTOMERS_SYNC_OUTBOUND_QUEUE = 'example-customers-sync-outbound'
export const EXAMPLE_CUSTOMERS_SYNC_INBOUND_QUEUE = 'example-customers-sync-inbound'
export const EXAMPLE_CUSTOMERS_SYNC_RECONCILE_QUEUE = 'example-customers-sync-reconcile'

const GLOBAL_KEY = '__example_customers_sync_queues__' as const

function getQueueCache(): Map<string, Queue<Record<string, unknown>>> {
  const g = globalThis as Record<string, unknown>
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new Map<string, Queue<Record<string, unknown>>>()
  }
  return g[GLOBAL_KEY] as Map<string, Queue<Record<string, unknown>>>
}

export function getExampleCustomersSyncQueue<T extends Record<string, unknown>>(queueName: string): Queue<T> {
  const queues = getQueueCache()
  const existing = queues.get(queueName)
  if (existing) return existing as Queue<T>

  const concurrency = Math.max(1, Number.parseInt(process.env.EXAMPLE_CUSTOMERS_SYNC_QUEUE_CONCURRENCY ?? '5', 10) || 5)
  const created = createModuleQueue<T>(queueName, { concurrency })

  queues.set(queueName, created as Queue<Record<string, unknown>>)
  return created
}
