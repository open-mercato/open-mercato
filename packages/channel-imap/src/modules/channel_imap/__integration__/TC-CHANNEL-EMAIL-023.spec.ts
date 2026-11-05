import { expect, test } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-CHANNEL-EMAIL-023 — Threading via References token
 *
 * Smoke: the layered thread matcher prefers `token-references`
 * (highest-confidence strategy) when an inbound message carries our
 * synthetic `<om_TOKEN@open-mercato.invalid>` Message-ID in
 * `References`. The 5-strategy fallthrough order is unit-tested in
 * `packages/core/.../lib/__tests__/thread-matcher.test.ts`; the
 * end-to-end "send → reply preserves References → CRM threads back"
 * path is in the QA scenario markdown.
 *
 * Webhook-less providers have no public endpoint to assert against,
 * so this smoke test is intentionally minimal — it just confirms the
 * platform's send-as-user route is reachable (used by the outbound
 * test setup in the QA scenario).
 */
test.describe('TC-CHANNEL-EMAIL-023: References-token threading', () => {
  test('send-as-user endpoint requires authentication', async ({ request }) => {
    const response = await apiRequest(
      request,
      'POST',
      '/api/communication_channels/send-as-user',
      // Intentionally empty token — this test asserts the 401 unauth path.
      { token: '', data: { channelId: '00000000-0000-4000-8000-000000000023' } },
    )
    expect(response.status()).toBe(401)
  })
})
