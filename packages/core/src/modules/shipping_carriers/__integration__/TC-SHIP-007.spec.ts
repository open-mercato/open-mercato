import { expect, test } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'

/**
 * TC-SHIP-007: Unknown provider returns error
 *
 * Attempts to calculate rates and create a shipment with a nonexistent
 * provider key. Verifies the API returns an error (502 from service layer
 * because no adapter is registered for that provider).
 */
test.describe('TC-SHIP-007: Unknown provider returns error', () => {
  test('should return error when calculating rates with unknown provider', async ({ request }) => {
    const token = await getAuthToken(request)

    const response = await apiRequest(request, 'POST', '/api/shipping-carriers/rates', {
      token,
      data: {
        providerKey: 'non_existent_carrier_xyz',
        origin: { countryCode: 'US', postalCode: '10001', city: 'New York', line1: '123 Test St' },
        destination: { countryCode: 'US', postalCode: '90210', city: 'Beverly Hills', line1: '456 Test Ave' },
        packages: [{ weightKg: 1, lengthCm: 10, widthCm: 10, heightCm: 10 }],
      },
    })

    expect(response.status()).toBeGreaterThanOrEqual(400)
    const body = await response.json()
    expect(body.error).toBeTruthy()
  })

  test('should return error when creating shipment with unknown provider', async ({ request }) => {
    const token = await getAuthToken(request)

    const response = await apiRequest(request, 'POST', '/api/shipping-carriers/shipments', {
      token,
      data: {
        providerKey: 'non_existent_carrier_xyz',
        orderId: crypto.randomUUID(),
        origin: { countryCode: 'US', postalCode: '10001', city: 'New York', line1: '123 Test St' },
        destination: { countryCode: 'US', postalCode: '90210', city: 'Beverly Hills', line1: '456 Test Ave' },
        packages: [{ weightKg: 1, lengthCm: 10, widthCm: 10, heightCm: 10 }],
        serviceCode: 'standard',
      },
    })

    expect(response.status()).toBeGreaterThanOrEqual(400)
    const body = await response.json()
    expect(body.error).toBeTruthy()
  })

  test('should return error when cancelling with unknown provider', async ({ request }) => {
    const token = await getAuthToken(request)

    const response = await apiRequest(request, 'POST', '/api/shipping-carriers/cancel', {
      token,
      data: {
        providerKey: 'non_existent_carrier_xyz',
        shipmentId: crypto.randomUUID(),
      },
    })

    expect(response.status()).toBeGreaterThanOrEqual(400)
    const body = await response.json()
    expect(body.error).toBeTruthy()
  })
})
