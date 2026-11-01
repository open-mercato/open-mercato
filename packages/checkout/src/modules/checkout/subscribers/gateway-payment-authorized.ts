import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { isIdempotentCheckoutTransactionStatusConflict } from '../lib/utils'

export const metadata = {
  event: 'payment_gateways.payment.authorized',
  persistent: true,
  id: 'checkout-gateway-payment-authorized',
}

export default async function handle(payload: { paymentId?: string; organizationId?: string; tenantId?: string; transactionId?: string }) {
  if (!payload.paymentId || !payload.organizationId || !payload.tenantId) return
  const container = await createRequestContainer()
  const commandBus = container.resolve('commandBus') as CommandBus
  try {
    await commandBus.execute('checkout.transaction.updateStatus', {
      input: {
        id: payload.paymentId,
        status: 'completed',
        paymentStatus: 'authorized',
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
        code: 'checkout.gateway_payment_authorized_update_status_failed',
      })
      throw err
    }
  }
}
