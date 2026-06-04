import { expect, test } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-CHANNEL-EMAIL-C01 — Gmail Pub/Sub webhook authentication
 *
 * Verifies that `POST /api/communication_channels/webhooks/gmail` rejects
 * unauthenticated / unsigned requests. The full happy-path (publish to
 * Pub/Sub → webhook fires → history sync → message appears in CRM) is the
 * manual QA scenario `TC-CHANNEL-EMAIL-C01-gmail-push-delivery.md` since it
 * requires a real GCP project and connected Gmail mailbox.
 *
 * Unit-level coverage of the JWT verifier + envelope decoder lives in
 * `packages/core/src/modules/communication_channels/lib/__tests__/gmail-pubsub-jwt.test.ts`.
 */
test.describe('TC-CHANNEL-EMAIL-C01: Gmail Pub/Sub webhook', () => {
  test('rejects requests missing the bearer JWT', async ({ request }) => {
    const response = await apiRequest(
      request,
      'POST',
      '/api/communication_channels/webhooks/gmail',
      // Webhook auth is the Pub/Sub JWT in `Authorization`, not the platform
      // session token. `apiRequest` requires a token field; empty is fine —
      // the route ignores Authorization unless the JWT validator can decode it.
      { token: '', data: { message: { data: '', messageId: 'm1' } } },
    )
    // 401 when expectedAudience/expectedEmail are configured;
    // 503 when env vars aren't set (acceptable for a smoke test against an
    // unconfigured CI environment).
    expect([401, 503]).toContain(response.status())
  })

  test('rejects malformed JSON body when JWT is absent', async ({ request }) => {
    const response = await apiRequest(
      request,
      'POST',
      '/api/communication_channels/webhooks/gmail',
      { token: '', data: 'not-json' as unknown as Record<string, unknown> },
    )
    // A request without a Pub/Sub JWT is rejected at the config/verification gate
    // BEFORE the body is parsed, so the malformed body never reaches the decoder:
    // 503 when the verifier env vars aren't set (the unconfigured CI case — same as
    // the sibling test above) and 401 when they are. The body-decode 400 path is
    // covered by the gmail-pubsub-jwt unit tests; here we only assert a controlled
    // rejection, never an uncontrolled 5xx crash.
    expect([401, 503]).toContain(response.status())
  })
})
