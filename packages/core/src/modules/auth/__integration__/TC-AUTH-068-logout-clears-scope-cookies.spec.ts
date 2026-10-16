import { expect, test, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createUserFixture, deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-AUTH-068: Logout clears the organization-scope cookies (#7465)
 *
 * The top-bar switcher stores the selection in `om_selected_org` (and the
 * super-admin tenant pick in `om_selected_tenant`) for 30 days. Logout used to
 * clear only the auth cookies, so the next person to sign in on the same
 * browser inherited the previous selection — typically "All organizations"
 * (`__all__`), under which org-scoped creates fail.
 *
 * Pinned in a real browser, through the UI logout and a second sign-in:
 *   1. Logout removes both scope cookies from the browser.
 *   2. A different user signing in on that browser resolves to their own
 *      organization, not to the previous user's "All organizations".
 */

const SCOPE_COOKIE_NAMES = ['om_selected_org', 'om_selected_tenant']
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'

async function readScopeCookieNames(page: Page): Promise<string[]> {
  const cookies = await page.context().cookies()
  return cookies.map((cookie) => cookie.name).filter((name) => SCOPE_COOKIE_NAMES.includes(name))
}

test.describe('TC-AUTH-068: logout clears the organization-scope cookies', () => {
  test('the next user on the same browser does not inherit "All organizations"', async ({ page, request }) => {
    const stamp = Date.now()
    const nextUserEmail = `qa-auth-068-${stamp}@acme.com`
    const nextUserPassword = 'StrongSecret123!'
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenContext(adminToken)
    let nextUserId: string | null = null

    try {
      nextUserId = await createUserFixture(request, adminToken, {
        email: nextUserEmail,
        password: nextUserPassword,
        organizationId,
        roles: ['admin'],
        name: 'QA TC-AUTH-068 Next User',
      })

      await login(page, 'admin')
      await page.context().addCookies([
        { name: 'om_selected_org', value: '__all__', url: BASE_URL, sameSite: 'Lax' },
        { name: 'om_selected_tenant', value: tenantId, url: BASE_URL, sameSite: 'Lax' },
      ])
      expect(await readScopeCookieNames(page)).toEqual(expect.arrayContaining(SCOPE_COOKIE_NAMES))

      await page.getByRole('button', { name: /admin@acme.com/i }).click()
      await page.getByRole('menuitem', { name: /logout/i }).click()
      await page.waitForURL(/\/login(?:[/?#].*)?$/)
      expect(await readScopeCookieNames(page), 'Logout must remove both scope cookies').toEqual([])

      const loginStatus = await page.evaluate(
        async (credentials) => {
          const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(credentials).toString(),
          })
          return response.status
        },
        { email: nextUserEmail, password: nextUserPassword },
      )
      expect(loginStatus, 'The next user should sign in on the same browser').toBe(200)

      const switcher = await page.evaluate(async () => {
        const response = await fetch('/api/directory/organization-switcher')
        return { status: response.status, body: (await response.json()) as { selectedId?: string | null } }
      })
      expect(switcher.status).toBe(200)
      expect(switcher.body.selectedId, 'The next user should start in their own organization').toBe(organizationId)
    } finally {
      await deleteUserIfExists(request, adminToken, nextUserId)
    }
  })
})
