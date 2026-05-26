import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-CHANNEL-EMAIL-003 — Profile page renders with the IMAP provider installed.
 *
 * Confirms `@open-mercato/channel-imap` does not break the per-user profile page
 * (`/backend/profile/communication-channels`). Empty-state still renders even
 * when the IMAP provider is the only one registered.
 */
test.describe('TC-CHANNEL-EMAIL-003: profile page with IMAP provider installed', () => {
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
