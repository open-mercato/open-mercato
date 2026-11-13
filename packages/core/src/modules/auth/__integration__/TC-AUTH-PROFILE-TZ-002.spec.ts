import { expect, test, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { DEFAULT_CREDENTIALS } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { restoreDateLocaleSettingsAfterEach } from '@open-mercato/core/helpers/integration/dateLocaleFixtures'

/**
 * TC-AUTH-PROFILE-TZ-002: Signing in through the login form applies the tenant date settings
 * Source: `.ai/specs/2026-05-18-date-locale-settings.md` (client plumbing)
 *
 * The login form lands on the backend with a client-side navigation, which does not re-render the
 * root layout. The backend layout's own settings provider must still hand the page the tenant's
 * zone and pattern, without a reload. Restores the tenant settings and the personal zone.
 */
const SETTINGS_PATH = '/api/configs/date-locale'
const MARKER = 'omtz'

/** Signs in through the login form (client-side redirect) and returns the URLs of full page loads after submit. */
async function loginThroughForm(page: Page, redirect: string): Promise<string[]> {
  await page.context().clearCookies()
  await page.goto(`/login?redirect=${redirect}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('form[data-auth-ready="1"]', { state: 'visible', timeout: 15_000 }).catch(() => null)
  const credentials = DEFAULT_CREDENTIALS.admin
  await page.getByLabel('Email').fill(credentials.email)
  const password = page.getByLabel('Password', { exact: true }).first()
  await password.fill(credentials.password)
  const fullLoads: string[] = []
  page.on('load', () => fullLoads.push(page.url()))
  await password.press('Enter')
  await page.waitForURL((url) => url.pathname === redirect, { timeout: 30_000 })
  return fullLoads
}

test.describe('TC-AUTH-PROFILE-TZ-002: Settings after a form login', () => {
  // These tests change tenant-wide date settings; keep them from overlapping anything else that
  // renders dates if the suite's single worker is ever raised.
  test.describe.configure({ mode: 'serial' })
  restoreDateLocaleSettingsAfterEach()

  test('the first page after the login redirect formats with the tenant settings', async ({ page, request }) => {
    test.setTimeout(120_000)
    const token = await getAuthToken(request, 'admin')
    const originalProfile = (await (await apiRequest(request, 'GET', '/api/auth/profile', { token })).json()) as {
      timezone?: string | null
    }
    const originalSettings = (await (await apiRequest(request, 'GET', SETTINGS_PATH, { token })).json()) as {
      settings: Record<string, unknown>
    }

    try {
      await apiRequest(request, 'PUT', '/api/auth/profile', { token, data: { timezone: null } })
      const saved = await apiRequest(request, 'PUT', SETTINGS_PATH, {
        token,
        data: { ...originalSettings.settings, timeZone: 'Pacific/Kiritimati', dateTimeFormat: `yyyy-MM-dd HH 'h' '${MARKER}'` },
      })
      expect(saved.status()).toBe(200)

      const fullLoads = await loginThroughForm(page, '/backend/profile/time-zone')

      const preview = page.getByTestId('profile-time-zone-preview')
      await expect(preview).toContainText(MARKER)
      const kiritimatiToday = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Pacific/Kiritimati',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(new Date())
      const part = (type: string) => kiritimatiToday.find((entry) => entry.type === type)?.value ?? ''
      await expect(preview).toContainText(`${part('year')}-${part('month')}-${part('day')}`)
      expect(fullLoads.filter((url) => url.includes('/backend/profile/time-zone'))).toEqual([])
    } finally {
      await apiRequest(request, 'PUT', '/api/auth/profile', { token, data: { timezone: originalProfile.timezone ?? null } }).catch(() => {})
      await apiRequest(request, 'PUT', SETTINGS_PATH, { token, data: originalSettings.settings }).catch(() => {})
    }
  })

  // Regression: the root layout's provider re-renders on every navigation while the backend
  // layout's does not. Plain `formatDisplayDateTime` calls (the API keys list) must keep the tenant
  // settings after further client-side navigations, not only on the first page.
  test('plain helpers keep the tenant settings after later client-side navigations', async ({ page, request }) => {
    test.setTimeout(120_000)
    const token = await getAuthToken(request, 'admin')
    const originalProfile = (await (await apiRequest(request, 'GET', '/api/auth/profile', { token })).json()) as {
      timezone?: string | null
    }
    const originalSettings = (await (await apiRequest(request, 'GET', SETTINGS_PATH, { token })).json()) as {
      settings: Record<string, unknown>
    }
    let keyId: string | null = null

    try {
      await apiRequest(request, 'PUT', '/api/auth/profile', { token, data: { timezone: null } })
      await apiRequest(request, 'PUT', SETTINGS_PATH, {
        token,
        data: { ...originalSettings.settings, timeZone: 'Pacific/Kiritimati', dateTimeFormat: `yyyy-MM-dd HH 'h' '${MARKER}'` },
      })
      const created = await apiRequest(request, 'POST', '/api/api_keys/keys', {
        token,
        data: { name: `QA TC-AUTH-PROFILE-TZ-002 ${Date.now()}`, expiresAt: '2030-01-15T12:00:00.000Z' },
      })
      expect(created.ok()).toBe(true)
      keyId = ((await created.json()) as { id?: string }).id ?? null
      // 12:00Z is 02:00 the next day in Kiritimati (UTC+14).
      const expected = `2030-01-16 02 h ${MARKER}`

      const fullLoads = await loginThroughForm(page, '/backend/api-keys')
      await expect(page.getByText(expected).first()).toBeVisible()

      await page.getByRole('link', { name: 'Create', exact: true }).first().click()
      await page.waitForURL(/\/backend\/api-keys\/create/)
      await page.goBack()
      await page.waitForURL(/\/backend\/api-keys$/)
      await expect(page.getByText(expected).first()).toBeVisible()
      expect(fullLoads.filter((url) => url.includes('/backend/'))).toEqual([])
    } finally {
      if (keyId) {
        await apiRequest(request, 'DELETE', `/api/api_keys/keys?id=${encodeURIComponent(keyId)}`, { token }).catch(() => {})
      }
      await apiRequest(request, 'PUT', '/api/auth/profile', { token, data: { timezone: originalProfile.timezone ?? null } }).catch(() => {})
      await apiRequest(request, 'PUT', SETTINGS_PATH, { token, data: originalSettings.settings }).catch(() => {})
    }
  })
})
