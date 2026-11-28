import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import type { PaymentGatewayService } from '@open-mercato/core/modules/payment_gateways/lib/gateway-service'
import { CheckoutTransaction } from '../data/entities'
import { reportGatewayStatusSyncFailure } from '../lib/gateway-status-sync'

export const metadata = {
  event: 'payment_gateways.payment.captured',
  persistent: true,
  id: 'checkout-gateway-payment-captured',
}

export default async function handle(
  payload: { paymentId?: string; transactionId?: string },
  { organizationId, tenantId }: { organizationId?: string | null; tenantId?: string | null },
) {
  if (!payload.paymentId) return
  if (!organizationId || !tenantId) {
    throw new Error('[internal] Checkout gateway status update requires trusted event scope')
  }
  const container = await createRequestContainer()
  const commandBus = container.resolve('commandBus') as CommandBus
  const em = container.resolve('em') as EntityManager
  const scope = { organizationId, tenantId }
  const findCheckoutTransaction = (refresh = false) => em.findOne(
    CheckoutTransaction,
    { id: payload.paymentId, ...scope },
    refresh ? { refresh: true } : undefined,
  )
  const refundLateCapture = async (checkoutTransaction: CheckoutTransaction) => {
    const gatewayTransactionId = payload.transactionId ?? checkoutTransaction.gatewayTransactionId
    if (!gatewayTransactionId) {
      throw new Error('[internal] Cannot refund late checkout capture without a gateway transaction id')
    }
    const paymentGatewayService = container.resolve('paymentGatewayService') as PaymentGatewayService
    const refundResult = await paymentGatewayService.refundPayment(
      gatewayTransactionId,
      undefined,
      'Checkout transaction expired before payment capture was received',
      scope,
      `checkout-late-capture-${payload.paymentId}`,
    )
    if (refundResult.status !== 'refunded') {
      reportGatewayStatusSyncFailure(
        new Error(`Gateway returned ${refundResult.status} while refunding a late checkout capture`),
        {
          event: metadata.event,
          paymentId: payload.paymentId,
          organizationId,
          tenantId,
        },
      )
    }
    await commandBus.execute('checkout.transaction.updateStatus', {
      input: {
        id: payload.paymentId,
        status: 'expired',
        paymentStatus: refundResult.status,
        gatewayTransactionId,
        ...scope,
      },
      ctx: {
        container,
        auth: null,
        organizationScope: null,
        selectedOrganizationId: organizationId,
        organizationIds: [organizationId],
      },
    })
  }

  const transaction = await findCheckoutTransaction()
  if (!transaction) return
  if (transaction.status === 'expired') {
    try {
      await refundLateCapture(transaction)
    } catch (error) {
      reportGatewayStatusSyncFailure(error, {
        event: metadata.event,
        paymentId: payload.paymentId,
        organizationId,
        tenantId,
      })
      throw error
    }
    return
  }

  try {
    await commandBus.execute('checkout.transaction.updateStatus', {
      input: {
        id: payload.paymentId,
        status: 'completed',
        paymentStatus: 'captured',
        gatewayTransactionId: payload.transactionId ?? null,
        organizationId,
        tenantId,
      },
      ctx: {
        container,
        auth: null,
        organizationScope: null,
        selectedOrganizationId: organizationId,
        organizationIds: [organizationId],
      },
    })
  } catch (error) {
    const latestTransaction = await findCheckoutTransaction(true)
    if (latestTransaction?.status === 'expired') {
      try {
        await refundLateCapture(latestTransaction)
      } catch (refundError) {
        reportGatewayStatusSyncFailure(refundError, {
          event: metadata.event,
          paymentId: payload.paymentId,
          organizationId,
          tenantId,
        })
        throw refundError
      }
      return
    }
    reportGatewayStatusSyncFailure(error, {
      event: metadata.event,
      paymentId: payload.paymentId,
      organizationId,
      tenantId,
    })
  }
}
