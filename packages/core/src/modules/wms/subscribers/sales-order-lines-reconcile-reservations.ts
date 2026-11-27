import { reconcileInventoryForUpdatedOrder } from '../lib/salesOrderInventoryAutomation'

export const metadata = {
  event: 'sales.document.totals.calculated',
  persistent: true,
  id: 'wms:sales-order-lines-reconcile-reservations',
}

type SubscriberContext = {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(
  payload: Parameters<typeof reconcileInventoryForUpdatedOrder>[0],
  ctx: SubscriberContext,
) {
  await reconcileInventoryForUpdatedOrder(payload, ctx)
}
