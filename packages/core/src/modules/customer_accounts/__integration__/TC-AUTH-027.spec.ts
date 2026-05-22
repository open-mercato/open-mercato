import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-AUTH-027: Password reset confirm stamps emailVerifiedAt (bug_004 regression)
 *
 * Regression test for bug_004 from
 * .ai/reports/2026-04-21-customer-portal-framework-review.md:
 *
 *   1. User signs up via /api/customer_accounts/signup → emailVerifiedAt = null
 *   2. User lets the 24h verify window lapse (or never clicks the link)
 *   3. Login is gated by the new emailVerifiedAt check → 401
 *   4. User does a password reset → password updated, but emailVerifiedAt
 *      was previously NOT stamped → user is still locked out at login
 *
 * Fix: reset-confirm now mirrors the magic-link verify stamp (scoped to
 * emailVerifiedAt IS NULL so it does not overwrite a real timestamp).
 *
 * This test exercises the full chain via real HTTP. The raw reset token is
 * obtained from the admin send-reset-link endpoint, which returns the token
 * embedded in the resetLink URL — the only public surface that exposes raw
 * tokens to a Playwright test.
 */
test.describe('TC-AUTH-027: password-reset confirm verifies the email (bug_004 regression)', () => {
  test('signup → admin reset link → reset-confirm → login succeeds even when never verified', async ({ request }) => {
    const stamp = Date.now()
    const customerEmail = `qa-auth-027-${stamp}@test.local`
    const initialPassword = `InitialPass${stamp}!`
    const newPassword = `NewPass${stamp}!`

    let adminToken: string | null = null
    let customerId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const { tenantId, organizationId } = getTokenContext(adminToken)

      // 1. User self-signs up — anti-enumeration response is 202 regardless.
      const signupRes = await request.post('/api/customer_accounts/signup', {
        data: {
          email: customerEmail,
          password: initialPassword,
          displayName: `QA Auth 027 ${stamp}`,
          tenantId,
          organizationId,
        },
        headers: { 'Content-Type': 'application/json' },
      })
      expect(signupRes.status(), 'signup must return 202').toBe(202)

      // 2. Confirm the user exists and is *not* email-verified.
      const listRes = await apiRequest(request, 'GET', `/api/customer_accounts/admin/users?search=${encodeURIComponent(customerEmail)}`, {
        token: adminToken,
      })
      expect(listRes.ok(), 'admin users list should succeed').toBeTruthy()
      const listBody = (await listRes.json()) as { items: Array<{ id: string; email: string; emailVerifiedAt: string | null }> }
      const created = listBody.items.find((u) => u.email.toLowerCase() === customerEmail.toLowerCase())
      expect(created, 'signup should create the user').toBeTruthy()
      customerId = created!.id
      expect(created!.emailVerifiedAt, 'self-signup must leave emailVerifiedAt unset').toBeFalsy()

      // 3. Login attempt with correct password must be blocked by the unverified-email gate.
      const blockedLoginRes = await request.post('/api/customer_accounts/login', {
        data: { email: customerEmail, password: initialPassword, tenantId },
        headers: { 'Content-Type': 'application/json' },
      })
      expect(blockedLoginRes.status(), 'unverified user must fail to log in').toBe(401)

      // 4. Admin issues a reset link — the response embeds the raw token.
      const resetLinkRes = await apiRequest(request, 'POST', `/api/customer_accounts/admin/users/${customerId}/send-reset-link`, {
        token: adminToken,
      })
      expect(resetLinkRes.ok(), 'admin send-reset-link should succeed').toBeTruthy()
      const resetLinkBody = (await resetLinkRes.json()) as { ok: boolean; resetLink: string }
      expect(resetLinkBody.ok).toBe(true)
      const tokenMatch = resetLinkBody.resetLink.match(/[?&]token=([^&]+)/)
      expect(tokenMatch, 'resetLink must include a raw token query parameter').toBeTruthy()
      const rawResetToken = decodeURIComponent(tokenMatch![1])

      // 5. User completes reset-confirm with the raw token.
      const confirmRes = await request.post('/api/customer_accounts/password/reset-confirm', {
        data: { token: rawResetToken, password: newPassword },
        headers: { 'Content-Type': 'application/json' },
      })
      expect(confirmRes.ok(), 'password reset confirm should succeed').toBeTruthy()

      // 6. Login with the new password must now succeed — the regression assertion.
      // Without the bug_004 fix, emailVerifiedAt would still be null and login would 401.
      const loginRes = await request.post('/api/customer_accounts/login', {
        data: { email: customerEmail, password: newPassword, tenantId },
        headers: { 'Content-Type': 'application/json' },
      })
      expect(loginRes.status(), 'login after reset-confirm must succeed (bug_004)').toBe(200)
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
