import { expect, test } from '@playwright/test'
import Chance from 'chance'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createShipment,
  cancelShipment,
} from '@open-mercato/core/modules/shipping_carriers/__integration__/helpers/fixtures'

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
 * TC-INPOST-003: Cancel InPost shipment in label_created status succeeds
 *
 * Creates an InPost shipment (which starts in label_created status) then
 * immediately cancels it. Verifies the cancel endpoint returns 200.
 */
test.describe('TC-INPOST-003: Cancel InPost shipment in label_created status', () => {
  test('should cancel an InPost shipment that is in label_created status', async ({ request }) => {
    const token = await getAuthToken(request)

    const shipment = await createShipment(request, token, {
      providerKey: 'inpost',
      origin: makeInpostAddress(),
      destination: makeInpostAddress(),
      packages: [makeInpostPackage()],
      serviceCode: 'locker_standard',
    })

    expect(shipment.shipmentId).toBeTruthy()

    const result = await cancelShipment(request, token, shipment.shipmentId, {
      providerKey: 'inpost',
    })

    expect(result.status).toBe('cancelled')
  })
})
