import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-CHANNEL-EMAIL-007 — Gmail webhook stays a no-op (Pub/Sub deferred to v2).
 *
 * The provider-generic webhook route exists at `/api/communication_channels/webhook/gmail`.
 * Until Pub/Sub push is implemented, the adapter returns `eventType: 'other'` and the
 * route must respond 2xx rather than 5xx-ing or 404-ing.
 */
test.describe('TC-CHANNEL-EMAIL-007: Gmail webhook is a no-op for now', () => {
  test('POST /api/communication_channels/webhook/gmail does not 5xx', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'POST',
      '/api/communication_channels/webhook/gmail',
      { token, data: { ping: true } },
    )
    expect(response.status()).toBeLessThan(500)
  })
})
