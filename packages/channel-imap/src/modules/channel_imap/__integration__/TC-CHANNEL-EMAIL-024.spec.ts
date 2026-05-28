import { expect, test } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-CHANNEL-EMAIL-024 — Threading via body footer
 *
 * When the recipient's MUA strips RFC5322 References on reply, our
 * hidden body-footer marker (`<span style="display:none">[OM:TOKEN]</span>`
 * for HTML; `[OM:TOKEN]` bracketed marker for plain text) still
 * survives quoting and the layered matcher's `token-body` strategy
 * threads the reply correctly.
 *
 * Full E2E in the QA scenario markdown. This smoke test confirms the
 * send-as-user endpoint exists (same shape as TC-023).
 */
test.describe('TC-CHANNEL-EMAIL-024: Body-footer threading', () => {
  test('send-as-user endpoint exists at the expected path', async ({ request }) => {
    const response = await apiRequest(
      request,
      'POST',
      '/api/communication_channels/send-as-user',
      // Intentionally empty token — the 401 / 400 branch is what we assert.
      { token: '', data: {} },
    )
    expect([400, 401]).toContain(response.status())
  })
})
