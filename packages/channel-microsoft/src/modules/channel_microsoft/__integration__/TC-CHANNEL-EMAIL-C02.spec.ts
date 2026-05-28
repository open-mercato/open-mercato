import { expect, test } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-CHANNEL-EMAIL-C02 — Microsoft Graph notification webhook
 *
 * Verifies the Graph notification webhook surface — validation-handshake
 * echo, clientState rejection, and 410 on missing subscription. Full
 * end-to-end (subscription create → notification → delta → CRM ingest)
 * is the manual QA scenario.
 */
test.describe('TC-CHANNEL-EMAIL-C02: Microsoft notification webhook', () => {
  const SUB_ID = 'bogus-subscription-id'

  test('echoes the validation token verbatim', async ({ request }) => {
    const response = await apiRequest(
      request,
      'POST',
      `/api/communication_channels/webhooks/microsoft/${SUB_ID}?validationToken=hello-graph`,
      // Webhook auth is JWT (Gmail) / clientState (Microsoft) — Authorization
      // is ignored. `apiRequest` requires a token field; empty satisfies the type.
      { token: '', data: {} },
    )
    expect(response.status()).toBe(200)
    const text = await response.text()
    expect(text).toBe('hello-graph')
  })

  test('rejects unknown subscriptionId with 410 Gone', async ({ request }) => {
    const response = await apiRequest(
      request,
      'POST',
      `/api/communication_channels/webhooks/microsoft/${SUB_ID}`,
      {
        token: '',
        data: {
          value: [
            {
              subscriptionId: SUB_ID,
              clientState: 'whatever',
              resource: "/me/mailFolders('inbox')/messages",
              changeType: 'created',
            },
          ],
        },
      },
    )
    // 410 tells Graph to drop the subscription. 400 is acceptable on stricter
    // body parsing if the dev server filters before reaching the handler.
    expect([410, 400]).toContain(response.status())
  })

  test('rejects empty notification batch', async ({ request }) => {
    const response = await apiRequest(
      request,
      'POST',
      `/api/communication_channels/webhooks/microsoft/${SUB_ID}`,
      { token: '', data: { value: [] } },
    )
    expect(response.status()).toBe(400)
  })
})

test.describe('TC-CHANNEL-EMAIL-C03: Microsoft lifecycle webhook', () => {
  test('echoes the validation token verbatim on lifecycle', async ({ request }) => {
    const response = await apiRequest(
      request,
      'POST',
      `/api/communication_channels/webhooks/microsoft/x/lifecycle?validationToken=lc-token`,
      { token: '', data: {} },
    )
    expect(response.status()).toBe(200)
    expect(await response.text()).toBe('lc-token')
  })

  test('rejects empty lifecycle event batch', async ({ request }) => {
    const response = await apiRequest(
      request,
      'POST',
      '/api/communication_channels/webhooks/microsoft/x/lifecycle',
      { token: '', data: { value: [] } },
    )
    expect(response.status()).toBe(400)
  })
})
