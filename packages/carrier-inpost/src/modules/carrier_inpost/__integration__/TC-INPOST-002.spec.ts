import { expect, test } from '@playwright/test'
import Chance from 'chance'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { calculateRates } from '@open-mercato/core/modules/shipping_carriers/__integration__/helpers/fixtures'

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

const EXPECTED_INPOST_SERVICE_CODES = [
  'locker_standard',
  'courier_standard',
  'courier_c2c',
]

/**
 * TC-INPOST-002: InPost rate calculator returns expected services
 *
 * Calls POST /api/shipping-carriers/rates with providerKey 'inpost' and
 * a Polish origin/destination pair. Verifies that the response contains
 * all 4 expected InPost service codes with PLN amounts.
 */
test.describe('TC-INPOST-002: InPost rate calculator', () => {
  test('should return rates for all 4 InPost services', async ({ request }) => {
    const token = await getAuthToken(request)

    const result = await calculateRates(request, token, {
      providerKey: 'inpost',
      origin: makeInpostAddress(),
      destination: makeInpostAddress(),
      packages: [makeInpostPackage()],
    })

    expect(result.rates).toBeDefined()
    expect(Array.isArray(result.rates)).toBe(true)
    expect(result.rates.length).toBe(3)
  })

  test('should include all expected InPost service codes', async ({ request }) => {
    const token = await getAuthToken(request)

    const result = await calculateRates(request, token, {
      providerKey: 'inpost',
      origin: makeInpostAddress(),
      destination: makeInpostAddress(),
      packages: [makeInpostPackage()],
    })

    const returnedCodes = result.rates.map((r) => r.serviceCode)
    for (const expectedCode of EXPECTED_INPOST_SERVICE_CODES) {
      expect(returnedCodes).toContain(expectedCode)
    }
  })

  test('should return amounts in PLN', async ({ request }) => {
    const token = await getAuthToken(request)

    const result = await calculateRates(request, token, {
      providerKey: 'inpost',
      origin: makeInpostAddress(),
      destination: makeInpostAddress(),
      packages: [makeInpostPackage()],
    })

    for (const rate of result.rates) {
      expect(rate.currencyCode).toBe('PLN')
      expect(typeof rate.amount).toBe('number')
      expect(rate.amount).toBeGreaterThan(0)
    }
  })
})
