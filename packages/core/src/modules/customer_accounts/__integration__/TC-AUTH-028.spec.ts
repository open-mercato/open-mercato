import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-AUTH-028: signup contract + unverified-login gate
 *
 * Covers the entry half of the signup → verify → login flow that the
 * 2026-04-21 customer portal review (Phase 6) called out:
 *   - signup endpoint returns 202 (anti-enumeration; bug_001 hardening).
 *   - The created user starts with emailVerifiedAt = null.
 *   - Login with correct credentials but unverified email is rejected (401).
 *
 * The verify happy-path (clicking the email-verification link) is covered
 * by unit tests on customerTokenService and end-to-end via TC-AUTH-027,
 * which uses the admin reset-link to recover from the same locked-out state.
 * No public admin endpoint exposes the raw email-verification token, so the
 * full email-link consumption is intentionally not exercised here.
 */
test.describe('TC-AUTH-028: signup creates an unverified user that cannot log in', () => {
  test('signup returns 202 and login is gated until emailVerifiedAt is stamped', async ({ request }) => {
    const stamp = Date.now()
    const customerEmail = `qa-auth-028-${stamp}@test.local`
    const password = `Password${stamp}!`

    let adminToken: string | null = null
    let customerId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const { tenantId, organizationId } = getTokenContext(adminToken)

      const signupRes = await request.post('/api/customer_accounts/signup', {
        data: {
          email: customerEmail,
          password,
          displayName: `QA Auth 028 ${stamp}`,
          tenantId,
          organizationId,
        },
        headers: { 'Content-Type': 'application/json' },
      })
      expect(signupRes.status(), 'signup must return 202 regardless of outcome (anti-enumeration)').toBe(202)

      // Anti-enumeration: a fresh signup for the same email must also return 202.
      const duplicateSignupRes = await request.post('/api/customer_accounts/signup', {
        data: {
          email: customerEmail,
          password: `Different${stamp}!`,
          displayName: `Duplicate ${stamp}`,
          tenantId,
          organizationId,
        },
        headers: { 'Content-Type': 'application/json' },
      })
      expect(duplicateSignupRes.status(), 'duplicate signup must also return 202').toBe(202)

      // The user exists with emailVerifiedAt unset.
      const listRes = await apiRequest(request, 'GET', `/api/customer_accounts/admin/users?search=${encodeURIComponent(customerEmail)}`, {
        token: adminToken,
      })
      expect(listRes.ok()).toBeTruthy()
      const listBody = (await listRes.json()) as { items: Array<{ id: string; email: string; emailVerifiedAt: string | null }> }
      const created = listBody.items.find((u) => u.email.toLowerCase() === customerEmail.toLowerCase())
      expect(created, 'signup must create the user').toBeTruthy()
      customerId = created!.id
      expect(created!.emailVerifiedAt, 'self-signup must leave emailVerifiedAt unset').toBeFalsy()

      // Login is gated by the unverified-email check.
      const loginRes = await request.post('/api/customer_accounts/login', {
        data: { email: customerEmail, password, tenantId },
        headers: { 'Content-Type': 'application/json' },
      })
      expect(loginRes.status(), 'unverified-user login must be rejected with 401').toBe(401)
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
