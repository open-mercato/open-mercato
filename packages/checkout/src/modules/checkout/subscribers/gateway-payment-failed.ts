import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { createGatewayPaymentSessionResumeHandler } from '../lib/gatewayPaymentSessionResume'
import { isIdempotentCheckoutTransactionStatusConflict } from '../lib/utils'

export const metadata = {
  event: 'payment_gateways.payment.failed',
  persistent: true,
  id: 'checkout-gateway-payment-failed',
}

const resumeSession = createGatewayPaymentSessionResumeHandler('failed')

export default async function handle(payload: { paymentId?: string; organizationId?: string; tenantId?: string; transactionId?: string }) {
  if (!payload.paymentId || !payload.organizationId || !payload.tenantId) return
  const container = await createRequestContainer()
  const commandBus = container.resolve('commandBus') as CommandBus
  try {
    await commandBus.execute('checkout.transaction.updateStatus', {
      input: {
        id: payload.paymentId,
        status: 'failed',
        paymentStatus: 'failed',
        gatewayTransactionId: payload.transactionId ?? null,
        organizationId: payload.organizationId,
        tenantId: payload.tenantId,
      },
      ctx: {
        container,
        auth: null,
        organizationScope: null,
        selectedOrganizationId: payload.organizationId,
        organizationIds: [payload.organizationId],
      },
    })
  } catch (err) {
    // See `gateway-payment-captured.ts` for why only a proven terminal/idempotent no-op
    // may be swallowed here — this subscriber is `persistent: true` too.
    if (!isIdempotentCheckoutTransactionStatusConflict(err)) {
      getTelemetryRuntime()?.reportError(err, {
        module: 'checkout',
        code: 'checkout.gateway_payment_failed_update_status_failed',
      })
      throw err
    }
  }
  // A session-backed transaction has no owner past the status update above — compensate
  // (cancel the order, release stock/credit, unlock the cart) the `CheckoutSession` itself.
  await resumeSession(payload)
}
