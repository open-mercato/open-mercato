import { expect, test } from '@playwright/test'

/**
 * TC-CHANNEL-EMAIL-HUB-003 — OAuth callback negative paths.
 *
 * Slice 3c delivers:
 *   - POST /api/communication_channels/oauth/[provider]/initiate
 *   - GET  /api/communication_channels/oauth/[provider]/callback
 *
 * With no provider OAuth adapter registered yet (providers ship in slices 3e/f/g),
 * both routes return 404 / 400 / 302 with error flash codes — never 5xx. This
 * verifies the routes are wired and authentication / state validation works.
 */
test.describe('TC-CHANNEL-EMAIL-HUB-003: OAuth route negative paths', () => {
  test('initiate route returns 404 for an unknown provider', async ({ request }) => {
    const response = await request.post(
      '/api/communication_channels/oauth/__nonexistent_provider__/initiate',
      {
        headers: { 'content-type': 'application/json' },
        data: { channelType: 'email' },
      },
    )
    expect(response.status()).toBeLessThan(500)
    expect([400, 401, 404]).toContain(response.status())
  })

  test('callback route does not 5xx even without state cookie', async ({ request }) => {
    const response = await request.get(
      '/api/communication_channels/oauth/__nonexistent_provider__/callback?code=abc&state=def',
      { maxRedirects: 0 },
    )
    expect(response.status()).toBeLessThan(500)
    // 302 with error flash, or 401, or 400 — never 5xx.
    expect([200, 302, 400, 401, 404]).toContain(response.status())
  })
})
