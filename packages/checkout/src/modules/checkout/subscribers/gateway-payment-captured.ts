import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { createGatewayPaymentSessionResumeHandler } from '../lib/gatewayPaymentSessionResume'
import { isIdempotentCheckoutTransactionStatusConflict } from '../lib/utils'

export const metadata = {
  event: 'payment_gateways.payment.captured',
  persistent: true,
  id: 'checkout-gateway-payment-captured',
}

const resumeSession = createGatewayPaymentSessionResumeHandler('completed')

export default async function handle(payload: { paymentId?: string; organizationId?: string; tenantId?: string; transactionId?: string }) {
  if (!payload.paymentId || !payload.organizationId || !payload.tenantId) return
  const container = await createRequestContainer()
  const commandBus = container.resolve('commandBus') as CommandBus
  try {
    await commandBus.execute('checkout.transaction.updateStatus', {
      input: {
        id: payload.paymentId,
        status: 'completed',
        paymentStatus: 'captured',
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
    // Only a proven terminal/idempotent no-op (the transaction already reached a
    // DIFFERENT terminal state) may be swallowed here — this subscriber is
    // `persistent: true`, so any other error must propagate: swallowing it would ack the
    // event and the redelivery that would otherwise retry (and eventually confirm the
    // payment) never happens.
    if (!isIdempotentCheckoutTransactionStatusConflict(err)) {
      getTelemetryRuntime()?.reportError(err, {
        module: 'checkout',
        code: 'checkout.gateway_payment_captured_update_status_failed',
      })
      throw err
    }
  }
  // Link-backed transactions stop here — Phase A's own flow already completes them.
  // A session-backed transaction (no `linkId`) has no owner past the status update above,
  // so confirm (or compensate) the `CheckoutSession` that is actually waiting on this answer.
  await resumeSession(payload)
}
