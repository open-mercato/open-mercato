import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-CHANNEL-EMAIL-012 — Microsoft 365 webhook stays a no-op (Graph subscriptions deferred).
 *
 * Until Graph change-notification subscriptions are wired the route must respond
 * 2xx via the adapter's `eventType: 'other'` response.
 */
test.describe('TC-CHANNEL-EMAIL-012: Microsoft 365 webhook is a no-op for now', () => {
  test('POST /api/communication_channels/webhook/microsoft does not 5xx', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'POST',
      '/api/communication_channels/webhook/microsoft',
      { token, data: { ping: true } },
    )
    expect(response.status()).toBeLessThan(500)
  })
})
