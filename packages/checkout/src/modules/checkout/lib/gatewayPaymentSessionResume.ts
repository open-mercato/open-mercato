import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { CheckoutSession, CheckoutTransaction } from '../data/entities'
import { compensateByCancellingOrder, confirmOrderAndComplete } from '../commands/submit'
import { writeSessionEvent } from './sessionEvents'
import { emitCheckoutEvent } from '../events'

const logger = createLogger('checkout')

export type GatewayPaymentSessionOutcome = 'completed' | 'failed' | 'cancelled'

type GatewayPaymentPayload = {
  paymentId?: string
  organizationId?: string
  tenantId?: string
  transactionId?: string
}

// Release 5, Step 4.2-fix (§7.2 step 7, C1). `checkout.transaction.updateStatus`
// (`commands/transactions.ts`) only ever advances the `CheckoutTransaction` row — for a
// session-backed payment (no `linkId`) nothing then moves the owning `CheckoutSession` past
// `awaiting_payment`, so a captured/failed gateway webhook left the order unconfirmed until
// `expire-awaiting-payment`'s sweep eventually noticed, up to a full payment window later.
// This runs off the SAME gateway webhook events, resolves the session via the transaction's
// own `sessionId`, and resumes through the EXACT primitives the synchronous submit path
// (`commands/submit.ts`) and the expiry worker already use — never a parallel
// reimplementation of either. Link-backed transactions (`sessionId` null) are left alone;
// Phase A's own `.updateStatus`-driven flow already covers those.
export function createGatewayPaymentSessionResumeHandler(outcome: GatewayPaymentSessionOutcome) {
  return async function handle(payload: GatewayPaymentPayload): Promise<void> {
    if (!payload.paymentId || !payload.organizationId || !payload.tenantId) return
    const scope = { tenantId: payload.tenantId, organizationId: payload.organizationId }
    try {
      const container = await createRequestContainer()
      const em = (container.resolve('em') as EntityManager).fork()
      const transaction = await em.findOne(CheckoutTransaction, { id: payload.paymentId, ...scope } as any)
      if (!transaction || !transaction.sessionId) return

      const session = await findOneWithDecryption(
        em,
        CheckoutSession,
        { id: transaction.sessionId, ...scope },
        undefined,
        scope,
      )
      // Only an `awaiting_payment` session is waiting on this exact async answer — a
      // redelivered webhook, or one that lost the race to the expiry sweep or a concurrent
      // resume, finds the session already past that state and no-ops here.
      if (!session || session.status !== 'awaiting_payment' || !session.salesOrderId || !session.salesQuoteId) return

      const runtimeContainer = container as unknown as CommandRuntimeContext['container']
      const reservationKeys = {
        stockReservationKey: session.stockReservationKey ?? null,
        creditReservationKey: session.creditReservationKey ?? null,
      }

      if (outcome === 'completed') {
        await confirmOrderAndComplete(
          runtimeContainer,
          em,
          session,
          scope,
          session.salesOrderId,
          session.salesQuoteId,
          reservationKeys,
        )
        await writeSessionEvent(em, {
          ...scope,
          sessionId: session.id,
          kind: 'payment_result',
          actor: 'system',
          payload: { orderId: session.salesOrderId, outcome: 'succeeded' },
        })
        await emitCheckoutEvent('checkout.payment.succeeded', {
          sessionId: session.id,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          orderId: session.salesOrderId,
          transactionId: transaction.id,
        }).catch(() => undefined)
        return
      }

      const failureCode = outcome === 'cancelled' ? 'payment_cancelled' : 'payment_failed'
      await compensateByCancellingOrder(runtimeContainer, em, session, scope, session.salesOrderId, failureCode)
      await writeSessionEvent(em, {
        ...scope,
        sessionId: session.id,
        kind: 'payment_result',
        actor: 'system',
        payload: { orderId: session.salesOrderId, outcome: 'failed' },
      })
      await emitCheckoutEvent('checkout.payment.failed', {
        sessionId: session.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        orderId: session.salesOrderId,
        transactionId: transaction.id,
        failureCode,
      }).catch(() => undefined)
    } catch (err) {
      logger.warn('[internal] gateway-payment-session-resume: failed to resume checkout session', {
        err,
        paymentId: payload.paymentId,
      })
    }
  }
}
