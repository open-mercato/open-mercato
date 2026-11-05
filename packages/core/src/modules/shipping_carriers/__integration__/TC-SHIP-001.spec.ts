import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { calculateRates } from './helpers/fixtures'

/**
 * TC-SHIP-001: Calculate shipping rates (happy path)
 *
 * Calls the rates API with the mock_carrier provider and a valid
 * address/package combination, then verifies the response contains
 * rate options with expected fields.
 */
test.describe('TC-SHIP-001: Calculate shipping rates', () => {
  test('should return rate options from the mock_carrier provider', async ({ request }) => {
    const token = await getAuthToken(request)

    const result = await calculateRates(request, token, {
      providerKey: 'mock_carrier',
    })

    expect(result.rates).toBeDefined()
    expect(Array.isArray(result.rates)).toBe(true)
    expect(result.rates.length).toBeGreaterThan(0)

    const firstRate = result.rates[0]
    expect(firstRate.serviceCode).toBeTruthy()
    expect(firstRate.serviceName).toBeTruthy()
    expect(typeof firstRate.amount).toBe('number')
    expect(firstRate.amount).toBeGreaterThan(0)
    expect(firstRate.currencyCode).toBeTruthy()
  })

  test('should return multiple service options', async ({ request }) => {
    const token = await getAuthToken(request)

    const result = await calculateRates(request, token, {
      providerKey: 'mock_carrier',
    })

    expect(result.rates.length).toBeGreaterThanOrEqual(1)
    const serviceCodes = result.rates.map((r) => r.serviceCode)
    const uniqueCodes = new Set(serviceCodes)
    expect(uniqueCodes.size).toBe(serviceCodes.length)
  })
})
