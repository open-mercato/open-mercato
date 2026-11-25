import { expect, test, type Page } from '@playwright/test'
import { DEFAULT_CREDENTIALS, login } from '@open-mercato/core/helpers/integration/auth'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-AUTH-075: Login clears the organization-scope cookies (GHSA-6729-5rxh-qg37)
 *
 * The sibling of TC-AUTH-071 (logout). The switcher stores its selection in
 * `om_selected_org` (and the super-admin tenant pick in `om_selected_tenant`)
 * for 30 days, and `applySuperAdminScope` honors both for a super-admin without
 * checking who made the selection. Logout already clears them (#7465); a plain
 * sign-in on the same browser used to leave them in place, silently re-scoping
 * the new super-admin to the previous user's selection without any switcher
 * interaction.
 *
 * Pinned in a real browser, without an intervening logout:
 *   1. A successful login removes both scope cookies from the browser.
 *   2. The super-admin who signs in resolves with no selection (their own
 *      default), not the previous user's organization.
 */

const SCOPE_COOKIE_NAMES = ['om_selected_org', 'om_selected_tenant']
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'

async function readScopeCookieNames(page: Page): Promise<string[]> {
  const cookies = await page.context().cookies()
  return cookies.map((cookie) => cookie.name).filter((name) => SCOPE_COOKIE_NAMES.includes(name))
}

test.describe('TC-AUTH-075: login clears the organization-scope cookies', () => {
  test('a sign-in without logout does not inherit the previous user\'s selection', async ({ page, request }) => {
    const adminToken = await (await import('@open-mercato/core/helpers/integration/api')).getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenContext(adminToken)

    await login(page, 'admin')
    await page.context().addCookies([
      { name: 'om_selected_org', value: organizationId, url: BASE_URL, sameSite: 'Lax' },
      { name: 'om_selected_tenant', value: tenantId, url: BASE_URL, sameSite: 'Lax' },
    ])
    expect(await readScopeCookieNames(page)).toEqual(expect.arrayContaining(SCOPE_COOKIE_NAMES))

    const loginResponse = await page.request.post('/api/auth/login', {
      form: DEFAULT_CREDENTIALS.superadmin,
    })
    expect(loginResponse.status(), 'The super-admin should sign in without logging out first').toBe(200)
    const session = await readJsonSafe<{ token: string }>(loginResponse)
    if (!session?.token) throw new Error('[internal] Successful login did not return a token')
    const homeOrganizationId = getTokenContext(session.token).organizationId || null

    expect(await readScopeCookieNames(page), 'Login must remove both scope cookies').toEqual([])

    const switcher = await page.request.get('/api/directory/organization-switcher')
    expect(switcher.status()).toBe(200)
    const scope = await readJsonSafe<{ selectedId: string | null }>(switcher)
    expect(scope?.selectedId, 'The switcher should resolve the new session’s home organization').toBe(homeOrganizationId)
  })
})
