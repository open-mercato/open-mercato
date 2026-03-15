import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createShipment } from './helpers/fixtures'

/**
 * TC-SHIP-002: Create shipment (happy path)
 *
 * Creates a shipment via the API with the mock_carrier provider and
 * verifies the response contains shipment ID, tracking number, and status.
 */
test.describe('TC-SHIP-002: Create shipment', () => {
  test('should create a shipment and return tracking details', async ({ request }) => {
    const token = await getAuthToken(request)

    const shipment = await createShipment(request, token, {
      providerKey: 'mock_carrier',
      serviceCode: 'standard',
    })

    expect(shipment.shipmentId).toBeTruthy()
    expect(shipment.trackingNumber).toBeTruthy()
    expect(shipment.status).toBe('label_created')
  })

  test('should create a shipment with a specific service code', async ({ request }) => {
    const token = await getAuthToken(request)

    const shipment = await createShipment(request, token, {
      providerKey: 'mock_carrier',
      serviceCode: 'express',
    })

    expect(shipment.shipmentId).toBeTruthy()
    expect(shipment.trackingNumber).toBeTruthy()
    expect(shipment.status).toBe('label_created')
  })

  test('should return a carrier shipment ID', async ({ request }) => {
    const token = await getAuthToken(request)

    const shipment = await createShipment(request, token, {
      providerKey: 'mock_carrier',
    })

    expect(shipment.carrierShipmentId).toBeTruthy()
  })
})
