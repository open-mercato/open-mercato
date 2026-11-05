import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-CHANNEL-EMAIL-008 — Profile page renders with both IMAP and Gmail providers installed.
 *
 * Confirms `@open-mercato/channel-gmail` does not break the per-user profile page
 * (`/backend/profile/communication-channels`) — the page must still render even
 * when more than one provider package is installed.
 */
test.describe('TC-CHANNEL-EMAIL-008: profile page with Gmail provider installed', () => {
  test('GET /backend/profile/communication-channels does not 5xx', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'GET',
      '/backend/profile/communication-channels',
      { token },
    )
    expect(response.status(), 'profile page should not 5xx').toBeLessThan(500)
  })
})
