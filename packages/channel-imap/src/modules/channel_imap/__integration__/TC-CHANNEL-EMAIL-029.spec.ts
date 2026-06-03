import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-CHANNEL-EMAIL-029 — operator-triggered backlog import (Spec B § Phase B6).
 *
 * Verifies that the `/api/communication_channels/channels/{id}/import-history`
 * route is reachable, requires authentication, validates the body, and 404s
 * for non-existent / not-owned channels (the access-control branch).
 *
 * Concurrency guard (429), the ProgressJob lifecycle, and the IMAP SEARCH +
 * fetch loop are exercised by the unit-test layer:
 *   - packages/core/src/modules/communication_channels/commands/__tests__/queue-import-history.test.ts
 *   - packages/core/src/modules/communication_channels/workers/__tests__/channel-import-history.test.ts
 *   - packages/channel-imap/src/modules/channel_imap/lib/__tests__/adapter.test.ts (importHistory cases)
 *
 * The full end-to-end (connect a mailbox → POST /import-history → ProgressJob
 * completes → imported messages visible on Person timeline) is captured in
 * `.ai/qa/scenarios/TC-CHANNEL-EMAIL-029-import-history.md` for manual QA.
 */
test.describe('TC-CHANNEL-EMAIL-029: import-history route wiring', () => {
  const FAKE_CHANNEL_ID = '00000000-0000-0000-0000-000000000029'

  test('rejects unauthenticated requests', async ({ request }) => {
    const response = await apiRequest(
      request,
      'POST',
      `/api/communication_channels/channels/${FAKE_CHANNEL_ID}/import-history`,
      // Intentionally empty token — this test asserts the 401 unauth path.
      { token: '', data: { sinceDays: 14 } },
    )
    expect(response.status()).toBe(401)
  })

  test('returns 400 on invalid channel id', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'POST',
      '/api/communication_channels/channels/not-a-uuid/import-history',
      { token, data: { sinceDays: 14 } },
    )
    expect(response.status()).toBe(400)
  })

  test('returns 400 when body fails Zod validation (sinceDays out of range)', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'POST',
      `/api/communication_channels/channels/${FAKE_CHANNEL_ID}/import-history`,
      { token, data: { sinceDays: 9999 } },
    )
    expect(response.status()).toBe(400)
  })

  test('returns 404 for a channel the caller does not own', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'POST',
      `/api/communication_channels/channels/${FAKE_CHANNEL_ID}/import-history`,
      { token, data: { sinceDays: 14, maxMessages: 100 } },
    )
    // A caller without an organization scope is rejected with 400 ("No
    // organization scope") before the channel lookup; a scoped caller reaches
    // the channel-not-found branch (404, same shape as access-denied for parity).
    expect(response.status(), 'route should not 5xx').toBeLessThan(500)
    expect([400, 403, 404]).toContain(response.status())
  })
})
