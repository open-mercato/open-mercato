import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-CHANNEL-EMAIL-031 — DELETE /channels/{id} route surface (smoke).
 *
 * The behavioral delete + undo logic is covered in-process by the jest test
 * `commands/__tests__/delete-channel.test.ts`. A *connected* channel fixture
 * cannot be created over HTTP without a live provider adapter (see the skip
 * reason in `customers/__integration__/TC-CRM-EMAIL-001.spec.ts`), so this
 * Playwright test only fixes the public contract of the route: it requires
 * auth, validates the id, masks unknown channels as 404, and never 5xx.
 */
test.describe('TC-CHANNEL-EMAIL-031: delete channel route surface', () => {
  // A syntactically valid UUID that does not resolve to any channel.
  const UNKNOWN_CHANNEL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const path = (id: string) => `/api/communication_channels/channels/${id}`

  test('rejects an unauthenticated DELETE with 401', async ({ request }) => {
    const response = await request.fetch(path(UNKNOWN_CHANNEL_ID), { method: 'DELETE' })
    expect(response.status()).toBe(401)
  })

  test('returns 404 for a channel the caller cannot see (never 5xx)', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(request, 'DELETE', path(UNKNOWN_CHANNEL_ID), { token })
    expect(response.status()).toBe(404)
  })

  test('rejects a malformed channel id with 400', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(request, 'DELETE', path('not-a-uuid'), { token })
    expect(response.status()).toBe(400)
  })
})
