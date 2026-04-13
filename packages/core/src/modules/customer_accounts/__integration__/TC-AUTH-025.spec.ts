import { expect, test } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-AUTH-025: Sessions and JWT are both revoked after admin user deletion
 *
 * Verifies that when an admin deletes a customer user, revokeAllUserSessions
 * is called which both soft-deletes active sessions and sets sessionsRevokedAt.
 * This prevents a deleted user's stolen JWT from remaining usable.
 */
test.describe('TC-AUTH-025: Sessions and JWT revoked after admin user deletion', () => {
  test('sessions-refresh and JWT-only requests are blocked after admin deletes the user', async ({ request }) => {
    const stamp = Date.now()
    const customerEmail = `qa-auth-025-${stamp}@test.local`
    const password = `InitialPass${stamp}!`

    let adminToken: string | null = null
    let customerId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')

      // 1. Create a customer user
      const createRes = await apiRequest(request, 'POST', '/api/customer_accounts/admin/users', {
        token: adminToken,
        data: {
          email: customerEmail,
          password,
          displayName: `QA Auth 025 ${stamp}`,
        },
      })
      expect(createRes.status(), 'Customer user should be created').toBe(201)
      const createBody = (await createRes.json()) as { user?: { id?: string } }
      customerId = createBody.user?.id ?? null
      expect(customerId, 'Created user id should be returned').toBeTruthy()

      // 2. Decode tenantId from admin JWT
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

      // 3. Login as customer — capture both JWT and session cookies
      const portalLoginRes = await request.post('/api/customer_accounts/login', {
        data: { email: customerEmail, password, tenantId },
        headers: { 'Content-Type': 'application/json' },
      })
      expect(portalLoginRes.ok(), 'Customer portal login should succeed').toBeTruthy()

      const setCookieHeader = portalLoginRes.headers()['set-cookie'] ?? ''
      const jwtCookieMatch = setCookieHeader.match(/customer_auth_token=([^;]+)/)
      const sessionCookieMatch = setCookieHeader.match(/customer_session_token=([^;]+)/)
      expect(jwtCookieMatch, 'customer_auth_token cookie must be set').toBeTruthy()
      expect(sessionCookieMatch, 'customer_session_token cookie must be set').toBeTruthy()

      const sessionCookie = `customer_auth_token=${jwtCookieMatch![1]}; customer_session_token=${sessionCookieMatch![1]}`
      const jwtOnlyCookie = `customer_auth_token=${jwtCookieMatch![1]}`

      // 4. Verify both access paths work before deletion
      const refreshBeforeRes = await request.post('/api/customer_accounts/portal/sessions-refresh', {
        headers: { Cookie: sessionCookie },
      })
      expect(refreshBeforeRes.status(), 'sessions-refresh should succeed before deletion').toBe(200)

      const jwtBeforeRes = await request.post('/api/customer_accounts/portal/feature-check', {
        data: { features: ['portal.view'] },
        headers: { Cookie: jwtOnlyCookie, 'Content-Type': 'application/json' },
      })
      expect(jwtBeforeRes.status(), 'feature-check should succeed with valid JWT before deletion').toBe(200)

      // 5. Admin deletes the customer user → calls revokeAllUserSessions → sets sessionsRevokedAt
      const deleteRes = await apiRequest(
        request,
        'DELETE',
        `/api/customer_accounts/admin/users/${customerId}`,
        { token: adminToken },
      )
      expect(deleteRes.ok(), 'Admin user deletion should succeed').toBeTruthy()
      customerId = null // already deleted, skip cleanup

      // 6. Session token path must be blocked
      const refreshAfterRes = await request.post('/api/customer_accounts/portal/sessions-refresh', {
        headers: { Cookie: sessionCookie },
      })
      expect(
        refreshAfterRes.status(),
        'sessions-refresh must be blocked after admin user deletion',
      ).toBe(401)

      // 7. JWT-only path must also be blocked via sessionsRevokedAt check
      const jwtAfterRes = await request.post('/api/customer_accounts/portal/feature-check', {
        data: { features: ['portal.view'] },
        headers: { Cookie: jwtOnlyCookie, 'Content-Type': 'application/json' },
      })
      expect(
        jwtAfterRes.status(),
        'JWT must be rejected after admin user deletion sets sessionsRevokedAt',
      ).toBe(401)
    } finally {
      if (adminToken && customerId) {
        await apiRequest(request, 'DELETE', `/api/customer_accounts/admin/users/${customerId}`, {
          token: adminToken,
        }).catch(() => {})
      }
    }
  })
})
