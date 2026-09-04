import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

type JsonRecord = Record<string, unknown>

const INTEGRATION_ID = 'channel_ms365'
const BASE_URL = process.env.BASE_URL?.trim() || ''

/**
 * TC-CHANNEL-MS365-003 — OAuth initiate builds an Entra authorize URL with PKCE.
 *
 * With the tenant client config saved, `POST /oauth/ms365/initiate` must
 * answer 200 with an `authorizeUrl` on the configured Entra authority, carry
 * the hub-minted `state`, the S256 PKCE challenge, `select_account`, and every
 * default scope, and set the HttpOnly state cookie. No live Microsoft call is
 * made — the URL is only built, never followed.
 */
test.describe('TC-CHANNEL-MS365-003: OAuth initiate with tenant config', () => {
  test('returns an Entra v2.0 authorize URL with PKCE and the default scopes', async ({ request }) => {
    const token = await getAuthToken(request)

    const initial = await apiRequest(request, 'GET', `/api/integrations/${INTEGRATION_ID}/credentials`, { token })
    expect(initial.status()).toBe(200)
    const initialBody = (await readJsonSafe(initial)) as JsonRecord
    const previousCredentials =
      initialBody.credentials && typeof initialBody.credentials === 'object' ? (initialBody.credentials as JsonRecord) : {}

    try {
      const save = await apiRequest(request, 'PUT', `/api/integrations/${INTEGRATION_ID}/credentials`, {
        token,
        data: {
          credentials: {
            clientId: 'tc-ms365-003-client-id',
            clientSecret: 'tc-ms365-003-client-secret',
            tenantId: '',
            scopes: '',
          },
        },
      })
      expect(save.status()).toBe(200)

      const response = await request.post(`${BASE_URL}/api/communication_channels/oauth/ms365/initiate`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { returnUrl: '/backend/profile/communication-channels', loginHint: 'alice@contoso.com' },
      })
      expect(response.status()).toBe(200)
      const body = (await readJsonSafe(response)) as { authorizeUrl?: string }
      expect(typeof body.authorizeUrl).toBe('string')

      const url = new URL(body.authorizeUrl as string)
      expect(url.origin).toBe('https://login.microsoftonline.com')
      expect(url.pathname).toBe('/organizations/oauth2/v2.0/authorize')
      expect(url.searchParams.get('client_id')).toBe('tc-ms365-003-client-id')
      expect(url.searchParams.get('response_type')).toBe('code')
      expect(url.searchParams.get('code_challenge_method')).toBe('S256')
      expect(url.searchParams.get('code_challenge') ?? '').toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(url.searchParams.get('prompt')).toBe('select_account')
      expect(url.searchParams.get('login_hint')).toBe('alice@contoso.com')
      expect(url.searchParams.get('state') ?? '').not.toBe('')
      expect(url.searchParams.get('redirect_uri') ?? '').toContain('/api/communication_channels/oauth/ms365/callback')
      const scope = url.searchParams.get('scope') ?? ''
      for (const expected of ['offline_access', 'openid', 'https://graph.microsoft.com/Mail.ReadWrite', 'https://graph.microsoft.com/Mail.Send', 'https://graph.microsoft.com/User.Read']) {
        expect(scope).toContain(expected)
      }

      const setCookie = response.headers()['set-cookie'] ?? ''
      expect(setCookie).toContain('HttpOnly')
    } finally {
      await apiRequest(request, 'PUT', `/api/integrations/${INTEGRATION_ID}/credentials`, {
        token,
        data: { credentials: previousCredentials },
      })
    }
  })
})
