import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'

export const metadata = {
  event: 'payment_gateways.payment.failed',
  persistent: true,
  id: 'checkout-gateway-payment-failed',
}

export default async function handle(payload: { paymentId?: string; organizationId?: string; tenantId?: string; transactionId?: string }) {
  if (!payload.paymentId || !payload.organizationId || !payload.tenantId) return
  const container = await createRequestContainer()
  const commandBus = container.resolve('commandBus') as CommandBus
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
  }).catch(() => null)
}
