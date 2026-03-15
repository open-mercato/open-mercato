import { expect, test } from '@playwright/test'
import Chance from 'chance'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createShipment } from '@open-mercato/core/modules/shipping_carriers/__integration__/helpers/fixtures'

const chance = new Chance()

function makeInpostAddress() {
  return {
    countryCode: 'PL',
    postalCode: `${chance.integer({ min: 10, max: 99 })}-${chance.integer({ min: 100, max: 999 })}`,
    city: chance.city(),
    line1: chance.address(),
  }
}

function makeInpostPackage() {
  return {
    weightKg: chance.floating({ min: 0.1, max: 30, fixed: 2 }),
    lengthCm: chance.integer({ min: 5, max: 200 }),
    widthCm: chance.integer({ min: 5, max: 200 }),
    heightCm: chance.integer({ min: 5, max: 200 }),
  }
}

/**
 * TC-INPOST-003: Cancel InPost shipment returns 502 with "not supported" error
 *
 * InPost does not support shipment cancellation via API (no DELETE endpoint exists
 * in the ShipX API). The adapter throws cancelNotSupported() immediately, which
 * the cancel route maps to a 502 response with an explanatory error message.
 */
test.describe('TC-INPOST-003: Cancel InPost shipment returns not-supported error', () => {
  test('should return 502 with not-supported error when attempting to cancel an InPost shipment', async ({ request }) => {
    const token = await getAuthToken(request)

    const shipment = await createShipment(request, token, {
      providerKey: 'inpost',
      origin: makeInpostAddress(),
      destination: makeInpostAddress(),
      packages: [makeInpostPackage()],
      serviceCode: 'locker_standard',
    })

    expect(shipment.shipmentId).toBeTruthy()

    const response = await apiRequest(request, 'POST', '/api/shipping-carriers/cancel', {
      token,
      data: {
        providerKey: 'inpost',
        shipmentId: shipment.shipmentId,
      },
    })

    expect(response.status()).toBe(502)
    const body = await response.json()
    expect(body.error).toBeTruthy()
    expect(body.error).toContain('InPost does not support shipment cancellation via API')
  })
})
