import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { EXAMPLE_CUSTOMERS_SYNC_INBOUND_QUEUE } from '../lib/queue'
import {
  syncExampleTodoToCanonicalInteraction,
  type ExampleCustomersSyncInboundJobPayload,
} from '../lib/sync'

export const metadata: WorkerMeta = {
  queue: EXAMPLE_CUSTOMERS_SYNC_INBOUND_QUEUE,
  id: 'example-customers-sync:inbound',
  concurrency: 5,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(
  job: QueuedJob<ExampleCustomersSyncInboundJobPayload>,
  ctx: HandlerContext,
): Promise<void> {
  await syncExampleTodoToCanonicalInteraction(ctx, job.payload)
}
