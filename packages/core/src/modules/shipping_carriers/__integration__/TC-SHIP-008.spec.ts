import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { listProviders } from './helpers/fixtures'

/**
 * TC-SHIP-008: List registered shipping providers
 *
 * Calls GET /api/shipping-carriers/providers and verifies the response
 * contains a list of registered adapter provider keys.
 */
test.describe('TC-SHIP-008: List registered shipping providers', () => {
  test('should return a providers array', async ({ request }) => {
    const token = await getAuthToken(request)
    const result = await listProviders(request, token)

    expect(result.providers).toBeDefined()
    expect(Array.isArray(result.providers)).toBe(true)
  })

  test('each provider entry should have a providerKey string', async ({ request }) => {
    const token = await getAuthToken(request)
    const result = await listProviders(request, token)

    for (const provider of result.providers) {
      expect(typeof provider.providerKey).toBe('string')
      expect(provider.providerKey.length).toBeGreaterThan(0)
    }
  })

  test('should return 401 for unauthenticated requests', async ({ request }) => {
    const response = await request.get(
      `${process.env.BASE_URL?.trim() || 'http://localhost:3000'}/api/shipping-carriers/providers`,
    )
    expect(response.status()).toBe(401)
  })
})
