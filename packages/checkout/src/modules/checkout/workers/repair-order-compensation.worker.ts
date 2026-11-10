import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { CheckoutSession } from '../data/entities'
import { resumeOrderCancellationCompensation } from '../commands/submit'

const logger = createLogger('checkout').child({ component: 'repair-order-compensation' })

export const CHECKOUT_REPAIR_ORDER_COMPENSATION_QUEUE = 'checkout-repair-order-compensation'

export type RepairOrderCompensationJob = {
  tenantId: string
  organizationId: string
  batchSize?: number
}

export const metadata: WorkerMeta = {
  queue: CHECKOUT_REPAIR_ORDER_COMPENSATION_QUEUE,
  id: 'checkout:repair-order-compensation',
  concurrency: 1,
}

type HandlerContext = JobContext & { resolve: <T = unknown>(name: string) => T }
type RepairScope = { tenantId: string; organizationId: string }

/**
 * #8268 review Major 2: `compensateByCancellingOrder` (`commands/submit.ts`) already
 * retries cancelling the order 3 times in-process before giving up. This durable sweep
 * exists only for the rare leftover where even those attempts fail — the session is left
 * `failed` with `submitProgress: 'compensating'`, meaning the order was never actually
 * cancelled and its stock/credit reservations are still live. The query selects ONLY
 * sessions still carrying that marker, so a session this sweep (or a concurrent call to
 * `resumeOrderCancellationCompensation`) already finished never reappears here — unlike
 * `repair-gateway-payments`'s pre-fix shape, this can't starve on an ever-growing table of
 * already-resolved rows.
 */
export default async function handle(job: QueuedJob<RepairOrderCompensationJob>, ctx: HandlerContext): Promise<void> {
  if (!job.payload?.tenantId || !job.payload?.organizationId) {
    throw new Error('[internal] tenantId and organizationId are required in RepairOrderCompensationJob')
  }
  const { tenantId, organizationId } = job.payload
  const batchSize = job.payload.batchSize ?? 50
  const scope: RepairScope = { tenantId, organizationId }
  const em = (ctx.resolve('em') as EntityManager).fork()
  const container = { resolve: ctx.resolve } as unknown as CommandRuntimeContext['container']

  const stuck = await em.find(
    CheckoutSession,
    { tenantId, organizationId, status: 'failed', submitProgress: 'compensating' },
    { limit: batchSize, orderBy: { updatedAt: 'ASC' } },
  )

  for (const session of stuck) {
    if (!session.salesOrderId) continue
    try {
      await resumeOrderCancellationCompensation(
        container,
        em,
        session,
        scope,
        session.salesOrderId,
        session.failureCode ?? 'compensation_retry',
      )
    } catch (err) {
      logger.error('[internal] repair-order-compensation: retry failed for a session', { err, sessionId: session.id })
    }
  }
}
