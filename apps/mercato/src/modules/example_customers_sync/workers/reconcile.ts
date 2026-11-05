import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { EXAMPLE_CUSTOMERS_SYNC_RECONCILE_QUEUE } from '../lib/queue'
import {
  reconcileLegacyExampleTodoLinks,
  type ExampleCustomersSyncReconcileJobPayload,
} from '../lib/sync'

export const metadata: WorkerMeta = {
  queue: EXAMPLE_CUSTOMERS_SYNC_RECONCILE_QUEUE,
  id: 'example-customers-sync:reconcile',
  concurrency: 1,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(
  job: QueuedJob<ExampleCustomersSyncReconcileJobPayload>,
  ctx: HandlerContext,
): Promise<void> {
  let nextCursor = job.payload.cursor

  do {
    const result = await reconcileLegacyExampleTodoLinks(ctx, {
      tenantId: job.payload.tenantId,
      organizationId: job.payload.organizationId,
      limit: job.payload.limit,
      cursor: nextCursor,
    })
    nextCursor = result.nextCursor
  } while (nextCursor)
}
