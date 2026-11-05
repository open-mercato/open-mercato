import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import {
  EXAMPLE_TODO_BULK_COMPLETE_QUEUE,
  createTodoBulkExecutor,
  createTodoBulkOperationStore,
  runTodoBulkCompleteLoop,
  type ProgressServiceLike,
  type TodoBulkJobPayload,
} from '../lib/todoBulkComplete'

export const metadata: WorkerMeta = {
  queue: EXAMPLE_TODO_BULK_COMPLETE_QUEUE,
  id: 'example:todos-bulk-complete',
  concurrency: 1,
}

/**
 * Executes one durable Todo bulk-complete operation.
 *
 * The lease owner is per-invocation, so a duplicate physical message either finds
 * the row terminal (no-op) or loses the compare-and-swap and returns without work.
 * A crash mid-run leaves the checkpoint behind: the queue retry — or the scheduler
 * dispatcher once the lease expires — resumes from `nextItemIndex` rather than
 * repeating a mutation that already landed.
 */
export default async function handle(
  job: QueuedJob<TodoBulkJobPayload>,
  _ctx: JobContext,
): Promise<void> {
  const { operationId, scope } = job.payload
  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const progress = container.resolve('progressService') as ProgressServiceLike

  await runTodoBulkCompleteLoop({
    operationId,
    scope,
    leaseOwner: `worker:${randomUUID()}`,
    store: createTodoBulkOperationStore(em),
    progress,
    execute: createTodoBulkExecutor({ container, scope }),
  })
}
