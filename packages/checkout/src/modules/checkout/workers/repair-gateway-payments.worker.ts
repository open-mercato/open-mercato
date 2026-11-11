import type { EntityManager } from '@mikro-orm/postgresql'
import { QueryOrder } from '@mikro-orm/core'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { CheckoutSession, CheckoutTransaction } from '../data/entities'
import { recordGatewayPayment } from '../commands/submit'
import { reportCheckoutError } from '../lib/reportCheckoutError'

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

const REPAIR_FIELDS = ['id', 'sessionId', 'orderId', 'amount', 'currencyCode', 'gatewayTransactionId', 'paymentStatus'] as const

type RepairableGatewayTransaction = Pick<CheckoutTransaction, (typeof REPAIR_FIELDS)[number]>

/**
 * #8268 review Medium 7: `recordGatewayPayment` (`commands/submit.ts`) retries 3 times
 * in-process, but a session-backed gateway payment is recorded AFTER the checkout session
 * (and, on the synchronous path, the order confirmation) already committed. This re-derives
 * the exact `GatewayPaymentRecord` the live path would have passed from the durable
 * `CheckoutTransaction` and calls `recordGatewayPayment` again — idempotent through
 * `findRecordedGatewayPayment`, which also reconciles a capture onto an authorized-only
 * payment. A success stamps `paymentRecordedAt`, keyed on the `paymentStatus` read here.
 */
export async function repairOneGatewayPayment(
  container: CommandRuntimeContext['container'],
  em: EntityManager,
  transaction: RepairableGatewayTransaction,
  scope: RepairScope,
): Promise<void> {
  if (!transaction.orderId || !transaction.sessionId) return
  const session = await em.findOne(CheckoutSession, { id: transaction.sessionId, ...scope })
  if (!session) {
    logger.warn('[internal] repair-gateway-payments: the transaction\'s checkout session no longer exists', {
      ...scope,
      transactionId: transaction.id,
      sessionId: transaction.sessionId,
    })
    return
  }

  await recordGatewayPayment(container, em, session, scope, transaction.orderId, {
    amount: transaction.amount,
    currencyCode: transaction.currencyCode,
    paymentReference: transaction.gatewayTransactionId ?? transaction.id,
    captured: transaction.paymentStatus !== 'authorized',
    checkoutTransaction: { id: transaction.id, paymentStatus: transaction.paymentStatus ?? null },
  })
}

/**
 * #8268 review finding 3: selects ONLY outstanding work — a session-backed completed
 * transaction whose `paymentRecordedAt` is still null (never recorded, a failed live record,
 * or a payment-state change such as `authorized` → `captured` that cleared it) — the same
 * shape as `repair-order-compensation`. Already-recorded rows never enter the result, so no
 * volume of them can hide an unrecorded one, and no cursor or optional service is needed.
 *
 * Fairness: every selected row is stamped `paymentRepairAttemptedAt` before it is attempted,
 * and selection orders `paymentRepairAttemptedAt NULLS FIRST` — never-attempted rows first,
 * then least-recently attempted — the same rotation `payment_gateways`' status poller uses
 * with `last_polled_at`. A permanently failing row moves to the back after each attempt and
 * cannot starve the others; stamping before the attempt also covers a row that crashes the run.
 */
export default async function handle(job: QueuedJob<RepairGatewayPaymentsJob>, ctx: HandlerContext): Promise<void> {
  if (!job.payload?.tenantId || !job.payload?.organizationId) {
    throw new Error('[internal] tenantId and organizationId are required in RepairGatewayPaymentsJob')
  }
  const { tenantId, organizationId } = job.payload
  const batchSize = job.payload.batchSize ?? 50
  const scope: RepairScope = { tenantId, organizationId }
  const em = (ctx.resolve('em') as EntityManager).fork()
  const container = { resolve: ctx.resolve } as unknown as CommandRuntimeContext['container']

  const outstanding = await em.find(
    CheckoutTransaction,
    {
      tenantId,
      organizationId,
      status: 'completed',
      sessionId: { $ne: null },
      orderId: { $ne: null },
      paymentRecordedAt: null,
    },
    {
      fields: REPAIR_FIELDS,
      orderBy: { paymentRepairAttemptedAt: QueryOrder.ASC_NULLS_FIRST, updatedAt: QueryOrder.ASC, id: QueryOrder.ASC },
      limit: batchSize,
    },
  )
  if (outstanding.length === 0) return

  await em.nativeUpdate(
    CheckoutTransaction,
    { id: { $in: outstanding.map((transaction) => transaction.id) }, tenantId, organizationId },
    { paymentRepairAttemptedAt: new Date() },
  )

  for (const transaction of outstanding) {
    try {
      await repairOneGatewayPayment(container, em, transaction, scope)
    } catch (err) {
      logger.error('[internal] repair-gateway-payments: repair failed for a transaction', { err, ...scope, transactionId: transaction.id })
      reportCheckoutError(err, 'checkout.gateway_payment_repair_failed', { ...scope, transactionId: transaction.id })
    }
  }
}
