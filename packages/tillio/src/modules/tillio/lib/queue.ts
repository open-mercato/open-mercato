import { createModuleQueue, type Queue } from '@open-mercato/queue'
import { parseNumberWithDefault } from '@open-mercato/shared/lib/number'

/**
 * Queue helper for the Tillio provider. Mirrors `getSyncQueue` (data_sync) so the
 * route and the worker share one queue instance per name.
 *
 * Concurrency stays at 1 by default: a pull sweeps Tillio page by page with the
 * operator's token, and running several sweeps at once only buys provider
 * throttling. `TILLIO_QUEUE_CONCURRENCY` raises it for deployments that pull for
 * many organizations at once, capped at the platform ceiling of 20.
 */
const queues = new Map<string, Queue<Record<string, unknown>>>()

export const TILLIO_PULL_QUEUE = 'tillio-pull'

// Worker parallelism comes from the worker manifest, not from the producer-side queue
// instance this module builds, so both read the same value or the variable only pretends
// to do something.
export function resolveTillioQueueConcurrency(): number {
  return Math.min(20, parseNumberWithDefault(process.env.TILLIO_QUEUE_CONCURRENCY, 1, { min: 1, integer: true }))
}

export function getTillioQueue(queueName: string): Queue<Record<string, unknown>> {
  const existing = queues.get(queueName)
  if (existing) return existing

  const created = createModuleQueue<Record<string, unknown>>(queueName, {
    concurrency: resolveTillioQueueConcurrency(),
  })
  queues.set(queueName, created)
  return created
}
