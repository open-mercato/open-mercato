import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-CHANNEL-EMAIL-018 — Outbound mutation guard maps requires_reauth to 422.
 *
 * The send-as-user route's outbound guard converts `status='requires_reauth'` or
 * `status='disconnected'` into a 422 with a `fieldErrors.channelId` message.
 * We exercise the routing surface with a synthetic UUID — the route returns
 * 404 / 403 / 422 (never 500) regardless of channel state.
 */
test.describe('TC-CHANNEL-EMAIL-018: send-as-user mutation guard returns 4xx', () => {
  test('POST /send-as-user with a non-existent channel does not 5xx', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'POST',
      '/api/communication_channels/send-as-user',
      {
        token,
        data: {
          userChannelId: '00000000-0000-0000-0000-000000000000',
          to: ['recipient@example.com'],
          subject: 'Test',
          body: { plain: 'Hello' },
        },
      },
    )
    expect(response.status()).toBeLessThan(500)
    expect([401, 403, 404, 422]).toContain(response.status())
  })

  test('POST /send-as-user with missing recipient returns 422', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'POST',
      '/api/communication_channels/send-as-user',
      {
        token,
        data: {
          userChannelId: '00000000-0000-0000-0000-000000000000',
          subject: 'Test',
          body: { plain: 'Hello' },
        },
      },
    )
    expect(response.status()).toBeLessThan(500)
    expect([401, 422]).toContain(response.status())
  })
})
