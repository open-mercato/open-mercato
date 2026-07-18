import { createModuleQueue, type Queue } from '@open-mercato/queue'

/** Task 5.2 — per-tenant MRP run queue name (spec decision c). */
export const MRP_RUN_QUEUE = 'production-mrp'

let queue: Queue<Record<string, unknown>> | null = null

export function getMrpRunQueue(): Queue<Record<string, unknown>> {
  if (!queue) {
    const concurrency = Math.max(1, Number.parseInt(process.env.PRODUCTION_MRP_QUEUE_CONCURRENCY ?? '1', 10) || 1)
    queue = createModuleQueue<Record<string, unknown>>(MRP_RUN_QUEUE, { concurrency })
  }
  return queue
}
