import { expect, test } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import { createShipment } from './helpers/fixtures'
import {
  setCarrierShipmentStatusInDb,
  getCarrierShipmentRowFromDb,
  deleteCarrierShipmentInDb,
} from './helpers/db'

/**
 * TC-SHIP-012: Status transition boundary — a shipment cannot be cancelled once
 * it is `in_transit` or in a terminal status (`delivered`).
 *
 * `cancelShipment` rejects the transition (`ShipmentCancelNotAllowedError`) which
 * the route maps to 422 with a message naming the current status. The non-
 * cancellable states are only reachable via async carrier events, so the
 * fixture sets `carrier_shipments.unified_status` directly to keep the test
 * deterministic, then asserts the status is NOT mutated by the rejected cancel.
 *
 * ENVIRONMENT: mixes API fixtures with DB-level fixtures (raw `pg` against
 * `DATABASE_URL`). Run under a coherent app+DB stack (the `yarn test:integration`
 * / `yarn test:integration:ephemeral` harness) where the app and fixtures share
 * the same database — otherwise the DB writes are invisible to the app.
 */
test.describe('TC-SHIP-012: Cancel is rejected from in_transit and terminal statuses (422)', () => {
  test('returns 422 and leaves the status unchanged when cancelling in_transit or delivered shipments', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    let inTransitId: string | null = null
    let deliveredId: string | null = null

    try {
      const inTransit = await createShipment(request, token, { providerKey: 'mock_carrier' })
      inTransitId = inTransit.shipmentId
      await setCarrierShipmentStatusInDb(inTransitId, 'in_transit')

      const cancelInTransit = await apiRequest(request, 'POST', '/api/shipping-carriers/cancel', {
        token,
        data: { providerKey: 'mock_carrier', shipmentId: inTransitId },
      })
      expect(cancelInTransit.status(), 'cancelling an in_transit shipment must be 422').toBe(422)
      const inTransitBody = await readJsonSafe<{ error?: string }>(cancelInTransit)
      expect(inTransitBody?.error, 'error should name the current status').toContain('in_transit')

      const inTransitRow = await getCarrierShipmentRowFromDb(inTransitId)
      expect(inTransitRow?.unifiedStatus, 'in_transit shipment must not be mutated by a rejected cancel').toBe('in_transit')

      const delivered = await createShipment(request, token, { providerKey: 'mock_carrier' })
      deliveredId = delivered.shipmentId
      await setCarrierShipmentStatusInDb(deliveredId, 'delivered')

      const cancelDelivered = await apiRequest(request, 'POST', '/api/shipping-carriers/cancel', {
        token,
        data: { providerKey: 'mock_carrier', shipmentId: deliveredId },
      })
      expect(cancelDelivered.status(), 'cancelling a delivered shipment must be 422').toBe(422)
      const deliveredBody = await readJsonSafe<{ error?: string }>(cancelDelivered)
      expect(deliveredBody?.error, 'error should name the current status').toContain('delivered')

      const deliveredRow = await getCarrierShipmentRowFromDb(deliveredId)
      expect(deliveredRow?.unifiedStatus, 'delivered shipment must not be mutated by a rejected cancel').toBe('delivered')
    } finally {
      await deleteCarrierShipmentInDb(inTransitId).catch(() => undefined)
      await deleteCarrierShipmentInDb(deliveredId).catch(() => undefined)
    }
  })
})
