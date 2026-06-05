import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-CHANNEL-EMAIL-002 — IMAP webhook endpoint stays disabled.
 *
 * IMAP has no webhook flow; the polling worker drives inbound. We still expose
 * the standard `/api/communication_channels/webhook/[provider]` URL because the
 * hub's route is generic. The IMAP adapter's `verifyWebhook` returns an
 * `eventType: 'other'` event so the route MUST respond 2xx (not handled) instead
 * of 5xx-ing or 404-ing.
 */
test.describe('TC-CHANNEL-EMAIL-002: IMAP webhook is a no-op', () => {
  test('POST /api/communication_channels/webhook/imap does not 5xx', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'POST',
      '/api/communication_channels/webhook/imap',
      {
        token,
        data: { ping: true },
      },
    )
    expect(response.status(), 'webhook route should not 5xx').toBeLessThan(500)
  })
})
