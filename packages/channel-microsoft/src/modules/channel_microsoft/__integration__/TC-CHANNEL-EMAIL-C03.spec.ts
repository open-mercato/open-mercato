import { expect, test } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-CHANNEL-EMAIL-C03 — Microsoft lifecycle `missed` event
 *
 * Spec C § Phase C3 — When Microsoft Graph emits a `missed` lifecycle
 * event (it dropped one or more change notifications), our lifecycle
 * webhook enqueues a `microsoft-delta-sync` job to catch up via
 * `/me/messages/delta`.
 *
 * This smoke confirms the lifecycle route exists at the expected path.
 * The full happy path (POST a `missed` event → delta-sync job runs →
 * missed messages ingest into CRM) is the QA scenario markdown
 * `TC-CHANNEL-EMAIL-C03-microsoft-lifecycle-missed.md`.
 */
test.describe('TC-CHANNEL-EMAIL-C03: Lifecycle missed', () => {
  const SUB_ID = 'sub-c03'

  test('lifecycle endpoint accepts the validation handshake', async ({ request }) => {
    const response = await apiRequest(
      request,
      'POST',
      `/api/communication_channels/webhooks/microsoft/${SUB_ID}/lifecycle?validationToken=tc-c03`,
      // Webhook routes don't auth via Authorization; `apiRequest` requires
      // a token field, so pass empty.
      { token: '', data: {} },
    )
    expect(response.status()).toBe(200)
    expect(await response.text()).toBe('tc-c03')
  })

  test('rejects empty lifecycle event batches with 400', async ({ request }) => {
    const response = await apiRequest(
      request,
      'POST',
      `/api/communication_channels/webhooks/microsoft/${SUB_ID}/lifecycle`,
      { token: '', data: { value: [] } },
    )
    expect(response.status()).toBe(400)
  })
})
