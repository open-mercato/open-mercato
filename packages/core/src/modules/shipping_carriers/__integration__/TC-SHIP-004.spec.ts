import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createShipment, cancelShipment } from './helpers/fixtures'

/**
 * TC-SHIP-004: Cancel shipment
 *
 * Creates a shipment, then cancels it via the API.
 * Verifies the status changes to cancelled.
 */
test.describe('TC-SHIP-004: Cancel shipment', () => {
  test('should cancel a created shipment', async ({ request }) => {
    const token = await getAuthToken(request)

    const shipment = await createShipment(request, token, {
      providerKey: 'mock_carrier',
    })
    expect(shipment.status).toBe('label_created')

    const result = await cancelShipment(request, token, shipment.shipmentId, {
      providerKey: 'mock_carrier',
    })

    expect(result.status).toBe('cancelled')
  })

  test('should cancel a shipment with a reason', async ({ request }) => {
    const token = await getAuthToken(request)

    const shipment = await createShipment(request, token, {
      providerKey: 'mock_carrier',
    })

    const result = await cancelShipment(request, token, shipment.shipmentId, {
      providerKey: 'mock_carrier',
      reason: 'Customer requested cancellation',
    })

    expect(result.status).toBe('cancelled')
  })
})
