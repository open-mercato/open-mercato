import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { resolveOperationHandler } from '../lib/operationHandlers'
import { runSalesOperation } from '../lib/salesOperationRunner'
import { SALES_OPERATION_QUEUE } from '../lib/queues'
import { resolveSalesConcurrency, type SalesOperationJob } from '../lib/salesOperations'

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
  container?: AwilixContainer
}

export const metadata: WorkerMeta = {
  queue: SALES_OPERATION_QUEUE,
  id: 'property_management:sales-operation',
  concurrency: resolveSalesConcurrency(),
}

export default async function handle(job: QueuedJob<SalesOperationJob>, ctx: HandlerContext): Promise<void> {
  const operationId = job.payload?.operationId
  if (typeof operationId !== 'string' || !operationId.length) return
  const container = (ctx.container ?? { resolve: ctx.resolve }) as AwilixContainer
  const recheck = job.payload?.recheck
  await runSalesOperation(
    {
      container,
      em: ctx.resolve<EntityManager>('em'),
      resolveHandler: resolveOperationHandler,
    },
    operationId,
    typeof recheck === 'number' && Number.isInteger(recheck) && recheck > 0 ? { recheck } : {},
  )
}
