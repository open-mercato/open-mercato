import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'

const BASE_URL = process.env.BASE_URL?.trim() || ''

/**
 * TC-CHANNEL-MS365-004 — OAuth callback rejects a tampered / missing state.
 *
 * The hub binds the callback to the signed state cookie minted at initiate
 * time. A callback that arrives without that cookie (or with a `state` that
 * does not match it) MUST bounce back to the profile page with an error flash
 * and MUST NOT create a channel — the code is never exchanged.
 */
test.describe('TC-CHANNEL-MS365-004: OAuth callback state verification', () => {
  test('GET /oauth/ms365/callback with a forged state redirects with flash=error and creates no channel', async ({ request }) => {
    const token = await getAuthToken(request)

    const before = await apiRequest(request, 'GET', '/api/communication_channels/me/channels', { token })
    expect(before.status()).toBe(200)
    const beforeBody = (await before.json()) as { items?: unknown[]; channels?: unknown[] }
    const countBefore = (beforeBody.items ?? beforeBody.channels ?? []).length

    const response = await request.get(
      `${BASE_URL}/api/communication_channels/oauth/ms365/callback?code=forged-code&state=forged-state`,
      { headers: { Authorization: `Bearer ${token}` }, maxRedirects: 0 },
    )
    expect(response.status()).toBe(302)
    const location = response.headers()['location'] ?? ''
    expect(location).toContain('/backend/profile/communication-channels')
    expect(location).toContain('flash=error')
    expect(location).toContain('provider=ms365')
    expect(location).not.toContain('flash=connected')

    const after = await apiRequest(request, 'GET', '/api/communication_channels/me/channels', { token })
    const afterBody = (await after.json()) as { items?: unknown[]; channels?: unknown[] }
    expect((afterBody.items ?? afterBody.channels ?? []).length).toBe(countBefore)
  })

  test('GET /oauth/ms365/callback without code or state redirects with missing_code_or_state', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await request.get(`${BASE_URL}/api/communication_channels/oauth/ms365/callback`, {
      headers: { Authorization: `Bearer ${token}` },
      maxRedirects: 0,
    })
    expect(response.status()).toBe(302)
    expect(response.headers()['location'] ?? '').toContain('code=missing_code_or_state')
  })
})
