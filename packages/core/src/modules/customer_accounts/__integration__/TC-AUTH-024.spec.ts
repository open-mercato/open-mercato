import { expect, test } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-AUTH-024: Customer JWT is rejected after sessions_revoked_at is set
 *
 * Verifies that a JWT issued before admin password reset is blocked by the
 * sessionsRevokedAt check in getCustomerAuthFromRequest, even without a
 * session refresh — the JWT itself becomes invalid at the portal boundary.
 *
 * Complements TC-AUTH-023 which covers session token revocation.
 */
test.describe('TC-AUTH-024: Customer JWT rejected after sessions_revoked_at is set', () => {
  test('portal endpoint returns 401 for JWT issued before admin password reset', async ({ request }) => {
    const stamp = Date.now()
    const customerEmail = `qa-auth-024-${stamp}@test.local`
    const initialPassword = `InitialPass${stamp}!`
    const newPassword = `NewPass${stamp}!`

    let adminToken: string | null = null
    let customerId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')

      // 1. Create a customer user
      const createRes = await apiRequest(request, 'POST', '/api/customer_accounts/admin/users', {
        token: adminToken,
        data: {
          email: customerEmail,
          password: initialPassword,
          displayName: `QA Auth 024 ${stamp}`,
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

      // 3. Login as customer — capture JWT cookie only (isolates JWT path from session path)
      const portalLoginRes = await request.post('/api/customer_accounts/login', {
        data: { email: customerEmail, password: initialPassword, tenantId },
        headers: { 'Content-Type': 'application/json' },
      })
      expect(portalLoginRes.ok(), 'Customer portal login should succeed').toBeTruthy()

      const setCookieHeader = portalLoginRes.headers()['set-cookie'] ?? ''
      const jwtCookieMatch = setCookieHeader.match(/customer_auth_token=([^;]+)/)
      expect(jwtCookieMatch, 'customer_auth_token cookie must be set').toBeTruthy()

      const jwtOnlyCookie = `customer_auth_token=${jwtCookieMatch![1]}`

      // 4. Confirm JWT is accepted before reset
      const beforeRes = await request.post('/api/customer_accounts/portal/feature-check', {
        data: { features: ['portal.view'] },
        headers: { Cookie: jwtOnlyCookie, 'Content-Type': 'application/json' },
      })
      expect(beforeRes.status(), 'feature-check should succeed with valid JWT before reset').toBe(200)

      // 5. Admin resets the customer password — sets sessionsRevokedAt on CustomerUser
      const resetRes = await apiRequest(
        request,
        'POST',
        `/api/customer_accounts/admin/users/${customerId}/reset-password`,
        { token: adminToken, data: { newPassword } },
      )
      expect(resetRes.ok(), 'Admin password reset should succeed').toBeTruthy()

      // 6. Same JWT (issued before sessionsRevokedAt) must now be rejected
      const afterRes = await request.post('/api/customer_accounts/portal/feature-check', {
        data: { features: ['portal.view'] },
        headers: { Cookie: jwtOnlyCookie, 'Content-Type': 'application/json' },
      })
      expect(
        afterRes.status(),
        'portal endpoint must return 401 for JWT issued before sessionsRevokedAt',
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
