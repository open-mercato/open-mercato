import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createShipment, sendWebhook } from './helpers/fixtures'
import {
  deleteCarrierShipmentInDb,
  deleteCarrierWebhookClaimsInDb,
  getCarrierShipmentRowFromDb,
  hasCarrierWebhookClaimInDb,
} from './helpers/db'

/**
 * TC-SHIP-018: A carrier status that skips intermediate steps is applied.
 *
 * Carriers report the current status, not every step: a parcel can go from a
 * created label straight to `delivered` when the `picked_up` / `in_transit`
 * scans never reach us. The worker must apply that forward move (and so emit
 * `shipping_carriers.shipment.delivered`), and must still refuse a later,
 * out-of-order `in_transit` that would move a delivered shipment backwards.
 *
 * Webhooks are processed asynchronously, so each step first waits until the
 * worker has claimed the event (`carrier_webhook_events`) and only then reads
 * the shipment row.
 *
 * ENVIRONMENT: reads `DATABASE_URL`; run under the integration harness where
 * the app and the fixtures share one database.
 */
test.describe('TC-SHIP-018: Carrier status skips are applied, regressions are not', () => {
  test('applies label_created -> delivered from a webhook and ignores a late in_transit', async ({ request }) => {
    test.setTimeout(60_000)
    const token = await getAuthToken(request, 'admin')
    let shipmentId: string | null = null
    const eventIds: string[] = []

    const deliverStatus = async (carrierShipmentId: string, status: string): Promise<void> => {
      const eventId = `tc-ship-018-${status}-${crypto.randomUUID()}`
      eventIds.push(eventId)
      const response = await sendWebhook(request, 'mock_carrier', {
        id: eventId,
        type: `shipment.${status}`,
        shipmentId: carrierShipmentId,
        data: { status },
      })
      expect(response.status(), `webhook ${status} should be accepted`).toBe(202)
      await expect
        .poll(() => hasCarrierWebhookClaimInDb(eventId, 'mock_carrier'), {
          message: `the ${status} webhook should be processed by the worker`,
          timeout: 30_000,
        })
        .toBe(true)
    }

    try {
      const shipment = await createShipment(request, token, { providerKey: 'mock_carrier' })
      shipmentId = shipment.shipmentId
      expect(shipment.status).toBe('label_created')

      await deliverStatus(shipment.carrierShipmentId, 'delivered')
      await expect
        .poll(async () => (await getCarrierShipmentRowFromDb(shipment.shipmentId))?.unifiedStatus, {
          message: 'a delivered scan must move a label_created shipment to delivered',
          timeout: 10_000,
        })
        .toBe('delivered')

      await deliverStatus(shipment.carrierShipmentId, 'in_transit')
      for (let read = 0; read < 6; read += 1) {
        const afterLateScan = await getCarrierShipmentRowFromDb(shipment.shipmentId)
        expect(afterLateScan?.unifiedStatus, 'a late in_transit scan must not reopen a delivered shipment').toBe('delivered')
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    } finally {
      await deleteCarrierWebhookClaimsInDb(eventIds).catch(() => undefined)
      await deleteCarrierShipmentInDb(shipmentId).catch(() => undefined)
    }
  })
})
