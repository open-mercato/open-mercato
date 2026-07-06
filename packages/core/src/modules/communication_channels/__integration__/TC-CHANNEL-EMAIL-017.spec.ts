import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-CHANNEL-EMAIL-017 — Disconnect halts polling + clears credentials.
 *
 * The `communication_channels.channel.disconnect` command (Phase 4 deliverable 5)
 * sets `status='disconnected'`, `is_active=false`, `is_primary=false`, and nulls
 * `credentials_ref`. Polling is driven by the scheduler entry registered in
 * setup.ts which filters channels by `status='connected'` and `is_active=true`,
 * so this status flip is the cancellation signal.
 *
 * As a public API surface we can only assert that no disconnect ROUTE returns 5xx
 * (the spec defers a public delete endpoint to a future slice — the command is
 * called by the page-level disconnect button). This test fixes the contract that
 * the route surface does not 5xx on lookups of disconnected-shaped channel ids.
 */
test.describe('TC-CHANNEL-EMAIL-017: disconnect halts polling, clears credentials', () => {
  test('GET /channels/:id/health on a non-existent channel does not 5xx', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'GET',
      '/api/communication_channels/channels/00000000-0000-0000-0000-000000000000/health',
      { token },
    )
    expect(response.status()).toBeLessThan(500)
  })
})
