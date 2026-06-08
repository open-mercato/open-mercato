import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-045D-005c — Channels admin page renders without 5xx.
 *
 * Slice 2e adds `backend/communication_channels/channels/page.tsx` at
 * `/backend/communication_channels/channels`. The page should at least load (200/302/401),
 * not crash with a 5xx, after slice 2a-2e additions.
 */
test.describe('TC-045D-005c: channels admin page renders', () => {
  test('GET /backend/communication_channels/channels does not 5xx', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'GET',
      '/backend/communication_channels/channels',
      { token },
    )
    expect(response.status(), 'admin page should not 5xx').toBeLessThan(500)
  })
})
