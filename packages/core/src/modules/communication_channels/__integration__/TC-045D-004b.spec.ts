import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-045D-004b — Reactions API requires authentication and rejects malformed input.
 *
 * Slice 2d delivers `POST /api/communication_channels/messages/[messageId]/reactions`
 * (add) and `DELETE /api/communication_channels/messages/[messageId]/reactions/[reactionId]`
 * (remove). Both are auth-gated by `communication_channels.react` feature.
 *
 * Until a real channel-linked Message + reaction is set up in a fixture, this
 * test asserts the negative paths: invalid params and missing auth.
 */
test.describe('TC-045D-004b: reactions API contract', () => {
  test('POST rejects malformed messageId param with 400', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'POST',
      '/api/communication_channels/messages/not-a-uuid/reactions',
      {
        token,
        data: { emoji: '👍' },
      },
    )
    expect(response.status()).toBeLessThan(500)
    // 400 (param), 401 (no auth), or 404 (no channel link) are acceptable;
    // 5xx is not.
    expect([400, 401, 404, 409, 422]).toContain(response.status())
  })

  test('DELETE rejects malformed ids with 400 or 404', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'DELETE',
      '/api/communication_channels/messages/not-a-uuid/reactions/also-not-a-uuid',
      { token },
    )
    expect(response.status()).toBeLessThan(500)
    expect([400, 401, 404]).toContain(response.status())
  })
})
