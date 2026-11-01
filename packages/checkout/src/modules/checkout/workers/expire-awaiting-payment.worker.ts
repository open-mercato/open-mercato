import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { PaymentGatewayService } from '@open-mercato/core/modules/payment_gateways/lib/gateway-service'
import { CheckoutSession, CheckoutTransaction } from '../data/entities'
import { compensateByCancellingOrder, confirmOrderAndComplete } from '../commands/submit'
import { writeSessionEvent } from '../lib/sessionEvents'
import { emitCheckoutEvent } from '../events'
import { tryResolve } from '../lib/tryResolve'
import { mapGatewayStatusToCheckoutStatus } from '../lib/utils'

const logger = createLogger('checkout').child({ component: 'expire-awaiting-payment' })

export const CHECKOUT_EXPIRE_AWAITING_PAYMENT_QUEUE = 'checkout-expire-awaiting-payment'

export type ExpireAwaitingPaymentJob = {
  tenantId: string
  organizationId: string
  batchSize?: number
}

export const metadata: WorkerMeta = {
  queue: CHECKOUT_EXPIRE_AWAITING_PAYMENT_QUEUE,
  id: 'checkout:expire-awaiting-payment',
  concurrency: 1,
}

type HandlerContext = JobContext & { resolve: <T = unknown>(name: string) => T }
type ExpiryScope = { tenantId: string; organizationId: string }

async function findSessionTransaction(
  em: EntityManager,
  session: CheckoutSession,
  scope: ExpiryScope,
): Promise<CheckoutTransaction | null> {
  return em.findOne(CheckoutTransaction, { sessionId: session.id, ...scope })
}

/**
 * §12's `expire-awaiting-payment`, C1's own stated mandate: "checkout extends the lock on
 * entering `awaiting_payment` to the intent TTL, and `expire-awaiting-payment` (§12)
 * compensates before the lock can lapse." The authoritative clock is the session's own
 * `payment_expires_at` (§6/§7.2 step 7) — the SAME value the live submit path reads off the
 * gateway's own session response — never a re-derived TTL. §12's cadence (every 5 min) and
 * the §6 lock margin (payment window + 15 min) leave multiple ticks of headroom before the
 * extended lock can lapse out from under a session this job has not yet resolved.
 *
 * Probes the gateway one last time via Phase A's own idiom (`findTransactionBySessionId` +
 * `getPaymentStatus`, the same pair `api/pay/[slug]/status/[transactionId]/route.ts` already
 * uses to refresh a pending transaction on demand) and resumes/compensates through the SAME
 * primitives `commands/submit.ts`'s own gateway step (§7.2 step 7) uses on a synchronous
 * answer — `confirmOrderAndComplete` and `compensateByCancellingOrder`, both exported there
 * for this job — never a parallel reimplementation of either.
 */
export async function expireOneAwaitingPayment(
  container: CommandRuntimeContext['container'],
  em: EntityManager,
  session: CheckoutSession,
  scope: ExpiryScope,
): Promise<void> {
  if (!session.salesOrderId || !session.salesQuoteId || !session.paymentMethodCode) {
    logger.error('[internal] expire-awaiting-payment: session is missing required fields to resolve', {
      sessionId: session.id,
    })
    return
  }

  const transaction = await findSessionTransaction(em, session, scope)
  const reservationKeys = {
    stockReservationKey: session.stockReservationKey ?? null,
    creditReservationKey: session.creditReservationKey ?? null,
  }

  const paymentGatewayService = tryResolve<PaymentGatewayService>(container, 'paymentGatewayService')
  let mappedStatus: CheckoutTransaction['status'] | null = null

  if (paymentGatewayService && session.paymentIntentRef) {
    try {
      const gatewayTransaction = await paymentGatewayService.findTransactionBySessionId(
        session.paymentIntentRef,
        scope,
        session.paymentMethodCode,
      )
      if (gatewayTransaction) {
        const status = await paymentGatewayService.getPaymentStatus(gatewayTransaction.id, scope)
        mappedStatus = mapGatewayStatusToCheckoutStatus(status.status)
      }
    } catch (err) {
      // §12's own "otherwise compensate" — a failed probe is "no definitive answer past the
      // deadline", never treated as a success.
      logger.warn('[internal] expire-awaiting-payment: gateway status probe failed, treating as no answer', {
        err,
        sessionId: session.id,
      })
    }
  }

  if (mappedStatus === 'completed') {
    // §7.2 step 7 success branch, verbatim: confirm the order, build the C18 lineMap,
    // markConverted, complete the session — then the SAME two events the live path emits
    // alongside `confirmOrderAndComplete`'s own `checkout.session.completed`.
    await confirmOrderAndComplete(container, em, session, scope, session.salesOrderId, session.salesQuoteId, reservationKeys)
    await writeSessionEvent(em, { ...scope, sessionId: session.id, kind: 'payment_result', actor: 'system', payload: { orderId: session.salesOrderId, outcome: 'succeeded' } })
    await emitCheckoutEvent('checkout.payment.succeeded', {
      sessionId: session.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      orderId: session.salesOrderId,
      transactionId: transaction?.id ?? null,
    }).catch(() => undefined)
    return
  }

  // §12: "otherwise compensate (cancel the order) and fail with `payment_expired`" — the
  // gateway answered failed/cancelled/expired, or never answered at all past the deadline.
  await compensateByCancellingOrder(container, em, session, scope, session.salesOrderId, 'payment_expired')
  await writeSessionEvent(em, { ...scope, sessionId: session.id, kind: 'payment_result', actor: 'system', payload: { orderId: session.salesOrderId, outcome: 'failed' } })
  await emitCheckoutEvent('checkout.payment.failed', {
    sessionId: session.id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    orderId: session.salesOrderId,
    transactionId: transaction?.id ?? null,
    failureCode: 'payment_expired',
  }).catch(() => undefined)
}

export default async function handle(job: QueuedJob<ExpireAwaitingPaymentJob>, ctx: HandlerContext): Promise<void> {
  if (!job.payload?.tenantId || !job.payload?.organizationId) {
    throw new Error('[internal] tenantId and organizationId are required in ExpireAwaitingPaymentJob')
  }
  const { tenantId, organizationId } = job.payload
  const batchSize = job.payload.batchSize ?? 50
  const scope: ExpiryScope = { tenantId, organizationId }
  const em = (ctx.resolve('em') as EntityManager).fork()
  const cutoff = new Date()
  const container = { resolve: ctx.resolve } as unknown as CommandRuntimeContext['container']

  const overdue = (await findWithDecryption(
    em,
    CheckoutSession,
    { tenantId, organizationId, status: 'awaiting_payment', paymentExpiresAt: { $lt: cutoff } },
    { limit: batchSize, orderBy: { paymentExpiresAt: 'ASC' } },
    scope,
  )) as CheckoutSession[]

  for (const session of overdue) {
    try {
      await expireOneAwaitingPayment(container, em, session, scope)
    } catch (err) {
      logger.error('[internal] expire-awaiting-payment: resolution failed for a session', { err, sessionId: session.id })
    }
  }
}
