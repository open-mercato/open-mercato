import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-CHANNEL-EMAIL-006 — Gmail provider visible to the hub's OAuth router.
 *
 * After slice 3f registers the `gmail` adapter, the OAuth initiate route must
 * accept `provider=gmail`. Without a real Google client_id we exercise routing
 * only — the adapter is reachable when the route does NOT 404.
 */
test.describe('TC-CHANNEL-EMAIL-006: Gmail OAuth router wiring', () => {
  test('POST /oauth/gmail/initiate does not 404 on the provider', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'POST',
      '/api/communication_channels/oauth/gmail/initiate',
      { token, data: { redirectUri: 'https://example.com/cb' } },
    )
    expect(response.status(), 'route should not 5xx').toBeLessThan(500)
    expect(response.status(), 'Gmail provider should be registered').not.toBe(404)
  })
})
