import { expect, test } from '@playwright/test'
import Chance from 'chance'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createShipment, cancelShipment } from '@open-mercato/core/modules/shipping_carriers/__integration__/helpers/fixtures'

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
 * TC-INPOST-004: Cancel guard returns 422 for non-cancellable shipment
 *
 * Creates an InPost shipment, cancels it (first cancel succeeds), then
 * attempts a second cancel. The second attempt should return 422 because
 * the shipment is already in the 'cancelled' terminal status.
 *
 * This validates the pre-condition guard introduced in shipping-service.ts
 * which throws ShipmentCancelNotAllowedError for terminal status shipments.
 */
test.describe('TC-INPOST-004: Cancel guard returns 422 for non-cancellable status', () => {
  test('should return 422 when attempting to cancel an already-cancelled shipment', async ({ request }) => {
    const token = await getAuthToken(request)

    const shipment = await createShipment(request, token, {
      providerKey: 'inpost',
      origin: makeInpostAddress(),
      destination: makeInpostAddress(),
      packages: [makeInpostPackage()],
      serviceCode: 'locker_standard',
    })

    expect(shipment.shipmentId).toBeTruthy()

    // First cancel — should succeed
    const firstCancel = await cancelShipment(request, token, shipment.shipmentId, {
      providerKey: 'inpost',
    })
    expect(firstCancel.status).toBe('cancelled')

    // Second cancel — shipment is now in terminal 'cancelled' status; guard should reject with 422
    const secondCancelResponse = await apiRequest(request, 'POST', '/api/shipping-carriers/cancel', {
      token,
      data: {
        providerKey: 'inpost',
        shipmentId: shipment.shipmentId,
      },
    })

    expect(secondCancelResponse.status()).toBe(422)
    const body = await secondCancelResponse.json()
    expect(body.error).toBeTruthy()
    expect(body.error).toContain('cancelled')
  })
})
