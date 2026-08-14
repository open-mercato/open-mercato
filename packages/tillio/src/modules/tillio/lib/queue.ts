import { createModuleQueue, type Queue } from '@open-mercato/queue'

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

export function getTillioQueue(queueName: string): Queue<Record<string, unknown>> {
  const existing = queues.get(queueName)
  if (existing) return existing

  const concurrency = Math.min(
    20,
    Math.max(1, Number.parseInt(process.env.TILLIO_QUEUE_CONCURRENCY ?? '1', 10) || 1),
  )
  const created = createModuleQueue<Record<string, unknown>>(queueName, { concurrency })
  queues.set(queueName, created)
  return created
}
