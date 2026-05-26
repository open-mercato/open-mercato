import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-AUTH-031: Magic-link request anti-enumeration contract
 *
 * The /api/customer_accounts/magic-link/request endpoint MUST always respond
 * with `{ ok: true }` (status 200) regardless of whether the email exists,
 * mirroring the signup anti-enumeration contract documented in
 * .ai/reports/2026-04-21-customer-portal-framework-review.md.
 *
 * The full magic-link consume → session flow is not covered here because no
 * public admin endpoint exposes the raw magic-link token to a Playwright
 * test. The verify endpoint is unit-tested via customerTokenService.
 */
test.describe('TC-AUTH-031: magic-link request returns 200 for both valid and unknown emails', () => {
  test('returns ok=true regardless of whether the user exists', async ({ request }) => {
    const stamp = Date.now()
    const realEmail = `qa-auth-031-real-${stamp}@test.local`
    const ghostEmail = `qa-auth-031-ghost-${stamp}@test.local`
    const password = `Password${stamp}!`

    let adminToken: string | null = null
    let customerId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const { tenantId } = getTokenContext(adminToken)

      // Create a real customer so the existing-user branch is exercised.
      const createRes = await apiRequest(request, 'POST', '/api/customer_accounts/admin/users', {
        token: adminToken,
        data: { email: realEmail, password, displayName: `QA Auth 031 ${stamp}` },
      })
      expect(createRes.status()).toBe(201)
      const createBody = (await createRes.json()) as { user: { id: string } }
      customerId = createBody.user.id

      const realRes = await request.post('/api/customer_accounts/magic-link/request', {
        data: { email: realEmail, tenantId },
        headers: { 'Content-Type': 'application/json' },
      })
      expect(realRes.status(), 'magic-link/request must return 200 for an existing email').toBe(200)
      const realBody = (await realRes.json()) as { ok: boolean }
      expect(realBody.ok).toBe(true)

      const ghostRes = await request.post('/api/customer_accounts/magic-link/request', {
        data: { email: ghostEmail, tenantId },
        headers: { 'Content-Type': 'application/json' },
      })
      expect(ghostRes.status(), 'magic-link/request must return 200 for an unknown email').toBe(200)
      const ghostBody = (await ghostRes.json()) as { ok: boolean }
      expect(ghostBody.ok).toBe(true)
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
