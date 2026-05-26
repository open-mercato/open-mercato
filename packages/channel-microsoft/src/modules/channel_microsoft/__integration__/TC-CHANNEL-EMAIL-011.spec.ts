import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-CHANNEL-EMAIL-011 — Microsoft 365 provider visible to the hub's OAuth router.
 *
 * Slice 3g registers the `microsoft` adapter. The hub's OAuth initiate route
 * must accept `provider=microsoft` without 404-ing.
 */
test.describe('TC-CHANNEL-EMAIL-011: Microsoft 365 OAuth router wiring', () => {
  test('POST /oauth/microsoft/initiate does not 404 on the provider', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'POST',
      '/api/communication_channels/oauth/microsoft/initiate',
      { token, data: { redirectUri: 'https://example.com/cb' } },
    )
    expect(response.status(), 'route should not 5xx').toBeLessThan(500)
    expect(response.status(), 'Microsoft provider should be registered').not.toBe(404)
  })
})
