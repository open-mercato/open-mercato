import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-CHANNEL-MS365-001 — Microsoft 365 provider is registered with the hub's OAuth router.
 *
 * `POST /api/communication_channels/oauth/ms365/initiate` must resolve the
 * `ms365` adapter. Without tenant client credentials the hub answers 409 with
 * the actionable `oauth_client_not_configured` code; with credentials it
 * answers 200 (covered by TC-CHANNEL-MS365-003). A 404 would mean the adapter
 * is not registered; a 5xx would mean the adapter threw while building the URL.
 */
test.describe('TC-CHANNEL-MS365-001: Microsoft 365 OAuth router wiring', () => {
  test('POST /oauth/ms365/initiate resolves the ms365 adapter', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'POST',
      '/api/communication_channels/oauth/ms365/initiate',
      { token, data: { returnUrl: '/backend/profile/communication-channels' } },
    )
    expect(response.status(), 'route should not 5xx').toBeLessThan(500)
    expect(response.status(), 'ms365 provider should be registered').not.toBe(404)
    expect(response.status(), 'ms365 adapter must implement buildOAuthAuthorizeUrl').not.toBe(400)
    if (response.status() === 409) {
      const body = (await response.json()) as { code?: string }
      expect(body.code).toBe('oauth_client_not_configured')
    }
  })
})
