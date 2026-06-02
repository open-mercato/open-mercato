import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-CHANNEL-EMAIL-020 — Email rich-content widget composes cleanly with the unified inbox.
 *
 * The `channel-payload-renderer` widget renders at `detail:messages:message:body:after`
 * (slice 2a wired the spot; slice 2e wired the widget). With both email providers
 * installed (IMAP / Gmail) the messages inbox + detail pages must keep
 * returning <500 for every route the spot lives on. We test the routing surface;
 * the widget render contract is covered by the unit tests of
 * `widgets/injection/channel-payload-renderer/widget.client.tsx`.
 */
test.describe('TC-CHANNEL-EMAIL-020: rich-content widget composes with messages routes', () => {
  test('GET /backend/messages does not 5xx', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(request, 'GET', '/backend/messages', { token })
    expect(response.status()).toBeLessThan(500)
  })

  test('GET /backend/messages with a synthetic id does not 5xx', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'GET',
      '/backend/messages/00000000-0000-0000-0000-000000000000',
      { token },
    )
    expect(response.status()).toBeLessThan(500)
  })
})
