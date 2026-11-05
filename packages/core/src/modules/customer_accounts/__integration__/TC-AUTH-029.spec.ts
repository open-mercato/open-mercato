import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-AUTH-029: Portal session refresh rotates the JWT and preserves the long-lived session token
 *
 * Confirms the dual-cookie design documented in
 * packages/ui/agentic/standalone-guide.md → "Portal SPA CSRF Posture":
 *   - /api/customer_accounts/portal/sessions-refresh issues a fresh
 *     customer_auth_token (8h JWT)
 *   - It does NOT re-issue customer_session_token (the 30d cookie persists
 *     until logout / revocation / cleanup)
 */
test.describe('TC-AUTH-029: sessions-refresh rotates JWT, preserves session token', () => {
  test('refresh issues a new auth_token cookie and leaves the session_token untouched', async ({ request }) => {
    const stamp = Date.now()
    const customerEmail = `qa-auth-029-${stamp}@test.local`
    const password = `Password${stamp}!`

    let adminToken: string | null = null
    let customerId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const { tenantId } = getTokenContext(adminToken)

      const createRes = await apiRequest(request, 'POST', '/api/customer_accounts/admin/users', {
        token: adminToken,
        data: {
          email: customerEmail,
          password,
          displayName: `QA Auth 029 ${stamp}`,
        },
      })
      expect(createRes.status()).toBe(201)
      const createBody = (await createRes.json()) as { user: { id: string } }
      customerId = createBody.user.id

      const loginRes = await request.post('/api/customer_accounts/login', {
        data: { email: customerEmail, password, tenantId },
        headers: { 'Content-Type': 'application/json' },
      })
      expect(loginRes.ok(), 'portal login should succeed').toBeTruthy()

      const setCookieHeader = loginRes.headers()['set-cookie'] ?? ''
      const initialJwtMatch = setCookieHeader.match(/customer_auth_token=([^;]+)/)
      const initialSessionMatch = setCookieHeader.match(/customer_session_token=([^;]+)/)
      expect(initialJwtMatch, 'login must set customer_auth_token').toBeTruthy()
      expect(initialSessionMatch, 'login must set customer_session_token').toBeTruthy()

      const initialJwt = initialJwtMatch![1]
      const initialSession = initialSessionMatch![1]
      const cookieHeader = `customer_auth_token=${initialJwt}; customer_session_token=${initialSession}`

      // Sleep 1.1s so the new JWT's iat differs (JWT iat resolution is seconds).
      await new Promise((resolve) => setTimeout(resolve, 1100))

      const refreshRes = await request.post('/api/customer_accounts/portal/sessions-refresh', {
        headers: { Cookie: cookieHeader },
      })
      expect(refreshRes.status(), 'sessions-refresh should succeed').toBe(200)

      const refreshSetCookie = refreshRes.headers()['set-cookie'] ?? ''
      const refreshedJwtMatch = refreshSetCookie.match(/customer_auth_token=([^;]+)/)
      const refreshedSessionMatch = refreshSetCookie.match(/customer_session_token=([^;]+)/)

      expect(refreshedJwtMatch, 'refresh must re-issue customer_auth_token').toBeTruthy()
      expect(refreshedJwtMatch![1], 'refreshed JWT must differ from the initial JWT').not.toBe(initialJwt)
      expect(refreshedSessionMatch, 'refresh must NOT re-issue customer_session_token').toBeFalsy()

      // The original session token should still be valid against the listing endpoint.
      const sessionsListRes = await request.get('/api/customer_accounts/portal/sessions', {
        headers: { Cookie: `customer_auth_token=${refreshedJwtMatch![1]}; customer_session_token=${initialSession}` },
      })
      expect(sessionsListRes.ok(), 'sessions list should be reachable with the original session token').toBeTruthy()
    } finally {
      if (adminToken && customerId) {
        await apiRequest(
          request,
          'DELETE',
          `/api/customer_accounts/admin/users/${customerId}`,
          { token: adminToken },
        ).catch(() => {})
      }
    }
  })
})
