import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { CART_MARK_ABANDONED_QUEUE } from '../lib/queues'
import { sweepAbandonedCarts } from '../lib/sweepers'

const logger = createLogger('cart')

/**
 * Scheduler tick payload. Fired by the `@open-mercato/scheduler` interval entry registered in
 * `lib/scheduling.ts` (`cart:mark-abandoned:<tenantId>`). The scheduler adds `tenantId` at the
 * top level of the enqueued payload on top of the configured `targetPayload`, so accept either
 * shape (mirrors `push_notifications/workers/reclaim-stuck.worker.ts`).
 */
export type CartSweepTickPayload = {
  scope?: { tenantId?: string | null }
  tenantId?: string | null
}

export const metadata: WorkerMeta = {
  queue: CART_MARK_ABANDONED_QUEUE,
  id: 'cart:mark-abandoned',
  concurrency: 1,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(job: QueuedJob<CartSweepTickPayload>, ctx: HandlerContext): Promise<void> {
  const raw = (job?.payload ?? {}) as CartSweepTickPayload
  const tenantId = raw.scope?.tenantId ?? raw.tenantId ?? null
  if (!tenantId) {
    logger.warn('cart:mark-abandoned skipping tick — payload has no tenantId', { payload: raw })
    return
  }

  const em = (ctx.resolve('em') as EntityManager).fork()
  try {
    const result = await sweepAbandonedCarts(em, { tenantId })
    if (result.transitioned > 0) {
      logger.info('cart:mark-abandoned swept carts', { tenantId, transitioned: result.transitioned })
    }
  } catch (error) {
    logger.error('cart:mark-abandoned sweep failed', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
