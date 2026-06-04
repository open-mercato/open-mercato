import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-CHANNEL-EMAIL-019 — Profile page renders after the auth.user.deleted cascade.
 *
 * The cascade subscriber `subscribers/user-deleted-cascade.ts` reacts to
 * `auth.user.deleted` by disconnecting every owned channel. The profile page
 * empty-state must still render cleanly after this — we exercise the route
 * surface here; the per-user assertion is covered by the subscriber unit
 * tests at `subscribers/__tests__/user-deleted-cascade.test.ts`.
 */
test.describe('TC-CHANNEL-EMAIL-019: auth.user.deleted cascade keeps profile page healthy', () => {
  test('GET /backend/profile/communication-channels does not 5xx', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'GET',
      '/backend/profile/communication-channels',
      { token },
    )
    expect(response.status()).toBeLessThan(500)
  })
})
