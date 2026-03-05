import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

test.describe('TC-SHIP-001: shipping rates', () => {
  test('should return normalized shipping rates for inpost', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(request, 'POST', '/api/shipping-carriers/rates', {
      token,
      data: {
        providerKey: 'inpost',
        origin: { countryCode: 'PL', postalCode: '00-001', city: 'Warsaw', line1: 'Street 1' },
        destination: { countryCode: 'PL', postalCode: '30-001', city: 'Krakow', line1: 'Street 2' },
        packages: [{ weightKg: 1.2, lengthCm: 20, widthCm: 12, heightCm: 8 }],
      },
    })
    expect(response.status()).toBe(200)
    const body = await response.json()
    expect(Array.isArray(body.rates)).toBeTruthy()
    expect(body.rates.length).toBeGreaterThan(0)
    expect(body.rates[0].serviceCode).toBeTruthy()
  })
})
