import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-CHANNEL-EMAIL-HUB-002 — Profile page renders without 5xx.
 *
 * Slice 3d adds `backend/profile/communication-channels/page.tsx`. The page
 * should resolve at `/backend/profile/communication-channels` without 5xx,
 * even with no connected channels (the page displays its own empty-state).
 */
test.describe('TC-CHANNEL-EMAIL-HUB-002: profile page renders', () => {
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
