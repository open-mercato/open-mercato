import { releaseInventoryForCancelledOrder } from '../lib/salesOrderInventoryAutomation'

export const metadata = {
  event: 'sales.order.cancelled',
  persistent: true,
  id: 'wms:sales-order-cancelled-release',
}

type SubscriberContext = {
  resolve: <T = unknown>(name: string) => T
}

type SalesOrderCancelledPayload = {
  orderId?: string | null
  tenantId?: string | null
  organizationId?: string | null
}

export default async function handle(payload: SalesOrderCancelledPayload, ctx: SubscriberContext) {
  await releaseInventoryForCancelledOrder(payload, ctx)
}
