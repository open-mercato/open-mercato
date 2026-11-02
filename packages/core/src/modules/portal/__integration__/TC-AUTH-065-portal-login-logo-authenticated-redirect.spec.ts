import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-AUTH-065: Following the public header logo home with a session reaches the dashboard
 *
 * Regression coverage for #6362 — the public auth routes withhold the session from
 * the portal context (#5686), and the (frontend) layout does not re-run on a
 * client-side navigation. A signed-in customer on /portal/login who clicked the
 * header logo therefore reached the portal root with an empty context and was
 * shown the logged-out landing page instead of the dashboard.
 */
test.describe('TC-AUTH-065: public header logo leads a signed-in customer to the dashboard', () => {
  test('clicking the logo on /{orgSlug}/portal/login with a session lands on the dashboard under the authenticated header', async ({ page, request }) => {
    // Sharded runs can start within the same millisecond, so the timestamp
    // alone is not a unique fixture key. The suffix seeds the fixture password
    // too, so it comes from the CSPRNG rather than Math.random().
    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
    const customerEmail = `qa-auth-065-${stamp}@test.local`
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
          displayName: `QA Auth 065 ${stamp}`,
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

      // The public chrome on an auth route is intended: the session is withheld there.
      await page.goto(`/${orgSlug}/portal/login`, { waitUntil: 'domcontentloaded' })
      const headerLogo = page.locator(`header a[href="/${orgSlug}/portal"]`)
      await expect(headerLogo).toBeVisible({ timeout: 15_000 })
      // Before hydration a Next <Link> behaves as a native anchor, which would mask the bug.
      await expect
        .poll(
          () => headerLogo.evaluate((element) => Object.keys(element).some((key) => key.startsWith('__reactFiber'))),
          { timeout: 15_000 },
        )
        .toBe(true)

      await headerLogo.click()
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
