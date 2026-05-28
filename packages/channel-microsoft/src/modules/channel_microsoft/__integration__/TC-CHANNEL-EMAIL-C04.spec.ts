import { expect, test } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-CHANNEL-EMAIL-C04 — Microsoft lifecycle `reauthorizationRequired`
 *
 * Spec C § Phase C3 — When the user revokes OAuth consent or scopes are
 * narrowed, Graph emits a `reauthorizationRequired` lifecycle event.
 * Our handler flips the channel to `status='requires_reauth'` and emits
 * the existing `communication_channels.channel.requires_reauth`
 * notification so the operator UI prompts the user to reconnect.
 *
 * Smoke: the route is reachable. End-to-end in the QA scenario markdown.
 */
test.describe('TC-CHANNEL-EMAIL-C04: reauthorizationRequired status flip', () => {
  const SUB_ID = 'sub-c04'

  test('rejects unauthenticated lifecycle posts with bad clientState as 401 or 410', async ({ request }) => {
    const response = await apiRequest(
      request,
      'POST',
      `/api/communication_channels/webhooks/microsoft/${SUB_ID}/lifecycle`,
      {
        // Webhook auth is clientState (per-subscription nonce, body field),
        // not Authorization. `apiRequest` requires a token; empty is fine.
        token: '',
        data: {
          value: [
            {
              subscriptionId: SUB_ID,
              clientState: 'definitely-wrong-state',
              lifecycleEvent: 'reauthorizationRequired',
            },
          ],
        },
      },
    )
    // Unknown subscription → 410 Gone (preferred so Graph drops the
    // subscription); a matching subscription with wrong clientState → 401.
    // Either status code is acceptable; 5xx would indicate a route bug.
    expect([401, 410]).toContain(response.status())
  })
})
