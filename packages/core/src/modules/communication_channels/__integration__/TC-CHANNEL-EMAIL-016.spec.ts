import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-CHANNEL-EMAIL-016 — Tenant-owned OAuth app overrides platform defaults.
 *
 * The OAuth initiate route must accept `provider=gmail` and `provider=microsoft`,
 * indicating that tenant-level `IntegrationCredentials` (clientId/clientSecret) are
 * resolved at runtime. We assert routing wiring only; the full credential resolution
 * is exercised by the manual end-to-end OAuth flow.
 */
test.describe('TC-CHANNEL-EMAIL-016: tenant OAuth app override surfaces both providers', () => {
  for (const provider of ['gmail', 'microsoft']) {
    test(`POST /oauth/${provider}/initiate routes to provider-resolution layer`, async ({ request }) => {
      const token = await getAuthToken(request)
      const response = await apiRequest(
        request,
        'POST',
        `/api/communication_channels/oauth/${provider}/initiate`,
        { token, data: { redirectUri: 'https://example.com/cb' } },
      )
      expect(response.status()).toBeLessThan(500)
      // Provider should not be unknown — channel-gmail / channel-microsoft are
      // installed by slices 3f / 3g.
      expect(response.status()).not.toBe(404)
    })
  }
})
