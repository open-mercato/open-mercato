import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { CheckoutSession, CheckoutTransaction } from '../data/entities'
import { recordGatewayPayment } from '../commands/submit'

const logger = createLogger('checkout').child({ component: 'repair-gateway-payments' })

export const CHECKOUT_REPAIR_GATEWAY_PAYMENTS_QUEUE = 'checkout-repair-gateway-payments'

export type RepairGatewayPaymentsJob = {
  tenantId: string
  organizationId: string
  batchSize?: number
}

export const metadata: WorkerMeta = {
  queue: CHECKOUT_REPAIR_GATEWAY_PAYMENTS_QUEUE,
  id: 'checkout:repair-gateway-payments',
  concurrency: 1,
}

type HandlerContext = JobContext & { resolve: <T = unknown>(name: string) => T }
type RepairScope = { tenantId: string; organizationId: string }

// A transaction's `completed` status never changes again, so without a bound this sweep
// would re-scan every historical completed transaction forever. `recordGatewayPayment`'s
// own 3 immediate in-process retries cover almost every case; this worker exists only for
// the rare leftover, so a generous-but-finite lookback catches it without unbounded growth.
const REPAIR_LOOKBACK_MS = 48 * 60 * 60 * 1000

/**
 * #8268 review Medium 7: `recordGatewayPayment` (`commands/submit.ts`) already retries 3
 * times in-process, but a session-backed gateway payment is recorded AFTER the checkout
 * session (and, on the synchronous path, the order confirmation) already committed —
 * exhausting those 3 attempts used to just log/report and permanently leave a paid order
 * with no `SalesPayment` row, since nothing ever retried it again.
 *
 * This durable sweep closes that gap: `CheckoutTransaction` is the already-persisted
 * source of truth for a session-backed gateway payment (amount, currency, the gateway's
 * own reference, and the captured/authorized status), so no new column or queue payload
 * is needed to make the repair durable. It re-derives the exact same `GatewayPaymentRecord`
 * the live submit path would have passed and calls `recordGatewayPayment` again — safe to
 * run any number of times, since that function's own `findRecordedGatewayPayment` check
 * makes it a no-op the instant a matching `SalesPayment` exists (and reconciles a capture
 * onto an existing authorized-only payment, Major 5's own fix).
 *
 * Scoped to session-backed transactions only (`sessionId` set) — Phase A's link-only
 * transactions go through `checkout.transaction.updateStatus`'s own, separate flow and are
 * left alone here, same scoping `gatewayPaymentSessionResume.ts` already uses.
 */
export async function repairOneGatewayPayment(
  container: CommandRuntimeContext['container'],
  em: EntityManager,
  transaction: CheckoutTransaction,
  scope: RepairScope,
): Promise<void> {
  if (!transaction.orderId || !transaction.sessionId) return
  const session = await em.findOne(CheckoutSession, { id: transaction.sessionId, ...scope })
  if (!session) return

  await recordGatewayPayment(container, em, session, scope, transaction.orderId, {
    amount: transaction.amount,
    currencyCode: transaction.currencyCode,
    paymentReference: transaction.gatewayTransactionId ?? transaction.id,
    captured: transaction.paymentStatus !== 'authorized',
  })
}

export default async function handle(job: QueuedJob<RepairGatewayPaymentsJob>, ctx: HandlerContext): Promise<void> {
  if (!job.payload?.tenantId || !job.payload?.organizationId) {
    throw new Error('[internal] tenantId and organizationId are required in RepairGatewayPaymentsJob')
  }
  const { tenantId, organizationId } = job.payload
  const batchSize = job.payload.batchSize ?? 50
  const scope: RepairScope = { tenantId, organizationId }
  const em = (ctx.resolve('em') as EntityManager).fork()
  const container = { resolve: ctx.resolve } as unknown as CommandRuntimeContext['container']
  const cutoff = new Date(Date.now() - REPAIR_LOOKBACK_MS)

  const completed = await em.find(
    CheckoutTransaction,
    {
      tenantId,
      organizationId,
      status: 'completed',
      sessionId: { $ne: null },
      orderId: { $ne: null },
      updatedAt: { $gte: cutoff },
    },
    { limit: batchSize, orderBy: { updatedAt: 'ASC' } },
  )

  for (const transaction of completed) {
    try {
      await repairOneGatewayPayment(container, em, transaction, scope)
    } catch (err) {
      logger.error('[internal] repair-gateway-payments: repair failed for a transaction', { err, transactionId: transaction.id })
    }
  }
}
