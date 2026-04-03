import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { EXAMPLE_CUSTOMERS_SYNC_OUTBOUND_QUEUE } from '../lib/queue'
import type { ExampleCustomersSyncOutboundJobPayload } from '../lib/sync'

export const metadata: WorkerMeta = {
  queue: EXAMPLE_CUSTOMERS_SYNC_OUTBOUND_QUEUE,
  id: 'example-customers-sync:outbound',
  concurrency: 5,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(
  job: QueuedJob<ExampleCustomersSyncOutboundJobPayload>,
  ctx: HandlerContext,
): Promise<void> {
  const { syncCustomerInteractionToExampleTodo } = await import('../lib/sync')
  await syncCustomerInteractionToExampleTodo(ctx, job.payload)
}
