import { expect, test } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import { defaultOrigin, defaultDestination, defaultPackage } from './helpers/fixtures'

/**
 * TC-SHIP-011: Input validation — malformed addresses and packages are rejected
 * with 422 before any adapter is invoked.
 *
 * The rates and shipment routes validate the body with a Zod schema and return
 * `{ error: 'Invalid payload', details: <flattened> }` with status 422 on
 * failure. Uses an admin token (has `shipping_carriers.manage`) so requests
 * clear the feature gate and actually reach validation.
 */
type ValidationBody = {
  error?: string
  details?: { fieldErrors?: Record<string, string[] | undefined> }
}

test.describe('TC-SHIP-011: Validation rejects invalid address/package payloads (422)', () => {
  test('rejects rates payloads with a missing country code or empty city', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const missingCountry = await apiRequest(request, 'POST', '/api/shipping-carriers/rates', {
      token,
      data: {
        providerKey: 'mock_carrier',
        // origin.countryCode omitted — addressSchema requires it (min 2 chars).
        origin: { postalCode: '10001', city: 'New York', line1: '123 Sender St' },
        destination: defaultDestination(),
        packages: [defaultPackage()],
      },
    })
    expect(missingCountry.status(), 'missing origin.countryCode must be 422').toBe(422)
    const missingCountryBody = await readJsonSafe<ValidationBody>(missingCountry)
    expect(missingCountryBody?.error).toBe('Invalid payload')
    expect(missingCountryBody?.details?.fieldErrors?.origin, 'origin should carry a field error').toBeTruthy()

    const emptyCity = await apiRequest(request, 'POST', '/api/shipping-carriers/rates', {
      token,
      data: {
        providerKey: 'mock_carrier',
        origin: defaultOrigin(),
        destination: { ...defaultDestination(), city: '' },
        packages: [defaultPackage()],
      },
    })
    expect(emptyCity.status(), 'empty destination.city must be 422').toBe(422)
    const emptyCityBody = await readJsonSafe<ValidationBody>(emptyCity)
    expect(emptyCityBody?.error).toBe('Invalid payload')
    expect(emptyCityBody?.details?.fieldErrors?.destination, 'destination should carry a field error').toBeTruthy()
  })

  test('rejects shipment payloads with empty packages or a non-positive weight', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const emptyPackages = await apiRequest(request, 'POST', '/api/shipping-carriers/shipments', {
      token,
      data: {
        providerKey: 'mock_carrier',
        orderId: crypto.randomUUID(),
        origin: defaultOrigin(),
        destination: defaultDestination(),
        packages: [],
        serviceCode: 'standard',
      },
    })
    expect(emptyPackages.status(), 'empty packages array must be 422').toBe(422)
    const emptyPackagesBody = await readJsonSafe<ValidationBody>(emptyPackages)
    expect(emptyPackagesBody?.error).toBe('Invalid payload')
    expect(emptyPackagesBody?.details?.fieldErrors?.packages, 'packages should carry a field error').toBeTruthy()

    const zeroWeight = await apiRequest(request, 'POST', '/api/shipping-carriers/shipments', {
      token,
      data: {
        providerKey: 'mock_carrier',
        orderId: crypto.randomUUID(),
        origin: defaultOrigin(),
        destination: defaultDestination(),
        packages: [{ ...defaultPackage(), weightKg: 0 }],
        serviceCode: 'standard',
      },
    })
    expect(zeroWeight.status(), 'non-positive package weight must be 422').toBe(422)
    const zeroWeightBody = await readJsonSafe<ValidationBody>(zeroWeight)
    expect(zeroWeightBody?.error).toBe('Invalid payload')
    expect(zeroWeightBody?.details?.fieldErrors?.packages, 'packages should carry a field error').toBeTruthy()
  })
})
