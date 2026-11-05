import { reserveInventoryForConfirmedOrder } from '../lib/salesOrderInventoryAutomation'

export const metadata = {
  event: 'sales.order.confirmed',
  persistent: true,
  id: 'wms:sales-order-confirmed-reserve',
}

type SubscriberContext = {
  resolve: <T = unknown>(name: string) => T
}

type SalesOrderConfirmedPayload = {
  orderId?: string | null
  tenantId?: string | null
  organizationId?: string | null
}

export default async function handle(payload: SalesOrderConfirmedPayload, ctx: SubscriberContext) {
  await reserveInventoryForConfirmedOrder(payload, ctx)
}
