import { reconcileInventoryForUpdatedOrder } from '../lib/salesOrderInventoryAutomation'

export const metadata = {
  event: 'sales.document.totals.calculated',
  persistent: false,
  id: 'wms:sales-order-lines-reconcile-reservations',
}

type SubscriberContext = {
  resolve: <T = unknown>(name: string) => T
}

type SalesDocumentTotalsPayload = {
  documentKind?: string | null
  documentId?: string | null
  tenantId?: string | null
  organizationId?: string | null
}

export default async function handle(payload: SalesDocumentTotalsPayload, ctx: SubscriberContext) {
  await reconcileInventoryForUpdatedOrder(payload, ctx)
}
