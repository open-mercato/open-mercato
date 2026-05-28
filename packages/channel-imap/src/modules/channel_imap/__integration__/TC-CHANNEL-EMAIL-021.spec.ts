import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-CHANNEL-EMAIL-021 — IMAP zero-history bootstrap
 *
 * Verifies that the polling worker surface exists and that the
 * `/poll-now` operator endpoint is reachable. The full happy path —
 * a freshly-connected channel persists `UIDVALIDITY` + `UIDNEXT` and
 * fetches ZERO historical messages — is captured in the QA scenario
 * markdown `TC-CHANNEL-EMAIL-021-imap-bootstrap.md`.
 *
 * Unit-level coverage of the bootstrap branch lives in
 * `packages/channel-imap/.../lib/__tests__/adapter.test.ts`
 * (`fetchHistory` describe block, "bootstrap" case).
 */
test.describe('TC-CHANNEL-EMAIL-021: IMAP bootstrap', () => {
  test('poll-now endpoint requires authentication', async ({ request }) => {
    const response = await apiRequest(
      request,
      'POST',
      '/api/communication_channels/channels/00000000-0000-4000-8000-000000000021/poll-now',
      // Intentionally empty token — this assertion is the 401 unauth path.
      { token: '' },
    )
    expect(response.status()).toBe(401)
  })

  test('poll-now endpoint returns 400 for invalid UUID', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'POST',
      '/api/communication_channels/channels/not-a-uuid/poll-now',
      { token },
    )
    expect(response.status()).toBe(400)
  })
})
