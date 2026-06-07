import { expect, test } from '@playwright/test'

/**
 * TC-045D-002a — Inbound webhook endpoint rejects unknown provider with 404.
 *
 * Slice 2b: the route `/api/communication_channels/webhook/[provider]` MUST 404
 * for any provider that has no registered `ChannelAdapter`. Until provider
 * packages (Slack, WhatsApp, email) ship in subsequent slices, EVERY provider
 * key produces 404 — except for an environment that has explicitly registered
 * an adapter via `registerChannelAdapter()`. This test asserts the negative
 * path; positive end-to-end inbound flow is exercised once a provider lands.
 */
test.describe('TC-045D-002a: Inbound webhook — unknown provider', () => {
  test('returns 404 for a provider key with no registered adapter', async ({ request }) => {
    const response = await request.post(
      '/api/communication_channels/webhook/__nonexistent_provider__',
      {
        headers: { 'content-type': 'application/json' },
        data: { test: true },
      },
    )
    expect(response.status(), 'webhook should 404 for unknown provider').toBe(404)
  })
})
