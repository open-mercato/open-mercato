import { z } from 'zod'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { ExampleTodoBulkOperation } from '../data/entities'
import {
  EXAMPLE_TODO_BULK_DISPATCH_QUEUE,
  publishTodoBulkOperation,
  selectTodoBulkOperationsToPublish,
} from '../lib/todoBulkComplete'

const logger = createLogger('example').child({ component: 'todos-bulk-dispatch' })

/**
 * The scheduler delivers the target payload registered in `setup.ts`, so the
 * scope is validated here rather than trusted: a malformed schedule row must not
 * turn into an unscoped scan.
 */
const dispatchPayloadSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  userId: z.string().uuid().optional(),
})

export const metadata: WorkerMeta = {
  queue: EXAMPLE_TODO_BULK_DISPATCH_QUEUE,
  id: 'example:todos-bulk-dispatch',
  concurrency: 1,
}

/**
 * Outbox recovery tick.
 *
 * Republishes scoped operations that were never delivered to the execution queue
 * (a crash between the durable commit and the enqueue) and operations whose
 * execution lease expired without reaching a terminal state (a crashed worker).
 * It only ever enqueues `{ operationId, scope }` — the durable row remains the
 * single source of truth for what still has to run.
 */
export default async function handle(
  job: QueuedJob<Record<string, unknown>>,
  _ctx: JobContext,
): Promise<void> {
  const parsed = dispatchPayloadSchema.safeParse(job.payload)
  if (!parsed.success) {
    logger.warn('Todo bulk dispatch received an unscoped payload; skipping')
    return
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const now = new Date()

  const rows = await em.fork().find(
    ExampleTodoBulkOperation,
    {
      tenantId: parsed.data.tenantId,
      organizationId: parsed.data.organizationId,
      status: { $in: ['pending', 'running'] },
    } as FilterQuery<ExampleTodoBulkOperation>,
    { limit: 100, orderBy: { createdAt: 'asc' } },
  )

  for (const row of selectTodoBulkOperationsToPublish(rows, now)) {
    await publishTodoBulkOperation({
      em,
      operationId: row.id,
      scope: {
        tenantId: row.tenantId,
        organizationId: row.organizationId,
        userId: row.userId,
      },
    })
  }
}
