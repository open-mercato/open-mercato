import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-045D-006c — Channel detail admin page renders.
 *
 * Slice 2f adds `backend/communication_channels/channels/[id]/page.tsx`. The
 * page should resolve at `/backend/communication_channels/channels/<uuid>`
 * without 5xx, even when the channel id resolves to nothing (the page
 * displays its own "channel not found" error message).
 */
test.describe('TC-045D-006c: channel detail page renders', () => {
  test('GET /backend/communication_channels/channels/<unknown-uuid> does not 5xx', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'GET',
      '/backend/communication_channels/channels/00000000-0000-0000-0000-000000000000',
      { token },
    )
    expect(response.status(), 'detail page should not 5xx').toBeLessThan(500)
  })
})
