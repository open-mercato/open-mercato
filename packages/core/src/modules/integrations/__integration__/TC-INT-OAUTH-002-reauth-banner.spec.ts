import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  TEST_OAUTH_GRANT_INTEGRATION_ID,
  connectTestGrant,
  corruptTestGrant,
  isOAuthGrantTestRouteAvailable,
  refreshTestGrant,
  resetTestGrants,
} from '@open-mercato/core/helpers/integration/oauthGrantTestRoute'

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'
const DETAIL_PAGE_PATH = `/backend/integrations/${TEST_OAUTH_GRANT_INTEGRATION_ID}`
const RECONNECT_HREF = `${DETAIL_PAGE_PATH}?tab=health`
const BANNER_TEST_ID = 'integration-oauth-grant-reauth-banner'
const BANNER_MESSAGE = 'Access to Zz Test OAuth Grant was revoked or expired. Reconnect to resume.'
const ASK_ADMIN = 'Ask an administrator to reconnect.'
const CREDENTIALS_MANAGE_FEATURE = 'integrations.credentials.manage'

type NoReloadMarkerWindow = Window & { __omOAuthBannerNoReload?: boolean }

async function invalidateTestGrant(request: APIRequestContext, token: string): Promise<void> {
  await connectTestGrant(request, token)
  const refreshed = await refreshTestGrant(request, token, { outcome: 'invalid_grant' })
  expect(refreshed.result).toBe('grant_invalidated')
}

async function openDetailPage(page: Page): Promise<void> {
  await page.goto(DETAIL_PAGE_PATH, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { level: 1, name: 'Zz Test OAuth Grant' })).toBeVisible()
}

async function signInWithToken(page: Page, token: string): Promise<void> {
  const scope = getTokenScope(token)
  await page.context().addCookies([
    { name: 'auth_token', value: token, url: BASE_URL, sameSite: 'Lax' },
    { name: 'om_selected_tenant', value: scope.tenantId, url: BASE_URL, sameSite: 'Lax' },
    { name: 'om_selected_org', value: scope.organizationId, url: BASE_URL, sameSite: 'Lax' },
    { name: 'om_demo_notice_ack', value: 'ack', url: BASE_URL, sameSite: 'Lax' },
    { name: 'om_cookie_notice_ack', value: 'ack', url: BASE_URL, sameSite: 'Lax' },
    { name: 'om_feedback_suppress', value: '1', url: BASE_URL, sameSite: 'Lax' },
  ])
}

/**
 * TC-INT-OAUTH-002 (A37): the reauth banner on the integration detail page. It shows only for an
 * `invalidated` grant: with a Reconnect link to `?tab=<connectTabId>` for a credentials manager, with
 * the "ask an administrator" ending for a Viewer, with neither while access loads; never for an
 * `active` or `unavailable` grant, and never for a `reauthRequired` flag without a grant.
 */
