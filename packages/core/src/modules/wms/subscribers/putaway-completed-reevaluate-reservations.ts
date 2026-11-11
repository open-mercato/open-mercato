import { reevaluateReservationsAfterStockIncrease } from '../lib/salesOrderInventoryAutomation'

export const metadata = {
  event: 'wms.putaway.completed',
  persistent: true,
  id: 'wms:putaway-completed-reevaluate-reservations',
}

type SubscriberContext = {
  resolve: <T = unknown>(name: string) => T
}

type PutawayCompletedPayload = {
  catalogVariantId?: string | null
  tenantId?: string | null
  organizationId?: string | null
}

export default async function handle(payload: PutawayCompletedPayload, ctx: SubscriberContext) {
  await reevaluateReservationsAfterStockIncrease(payload, ctx)
}
