import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-AUTH-030: Concurrent session cap (Phase 4 regression)
 *
 * Regression test for the MAX_CUSTOMER_SESSIONS_PER_USER cap added by Phase 4
 * of .ai/reports/2026-04-21-customer-portal-framework-review.md.
 *
 * Default cap = 5. Issuing the 6th session for the same user must soft-delete
 * the oldest active session, leaving the active count <= 5.
 *
 * Acceptance text from the review: "the 6th concurrent session for a user
 * revokes session #1; cleanup worker behavior unchanged."
 */
test.describe('TC-AUTH-030: concurrent session cap soft-deletes oldest sessions', () => {
  test('issuing the 6th login keeps only 5 active sessions', async ({ request }) => {
    const stamp = Date.now()
    const customerEmail = `qa-auth-030-${stamp}@test.local`
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
          displayName: `QA Auth 030 ${stamp}`,
        },
      })
      expect(createRes.status()).toBe(201)
      const createBody = (await createRes.json()) as { user: { id: string } }
      customerId = createBody.user.id

      // Issue 6 sessions back-to-back.
      const sessionTokens: string[] = []
      for (let i = 0; i < 6; i++) {
        const loginRes = await request.post('/api/customer_accounts/login', {
          data: { email: customerEmail, password, tenantId },
          headers: { 'Content-Type': 'application/json' },
        })
        expect(loginRes.ok(), `login #${i + 1} should succeed`).toBeTruthy()
        const setCookie = loginRes.headers()['set-cookie'] ?? ''
        const sessMatch = setCookie.match(/customer_session_token=([^;]+)/)
        expect(sessMatch, `login #${i + 1} must set customer_session_token`).toBeTruthy()
        sessionTokens.push(sessMatch![1])
        // Small delay so created_at timestamps strictly increase across rows.
        await new Promise((resolve) => setTimeout(resolve, 50))
      }

      // Use the latest session to query the active sessions list.
      const latestSessionToken = sessionTokens[sessionTokens.length - 1]
      // We also need a JWT for that session — fetch it via a fresh refresh.
      const refreshRes = await request.post('/api/customer_accounts/portal/sessions-refresh', {
        headers: { Cookie: `customer_session_token=${latestSessionToken}` },
      })
      expect(refreshRes.ok(), 'refresh on the latest session must succeed').toBeTruthy()
      const refreshSetCookie = refreshRes.headers()['set-cookie'] ?? ''
      const jwtMatch = refreshSetCookie.match(/customer_auth_token=([^;]+)/)
      expect(jwtMatch).toBeTruthy()

      const sessionsListRes = await request.get('/api/customer_accounts/portal/sessions', {
        headers: { Cookie: `customer_auth_token=${jwtMatch![1]}; customer_session_token=${latestSessionToken}` },
      })
      expect(sessionsListRes.ok(), 'sessions list should succeed').toBeTruthy()
      const sessionsBody = (await sessionsListRes.json()) as { sessions: Array<{ id: string }> }
      // Only the active (non-deleted, non-expired) sessions are returned.
      // After 6 logins with cap=5, exactly 5 should remain.
      expect(sessionsBody.sessions.length, 'cap should soft-delete the oldest session(s)').toBeLessThanOrEqual(5)
      expect(sessionsBody.sessions.length, 'all but the over-cap sessions remain active').toBe(5)
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
