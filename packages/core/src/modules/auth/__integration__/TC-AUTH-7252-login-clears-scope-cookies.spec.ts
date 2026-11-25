import { expect, test, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createUserFixture, deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-AUTH-7252: a successful login clears the organization-scope cookies a previous
 * session left behind (#7252)
 *
 * TC-AUTH-071 pins the logout half: signing out expires `om_selected_org` and
 * `om_selected_tenant`. A session can also end without a logout (the access and refresh
 * tokens expire, the database is rebuilt, someone else signs in without signing out first),
 * and then the selection is still in the browser when the next person signs in.
 *
 * Pinned in a real browser:
 *   1. The first user's session ends with the scope cookies still set.
 *   2. A different user signs in on that browser; the login response expires both cookies.
 *   3. The new session resolves to the new user's own organization.
 */

const SCOPE_COOKIE_NAMES = ['om_selected_org', 'om_selected_tenant']
const SESSION_COOKIE_NAMES = ['auth_token', 'session_token']
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'

async function readCookieNames(page: Page, names: string[]): Promise<string[]> {
  const cookies = await page.context().cookies()
  return cookies.map((cookie) => cookie.name).filter((name) => names.includes(name))
}

test.describe('TC-AUTH-7252: login clears the organization-scope cookies', () => {
  test('a session that ended without a logout does not hand its selection to the next user', async ({ page, request }) => {
    const stamp = Date.now()
    const nextUserEmail = `qa-auth-7252-${stamp}@acme.com`
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
        name: 'QA TC-AUTH-7252 Next User',
      })

      await login(page, 'admin')
      await page.context().addCookies([
        { name: 'om_selected_org', value: '__all__', url: BASE_URL, sameSite: 'Lax' },
        { name: 'om_selected_tenant', value: tenantId, url: BASE_URL, sameSite: 'Lax' },
      ])

      for (const name of SESSION_COOKIE_NAMES) {
        await page.context().clearCookies({ name })
      }
      await page.goto('/login')
      expect(await readCookieNames(page, SESSION_COOKIE_NAMES), 'The first session has ended').toEqual([])
      expect(
        await readCookieNames(page, SCOPE_COOKIE_NAMES),
        'Without a logout the selection is still in the browser',
      ).toEqual(expect.arrayContaining(SCOPE_COOKIE_NAMES))

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
      expect(
        await readCookieNames(page, SCOPE_COOKIE_NAMES),
        'The login response must expire both scope cookies',
      ).toEqual([])

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
