import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-CHANNEL-EMAIL-A02 — Microsoft token refresh wiring (Spec A).
 *
 * Verifies that the OAuth refresh contract surface exists end-to-end:
 *   - The OAuth initiate route accepts `provider=microsoft` (means the
 *     Microsoft adapter is registered and discoverable).
 *
 * The full token-refresh roundtrip — including refresh-token rotation —
 * requires a real connected Microsoft 365 mailbox with stored OAuth
 * client config in `integration_credentials` for `oauth_microsoft`. That
 * manual verification is captured in
 * `.ai/qa/scenarios/TC-CHANNEL-EMAIL-A02-microsoft-token-refresh.md`.
 *
 * The wiring itself (resolution of `oauth_microsoft` -> `oauthClient` field
 * on `RefreshCredentialsInput`, including `tenantId` propagation and
 * refresh-token rotation) is thoroughly covered by unit tests:
 *   - packages/core/src/modules/communication_channels/lib/__tests__/credential-refresh.test.ts
 *   - packages/channel-microsoft/src/modules/channel_microsoft/lib/__tests__/adapter.test.ts
 */
test.describe('TC-CHANNEL-EMAIL-A02: Microsoft token refresh wiring', () => {
  test('OAuth initiate route for microsoft is registered (refresh contract is reachable)', async ({ request }) => {
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
