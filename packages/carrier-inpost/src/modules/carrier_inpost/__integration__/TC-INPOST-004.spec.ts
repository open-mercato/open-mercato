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
 * TC-INPOST-004: Repeated cancel attempts for InPost all return 502 not-supported
 *
 * Because InPost does not support cancellation via API, every cancel attempt
 * returns 502 regardless of how many times it is called. This test verifies
 * that the behaviour is consistent across two successive attempts (no state
 * change that would produce a different error code on the second call).
 */
test.describe('TC-INPOST-004: Repeated cancel attempts consistently return 502', () => {
  test('should return 502 on both first and second cancel attempts for InPost', async ({ request }) => {
    const token = await getAuthToken(request)

    const shipment = await createShipment(request, token, {
      providerKey: 'inpost',
      origin: makeInpostAddress(),
      destination: makeInpostAddress(),
      packages: [makeInpostPackage()],
      serviceCode: 'locker_standard',
    })

    expect(shipment.shipmentId).toBeTruthy()

    const cancelPayload = {
      providerKey: 'inpost',
      shipmentId: shipment.shipmentId,
    }

    // First cancel attempt
    const firstResponse = await apiRequest(request, 'POST', '/api/shipping-carriers/cancel', {
      token,
      data: cancelPayload,
    })
    expect(firstResponse.status()).toBe(502)
    const firstBody = await firstResponse.json()
    expect(firstBody.error).toContain('InPost does not support shipment cancellation via API')

    // Second cancel attempt — same result, no state mutation
    const secondResponse = await apiRequest(request, 'POST', '/api/shipping-carriers/cancel', {
      token,
      data: cancelPayload,
    })
    expect(secondResponse.status()).toBe(502)
    const secondBody = await secondResponse.json()
    expect(secondBody.error).toContain('InPost does not support shipment cancellation via API')
  })
})
