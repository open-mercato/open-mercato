import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { CART_PURGE_EXPIRED_QUEUE } from '../lib/queues'
import { purgeExpiredCarts } from '../lib/sweepers'

const logger = createLogger('cart')

/** See `mark-abandoned.worker.ts`'s `CartSweepTickPayload` doc comment — identical shape. */
export type CartSweepTickPayload = {
  scope?: { tenantId?: string | null }
  tenantId?: string | null
}

export const metadata: WorkerMeta = {
  queue: CART_PURGE_EXPIRED_QUEUE,
  id: 'cart:purge-expired',
  concurrency: 1,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(job: QueuedJob<CartSweepTickPayload>, ctx: HandlerContext): Promise<void> {
  const raw = (job?.payload ?? {}) as CartSweepTickPayload
  const tenantId = raw.scope?.tenantId ?? raw.tenantId ?? null
  if (!tenantId) {
    logger.warn('cart:purge-expired skipping tick — payload has no tenantId', { payload: raw })
    return
  }

  const em = (ctx.resolve('em') as EntityManager).fork()
  try {
    const result = await purgeExpiredCarts(em, { tenantId })
    if (result.transitioned > 0) {
      logger.info('cart:purge-expired purged carts', { tenantId, purged: result.transitioned })
    }
  } catch (error) {
    logger.error('cart:purge-expired sweep failed', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
