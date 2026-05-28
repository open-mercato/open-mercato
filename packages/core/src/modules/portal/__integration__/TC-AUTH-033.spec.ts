import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-AUTH-033: Portal dashboard waits for nav bootstrap before asserting sidebar content
 *
 * Regression coverage for the portal-shell loading-state fix:
 *   - customer portal login succeeds for a real customer user
 *   - the dashboard waits for `portal-nav-ready[data-ready="true"]`
 *   - sidebar nav is asserted only after the bootstrap payload has hydrated
 */
test.describe('TC-AUTH-033: portal dashboard waits for nav bootstrap', () => {
  test('dashboard sidebar is asserted only after the nav ready marker flips to true', async ({ page, request }) => {
    const stamp = Date.now()
    const customerEmail = `qa-auth-033-${stamp}@test.local`
    const password = `Password${stamp}!`

    let adminToken: string | null = null
    let organizationId: string | null = null
    let orgSlug: string | null = null
    let customerId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const { tenantId } = getTokenContext(adminToken)

      const createOrgRes = await apiRequest(request, 'POST', '/api/directory/organizations', {
        token: adminToken,
        data: {
          name: `QA Portal Org ${stamp}`,
          tenantId,
        },
      })
      expect(createOrgRes.status(), 'organization should be created').toBe(201)
      const createOrgBody = (await createOrgRes.json()) as { id?: string }
      organizationId = createOrgBody.id ?? null
      expect(organizationId, 'organization id should be returned').toBeTruthy()

      const orgDetailsRes = await apiRequest(
        request,
        'GET',
        `/api/directory/organizations?view=manage&ids=${encodeURIComponent(organizationId!)}&tenantId=${encodeURIComponent(tenantId)}`,
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
          displayName: `QA Auth 033 ${stamp}`,
          organizationId,
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

      await page.goto(`/${orgSlug}/portal/dashboard`, { waitUntil: 'domcontentloaded' })
      await page.waitForURL(new RegExp(`/${orgSlug}/portal/dashboard$`), { timeout: 15_000 })

      await expect(page.getByTestId('portal-nav-ready')).toHaveAttribute('data-ready', 'true', { timeout: 15_000 })
      await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Profile' })).toBeVisible()
    } finally {
      if (adminToken && customerId) {
        await apiRequest(
          request,
          'DELETE',
          `/api/customer_accounts/admin/users/${customerId}`,
          { token: adminToken },
        ).catch(() => {})
      }
      if (adminToken && organizationId) {
        await apiRequest(
          request,
          'DELETE',
          `/api/directory/organizations?id=${encodeURIComponent(organizationId)}`,
          { token: adminToken },
        ).catch(() => {})
      }
    }
  })
})
