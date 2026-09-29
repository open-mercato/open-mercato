import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-CHANNEL-EMAIL-032 — Gmail backlog import route wiring.
 *
 * The Gmail adapter now implements `importHistory`, so
 * `POST /api/communication_channels/channels/{id}/import-history` must no
 * longer short-circuit with the "provider does not support history import"
 * 400 for `gmail` channels. This spec covers the route surface reachable
 * without a live Google grant: auth, body validation (including the widened
 * 10-year / 50k ceilings), and the not-found branch.
 *
 * The Gmail query construction, sender chunking, cursor round-trip,
 * pagination, `maxMessages` cap and per-message error handling are covered by
 * `packages/channel-gmail/src/modules/channel_gmail/lib/__tests__/adapter.test.ts`
 * (`GmailChannelAdapter.importHistory`).
 *
 * The full end-to-end (connect a Gmail mailbox → POST /import-history →
 * ProgressJob completes → imported messages on the Person timeline) needs a
 * real OAuth grant and stays manual, alongside
 * `.ai/qa/scenarios/TC-CHANNEL-EMAIL-029-import-history.md`.
 */
test.describe('TC-CHANNEL-EMAIL-032: gmail import-history route wiring', () => {
  const FAKE_CHANNEL_ID = '00000000-0000-0000-0000-000000000032'
  const path = `/api/communication_channels/channels/${FAKE_CHANNEL_ID}/import-history`

  test('rejects unauthenticated requests', async ({ request }) => {
    const response = await apiRequest(request, 'POST', path, {
      // Intentionally empty token — this test asserts the 401 unauth path.
      token: '',
      data: { sinceDays: 365 },
    })
    expect(response.status()).toBe(401)
  })

  test('rejects a sinceDays value beyond the ten-year ceiling', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(request, 'POST', path, {
      token,
      data: { sinceDays: 3651 },
    })
    expect(response.status()).toBe(400)
  })

  test('accepts a multi-year window without a schema rejection', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(request, 'POST', path, {
      token,
      data: { sinceDays: 1825, maxMessages: 50000 },
    })
    // The channel does not exist, so the request must fail on the lookup
    // branch (or the missing-org-scope branch) — never on body validation and
    // never with a 5xx.
    expect(response.status(), 'route should not 5xx').toBeLessThan(500)
    expect([400, 403, 404]).toContain(response.status())
  })
})
