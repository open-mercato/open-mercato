import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-CHANNEL-EMAIL-013 — Profile page renders with IMAP + Gmail + Microsoft providers installed.
 */
test.describe('TC-CHANNEL-EMAIL-013: profile page with Microsoft provider installed', () => {
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
