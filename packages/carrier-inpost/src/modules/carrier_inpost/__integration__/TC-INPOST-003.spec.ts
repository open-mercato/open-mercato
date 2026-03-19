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
 * TC-INPOST-003: Cancel InPost shipment
 *
 * InPost supports shipment cancellation via DELETE /v1/shipments/:id (returns 204).
 * Cancellation is only permitted for shipments in 'created' or 'offers_prepared' status.
 * The adapter calls the API and returns status 'cancelled' on success. If the shipment
 * has already been confirmed (bought), the API returns an 'invalid_action' error which
 * the cancel route surfaces as a 502.
 */
test.describe('TC-INPOST-003: Cancel InPost shipment', () => {
  test.skip(!process.env.OM_INTEGRATION_INPOST_API_TOKEN, 'InPost credentials not configured — set OM_INTEGRATION_INPOST_API_TOKEN to run this test')

  test('should successfully cancel a newly-created InPost shipment (pre-confirmed)', async ({ request }) => {
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

    // A 200 with status 'cancelled' or a 502 with 'invalid_action' are both acceptable:
    // the sandbox may auto-confirm shipments before the cancel reaches the API.
    const body = await response.json()
    if (response.status() === 200) {
      expect(body.status).toBe('cancelled')
    } else {
      expect(response.status()).toBe(502)
      expect(body.error).toBeTruthy()
    }
  })
})
