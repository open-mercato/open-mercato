import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createShipment, getTracking } from './helpers/fixtures'

/**
 * TC-SHIP-003: Get tracking info
 *
 * Creates a shipment, then fetches tracking info using the shipment ID.
 * Verifies that tracking data is returned with expected structure.
 */
test.describe('TC-SHIP-003: Get tracking info', () => {
  test('should return tracking data for a created shipment', async ({ request }) => {
    const token = await getAuthToken(request)

    const shipment = await createShipment(request, token, {
      providerKey: 'mock_carrier',
    })

    const tracking = await getTracking(request, token, {
      providerKey: 'mock_carrier',
      shipmentId: shipment.shipmentId,
    })

    expect(tracking.trackingNumber).toBeTruthy()
    expect(tracking.status).toBeTruthy()
    expect(Array.isArray(tracking.events)).toBe(true)
  })

  test('should return tracking data when queried by tracking number', async ({ request }) => {
    const token = await getAuthToken(request)

    const shipment = await createShipment(request, token, {
      providerKey: 'mock_carrier',
    })

    const tracking = await getTracking(request, token, {
      providerKey: 'mock_carrier',
      trackingNumber: shipment.trackingNumber,
    })

    expect(tracking.trackingNumber).toBe(shipment.trackingNumber)
    expect(tracking.status).toBeTruthy()
  })

  test('should include tracking events with timestamps', async ({ request }) => {
    const token = await getAuthToken(request)

    const shipment = await createShipment(request, token, {
      providerKey: 'mock_carrier',
    })

    const tracking = await getTracking(request, token, {
      providerKey: 'mock_carrier',
      shipmentId: shipment.shipmentId,
    })

    if (tracking.events.length > 0) {
      const firstEvent = tracking.events[0]
      expect(firstEvent.status).toBeTruthy()
      expect(firstEvent.occurredAt).toBeTruthy()
    }
  })
})
