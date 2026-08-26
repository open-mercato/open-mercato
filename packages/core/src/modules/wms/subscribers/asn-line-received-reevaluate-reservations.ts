import { reevaluateReservationsAfterStockIncrease } from '../lib/salesOrderInventoryAutomation'

export const metadata = {
  event: 'wms.asn.line_received',
  persistent: true,
  id: 'wms:asn-line-received-reevaluate-reservations',
}

type SubscriberContext = {
  resolve: <T = unknown>(name: string) => T
}

type AsnLineReceivedPayload = {
  catalogVariantId?: string | null
  tenantId?: string | null
  organizationId?: string | null
}

export default async function handle(payload: AsnLineReceivedPayload, ctx: SubscriberContext) {
  await reevaluateReservationsAfterStockIncrease(payload, ctx)
}
