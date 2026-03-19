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
 * TC-INPOST-004: Cancel an InPost shipment
 *
 * InPost supports cancellation via DELETE /v1/shipments/:id (returns 204).
 * Cancellation is only permitted for shipments in 'created' or 'offers_prepared' status.
 * Because createShipment goes through the full offer/buy/poll flow before returning,
 * the shipment will already be in 'confirmed' status by the time this test cancels it.
 * The adapter calls DELETE and surfaces the 'invalid_action' error as a 502.
 *
 * Both 200 (cancelled) and 502 (invalid_action for already-confirmed) are accepted —
 * the sandbox confirms shipments faster than any subsequent cancel call can arrive.
 */
test.describe('TC-INPOST-004: Cancel InPost shipment (post-buy)', () => {
  test.skip(!process.env.OM_INTEGRATION_INPOST_API_TOKEN, 'InPost credentials not configured — set OM_INTEGRATION_INPOST_API_TOKEN to run this test')

  test('should return 200 cancelled or 502 invalid_action for a confirmed shipment', async ({ request }) => {
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

    const body = await response.json()
    if (response.status() === 200) {
      expect(body.status).toBe('cancelled')
    } else {
      // Shipment already confirmed — InPost returns invalid_action
      expect(response.status()).toBe(502)
      expect(body.error).toBeTruthy()
    }
  })
})
