import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
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
  }).catch((error) => reportGatewayStatusSyncFailure(error, {
    event: metadata.event,
    paymentId: payload.paymentId,
    organizationId,
    tenantId,
  }))
}
