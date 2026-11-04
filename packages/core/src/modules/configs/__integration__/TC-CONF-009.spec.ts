import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createCustomerUserFixture,
  deleteCustomerUserFixture,
  portalCookieHeaders,
  portalLogin,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'

/**
 * TC-CONF-009: The customer portal renders dates with its tenant's date & time settings
 * Source: `.ai/specs/2026-05-18-date-locale-settings.md` (client plumbing, portal scope)
 *
 * Portal visitors carry no staff session, so the portal layout resolves the settings of the
 * organization in the URL. The profile page's "Member since" value must use the tenant's zone and
 * pattern. Restores the tenant settings and removes the customer user.
 */
const SETTINGS_PATH = '/api/configs/date-locale'
const MARKER = 'omtz'
const ZONE = 'Pacific/Kiritimati'

function formatInZone(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')} h ${MARKER}`
}

test.describe('TC-CONF-009: Portal date & time settings', () => {
  // Changes tenant-wide date settings; keep it from overlapping other date-rendering tests.
  test.describe.configure({ mode: 'serial' })

  test('the portal profile formats dates in the tenant zone and pattern', async ({ page, request, baseURL }) => {
    test.setTimeout(120_000)
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenContext(adminToken)
    const originalSettings = (await (await apiRequest(request, 'GET', SETTINGS_PATH, { token: adminToken })).json()) as {
      settings: Record<string, unknown>
    }
    let userId: string | null = null

    try {
      const orgResponse = await apiRequest(
        request,
        'GET',
        `/api/directory/organizations?view=manage&tenantId=${encodeURIComponent(tenantId)}&ids=${encodeURIComponent(organizationId)}`,
        { token: adminToken },
      )
      expect(orgResponse.status()).toBe(200)
      const orgBody = await readJsonSafe<{ items?: Array<{ id?: string; slug?: string | null }> }>(orgResponse)
      const orgSlug = orgBody?.items?.find((item) => item.id === organizationId)?.slug
      test.skip(!orgSlug, 'the admin organization has no portal slug')

      const saved = await apiRequest(request, 'PUT', SETTINGS_PATH, {
        token: adminToken,
        data: { ...originalSettings.settings, timeZone: ZONE, dateTimeFormat: `yyyy-MM-dd HH 'h' '${MARKER}'` },
      })
      expect(saved.status()).toBe(200)

      const user = await createCustomerUserFixture(request, adminToken, {})
      userId = user.id
      const session = await portalLogin(request, { email: user.email, password: user.password, tenantId })

      const profileResponse = await request.get('/api/customer_accounts/portal/profile', {
        headers: portalCookieHeaders(session),
      })
      expect(profileResponse.status()).toBe(200)
      const profile = await readJsonSafe<{ user?: { createdAt?: string } }>(profileResponse)
      const createdAt = profile?.user?.createdAt
      expect(createdAt, 'portal profile should return createdAt').toBeTruthy()

      await page.context().addCookies([
        { name: 'customer_auth_token', value: session.authToken, url: baseURL ?? 'http://localhost:3000' },
        { name: 'customer_session_token', value: session.sessionToken, url: baseURL ?? 'http://localhost:3000' },
      ])
      await page.goto(`/${orgSlug}/portal/profile`)

      await expect(page.getByText(formatInZone(createdAt!, ZONE)).first()).toBeVisible()
    } finally {
      await deleteCustomerUserFixture(request, adminToken, userId)
      await apiRequest(request, 'PUT', SETTINGS_PATH, { token: adminToken, data: originalSettings.settings }).catch(() => {})
    }
  })
})
