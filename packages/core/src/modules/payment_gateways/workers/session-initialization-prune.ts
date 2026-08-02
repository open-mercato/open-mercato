import type { EntityManager } from '@mikro-orm/postgresql'
import { createModuleQueue, type JobContext, type QueuedJob, type WorkerMeta } from '@open-mercato/queue'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  PAYMENT_SESSION_INITIALIZATION_PRUNE_QUEUE,
  PAYMENT_SESSION_INITIALIZATION_PRUNE_BATCH_SIZE,
  pruneCompletedPaymentSessionInitializations,
} from '../lib/session-idempotency'

type PrunePayload = {
  tenantId?: string
  organizationId?: string
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

const logger = createLogger('payment_gateways')
const continuationQueue = createModuleQueue<PrunePayload>(
  PAYMENT_SESSION_INITIALIZATION_PRUNE_QUEUE,
  { concurrency: 1 },
)

export const metadata: WorkerMeta = {
  queue: PAYMENT_SESSION_INITIALIZATION_PRUNE_QUEUE,
  id: 'payment_gateways:session-initialization-prune',
  concurrency: 1,
}

export default async function handle(
  job: QueuedJob<PrunePayload>,
  ctx: HandlerContext,
): Promise<void> {
  const tenantId = job.payload?.tenantId
  const organizationId = job.payload?.organizationId
  if (!tenantId || !organizationId) {
    logger.warn('Skipping payment-session initialization prune without tenant scope')
    return
  }

  const em = ctx.resolve<EntityManager>('em').fork()
  const deleted = await pruneCompletedPaymentSessionInitializations(
    em,
    { tenantId, organizationId },
    { batchSize: PAYMENT_SESSION_INITIALIZATION_PRUNE_BATCH_SIZE },
  )
  if (deleted > 0) {
    logger.info('Pruned completed payment-session initialization claims', {
      deleted,
      tenantId,
      organizationId,
    })
  }
  if (deleted === PAYMENT_SESSION_INITIALIZATION_PRUNE_BATCH_SIZE) {
    await continuationQueue.enqueue({ tenantId, organizationId }, { delayMs: 1_000 })
  }
}
