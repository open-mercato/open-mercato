import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { listProviders } from '@open-mercato/core/modules/shipping_carriers/__integration__/helpers/fixtures'

/**
 * TC-INPOST-001: InPost provider appears in provider registry
 *
 * Calls GET /api/shipping-carriers/providers and verifies that the InPost
 * provider (providerKey: 'inpost') is present in the response.
 */
test.describe('TC-INPOST-001: InPost provider registration', () => {
  test('should include inpost in the registered providers list', async ({ request }) => {
    const token = await getAuthToken(request)
    const result = await listProviders(request, token)

    expect(result.providers).toBeDefined()
    expect(Array.isArray(result.providers)).toBe(true)

    const inpostProvider = result.providers.find((p) => p.providerKey === 'inpost')
    expect(inpostProvider).toBeDefined()
  })
})
