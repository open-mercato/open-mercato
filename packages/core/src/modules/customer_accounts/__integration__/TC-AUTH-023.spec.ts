import { expect, test } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-AUTH-023: Admin password reset revokes customer session tokens
 *
 * Regression test for: admin-initiated password reset did not invalidate
 * active portal sessions, allowing a stolen session token to remain usable
 * for up to 30 days after the password was changed.
 *
 * After revokeAllUserSessions, sessions-refresh must return 401.
 * Note: an existing JWT remains cryptographically valid until its natural
 * expiry (default TTL: 8 hours) — full JWT invalidation is tracked separately.
 */
test.describe('TC-AUTH-023: Admin password reset revokes customer session tokens', () => {
  test('sessions-refresh should be blocked after admin resets the password', async ({ request }) => {
    const stamp = Date.now()
    const customerEmail = `qa-auth-023-${stamp}@test.local`
    const initialPassword = `InitialPass${stamp}!`
    const newPassword = `NewPass${stamp}!`

    let adminToken: string | null = null
    let customerId: string | null = null

    try {
      // 1. Authenticate as admin (staff)
      adminToken = await getAuthToken(request, 'admin')

      // 2. Create a customer user via admin API
      const createRes = await apiRequest(request, 'POST', '/api/customer_accounts/admin/users', {
        token: adminToken,
        data: {
          email: customerEmail,
          password: initialPassword,
          displayName: `QA Auth 023 ${stamp}`,
        },
      })
      expect(createRes.status(), 'Customer user should be created').toBe(201)
      const createBody = (await createRes.json()) as { user?: { id?: string } }
      customerId = createBody.user?.id ?? null
      expect(customerId, 'Created user id should be returned').toBeTruthy()

      // 3. Decode admin JWT to get tenantId for portal login
      const adminJwtParts = adminToken.split('.')
      const adminClaims = JSON.parse(
        Buffer.from(
          adminJwtParts[1].replace(/-/g, '+').replace(/_/g, '/').padEnd(
            Math.ceil(adminJwtParts[1].length / 4) * 4,
            '=',
          ),
          'base64',
        ).toString('utf8'),
      ) as { tenantId?: string }
      const tenantId = adminClaims.tenantId
      expect(tenantId, 'tenantId must be decodable from admin JWT').toBeTruthy()

      // 4. Login as the customer user → capture session cookies
      const portalLoginRes = await request.post('/api/customer_accounts/login', {
        data: { email: customerEmail, password: initialPassword, tenantId },
        headers: { 'Content-Type': 'application/json' },
      })
      expect(portalLoginRes.ok(), 'Customer portal login should succeed').toBeTruthy()

      const setCookieHeader = portalLoginRes.headers()['set-cookie'] ?? ''
      const jwtCookieMatch = setCookieHeader.match(/customer_auth_token=([^;]+)/)
      const sessionCookieMatch = setCookieHeader.match(/customer_session_token=([^;]+)/)
      expect(jwtCookieMatch, 'customer_auth_token cookie must be set').toBeTruthy()
      expect(sessionCookieMatch, 'customer_session_token cookie must be set').toBeTruthy()

      const authCookie = `customer_auth_token=${jwtCookieMatch![1]}; customer_session_token=${sessionCookieMatch![1]}`

      // 5. Verify sessions-refresh works before reset
      const refreshBeforeRes = await request.post('/api/customer_accounts/portal/sessions-refresh', {
        headers: { Cookie: authCookie },
      })
      expect(refreshBeforeRes.status(), 'sessions-refresh should succeed with active session').toBe(200)

      // 6. Admin resets the customer user's password (also revokes all sessions)
      const resetRes = await apiRequest(
        request,
        'POST',
        `/api/customer_accounts/admin/users/${customerId}/reset-password`,
        { token: adminToken, data: { newPassword } },
      )
      expect(resetRes.ok(), 'Admin password reset should succeed').toBeTruthy()

      // 7. sessions-refresh must now be rejected — this is the regression assertion.
      // The JWT may still be valid (default TTL: 8 hours), but the session token
      // is revoked in DB so the attacker cannot renew access beyond the current JWT window.
      const refreshAfterRes = await request.post('/api/customer_accounts/portal/sessions-refresh', {
        headers: { Cookie: authCookie },
      })
      expect(
        refreshAfterRes.status(),
        'sessions-refresh must be blocked after admin password reset',
      ).toBe(401)
    } finally {
      // Cleanup: delete the customer user
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