test.describe('TC-INT-OAUTH-002: OAuth reauth banner on the integration detail page', () => {
  test.describe.configure({ timeout: 120_000 })

  let adminToken = ''

  test.beforeEach(async ({ request }) => {
    adminToken = await getAuthToken(request, 'admin')
    test.skip(
      !(await isOAuthGrantTestRouteAvailable(request, adminToken)),
      'OM_ENABLE_TEST_OAUTH_GRANTS is off in the app under test',
    )
    await resetTestGrants(request, adminToken)
  })

  test.afterEach(async ({ request }) => {
    if (adminToken) await resetTestGrants(request, adminToken).catch(() => undefined)
  })

  test('a credentials manager sees the banner with a Reconnect link that opens the connect tab without a reload', async ({ page, request }) => {
    await invalidateTestGrant(request, adminToken)
    await login(page, 'admin')

    let releaseAccessCheck: () => void = () => undefined
    const accessCheckHeld = new Promise<void>((resolve) => {
      releaseAccessCheck = resolve
    })
    await page.route('**/api/auth/feature-check', async (route) => {
      if ((route.request().postData() ?? '').includes(CREDENTIALS_MANAGE_FEATURE)) await accessCheckHeld
      await route.continue()
    })

    await openDetailPage(page)
    const banner = page.getByTestId(BANNER_TEST_ID)
    await expect(banner).toBeVisible()
    await expect(banner).toHaveAttribute('role', 'alert')
    await expect(banner).toContainText(BANNER_MESSAGE)
    await expect(banner).not.toContainText(ASK_ADMIN)
    await expect(banner.getByRole('link')).toHaveCount(0)

    releaseAccessCheck()
    const reconnectLink = banner.getByRole('link', { name: 'Reconnect' })
    await expect(reconnectLink).toBeVisible()
    await expect(reconnectLink).toHaveAttribute('href', RECONNECT_HREF)
    await expect(banner).not.toContainText(ASK_ADMIN)
    await page.unroute('**/api/auth/feature-check')

    await page.evaluate(() => {
      ;(window as NoReloadMarkerWindow).__omOAuthBannerNoReload = true
    })
    await reconnectLink.click()
    await expect(page).toHaveURL(new RegExp(`${DETAIL_PAGE_PATH}\\?tab=health$`))
    await expect(page.getByRole('tab', { name: 'Health' })).toHaveAttribute('aria-selected', 'true')
    expect(await page.evaluate(() => (window as NoReloadMarkerWindow).__omOAuthBannerNoReload === true)).toBe(true)
  })

  test('a Viewer without integrations.credentials.manage sees the banner with the ask-an-administrator ending and no link', async ({ page, request }) => {
    const stamp = Date.now()
    const viewerEmail = `tc-int-oauth-002-viewer-${stamp}@example.com`
    const viewerPassword = 'Str0ng-Test-Pass!'
    let viewerRoleId: string | null = null
    let viewerUserId: string | null = null
    try {
      viewerRoleId = await createRoleFixture(request, adminToken, { name: `tc-int-oauth-002-viewer-${stamp}` })
      await setRoleAclFeatures(request, adminToken, { roleId: viewerRoleId, features: ['integrations.view'] })
      viewerUserId = await createUserFixture(request, adminToken, {
        email: viewerEmail,
        password: viewerPassword,
        organizationId: getTokenScope(adminToken).organizationId,
        roles: [viewerRoleId],
      })
      const viewerToken = await getAuthToken(request, viewerEmail, viewerPassword)

      await invalidateTestGrant(request, adminToken)
      await signInWithToken(page, viewerToken)
      await openDetailPage(page)

      const banner = page.getByTestId(BANNER_TEST_ID)
      await expect(banner).toContainText(`${BANNER_MESSAGE} ${ASK_ADMIN}`)
      await expect(banner.getByRole('link')).toHaveCount(0)
    } finally {
      await deleteUserIfExists(request, adminToken, viewerUserId)
      await deleteRoleIfExists(request, adminToken, viewerRoleId)
    }
  })

  test('the banner is hidden for an active and for an unavailable grant', async ({ page, request }) => {
    await connectTestGrant(request, adminToken)
    await login(page, 'admin')

    await openDetailPage(page)
    await expect(page.getByRole('tab', { name: 'Credentials' })).toBeVisible()
    await expect(page.getByTestId(BANNER_TEST_ID)).toHaveCount(0)

    expect(await corruptTestGrant(request, adminToken)).toBe(true)
    await openDetailPage(page)
    await expect(page.getByRole('tab', { name: 'Credentials' })).toBeVisible()
    await expect(page.getByTestId(BANNER_TEST_ID)).toHaveCount(0)
  })

  test('a reauthRequired flag set through the state PUT on an integration without a grant shows no banner', async ({ page, request }) => {
    const statePath = `/api/integrations/${TEST_OAUTH_GRANT_INTEGRATION_ID}/state`
    const detailResponse = await apiRequest(request, 'GET', `/api/integrations/${TEST_OAUTH_GRANT_INTEGRATION_ID}`, { token: adminToken })
    expect(detailResponse.status()).toBe(200)
    const before = await readJsonSafe<{ state?: { reauthRequired?: boolean } }>(detailResponse)
    const previousReauthRequired = before?.state?.reauthRequired === true

    try {
      const flagged = await apiRequest(request, 'PUT', statePath, { token: adminToken, data: { reauthRequired: true } })
      expect(flagged.status(), `PUT ${statePath} should return 200`).toBe(200)

      const after = await readJsonSafe<{ state?: { reauthRequired?: boolean }; oauthGrant?: unknown }>(
        await apiRequest(request, 'GET', `/api/integrations/${TEST_OAUTH_GRANT_INTEGRATION_ID}`, { token: adminToken }),
      )
      expect(after?.state?.reauthRequired).toBe(true)
      expect(after?.oauthGrant).toBeNull()

      await login(page, 'admin')
      await openDetailPage(page)
      await expect(page.getByRole('tab', { name: 'Credentials' })).toBeVisible()
      await expect(page.getByTestId(BANNER_TEST_ID)).toHaveCount(0)
    } finally {
      await apiRequest(request, 'PUT', statePath, {
        token: adminToken,
        data: { reauthRequired: previousReauthRequired },
      }).catch(() => undefined)
    }
  })
})
