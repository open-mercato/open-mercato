import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-AUTH-063: Entering the portal at its root never paints the logged-out shell
 *
 * Regression coverage for #5678 — the portal root was treated as a public route,
 * so a matching customer session rendered the public header (Log In / Sign Up,
 * no sidebar) while the context below it held a real user. The client-side
 * redirect to /dashboard left that stale shell in place, producing authenticated
 * content under a logged-out header.
 *
 * This is the path the admin "Open Portal" action links to, and the one a custom
 * domain's `/` rewrites to.
 */
test.describe('TC-AUTH-063: portal root keeps the authenticated shell', () => {
  test('landing on /{orgSlug}/portal with a session redirects to the dashboard under the authenticated header', async ({ page, request }) => {
    const stamp = Date.now()
    const customerEmail = `qa-auth-063-${stamp}@test.local`
    const password = `Password${stamp}!`

    let adminToken: string | null = null
    let organizationId: string | null = null
    let orgSlug: string | null = null
    let customerId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const { tenantId, organizationId: tokenOrganizationId } = getTokenContext(adminToken)
      organizationId = tokenOrganizationId
      expect(organizationId, 'admin organization id should be present').toBeTruthy()

      const orgDetailsRes = await apiRequest(
        request,
        'GET',
        `/api/directory/organizations?view=manage&ids=${encodeURIComponent(organizationId)}&tenantId=${encodeURIComponent(tenantId)}`,
        { token: adminToken },
      )
      expect(orgDetailsRes.ok(), 'organization lookup should succeed').toBeTruthy()
      const orgDetailsBody = (await orgDetailsRes.json()) as { items?: Array<{ slug?: string | null }> }
      orgSlug = orgDetailsBody.items?.[0]?.slug ?? null
      expect(orgSlug, 'organization slug should be returned').toBeTruthy()

      const createRes = await apiRequest(request, 'POST', '/api/customer_accounts/admin/users', {
        token: adminToken,
        data: {
          email: customerEmail,
          password,
          displayName: `QA Auth 063 ${stamp}`,
        },
      })
      expect(createRes.status(), 'customer user should be created').toBe(201)
      const createBody = (await createRes.json()) as { user?: { id?: string } }
      customerId = createBody.user?.id ?? null
      expect(customerId, 'created user id should be returned').toBeTruthy()

      const loginRes = await request.post('/api/customer_accounts/login', {
        data: { email: customerEmail, password, tenantId },
        headers: { 'Content-Type': 'application/json' },
      })
      expect(loginRes.ok(), 'portal login should succeed').toBeTruthy()

      const setCookieHeader = loginRes.headers()['set-cookie'] ?? ''
      const authCookieMatch = setCookieHeader.match(/customer_auth_token=([^;]+)/)
      const sessionCookieMatch = setCookieHeader.match(/customer_session_token=([^;]+)/)
      expect(authCookieMatch, 'customer_auth_token cookie must be set').toBeTruthy()
      expect(sessionCookieMatch, 'customer_session_token cookie must be set').toBeTruthy()

      const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
      await page.context().addCookies([
        {
          name: 'customer_auth_token',
          value: authCookieMatch![1],
          url: baseUrl,
          sameSite: 'Lax',
        },
        {
          name: 'customer_session_token',
          value: sessionCookieMatch![1],
          url: baseUrl,
          sameSite: 'Lax',
        },
      ])

      // Enter at the portal root — the "Open Portal" / custom-domain entry point.
      await page.goto(`/${orgSlug}/portal`, { waitUntil: 'domcontentloaded' })
      await page.waitForURL(new RegExp(`/${orgSlug}/portal/dashboard$`), { timeout: 15_000 })

      await expect(page.getByTestId('portal-nav-ready')).toHaveAttribute('data-ready', 'true', { timeout: 15_000 })
      await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible()

      // The logged-out header must never survive the entry — this is the bug.
      await expect(page.getByRole('link', { name: 'Log In' })).toHaveCount(0)
      await expect(page.getByRole('link', { name: 'Sign Up' })).toHaveCount(0)
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
