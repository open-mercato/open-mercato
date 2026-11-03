import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { DEFAULT_CREDENTIALS } from '@open-mercato/core/modules/core/__integration__/helpers/auth'

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

test.describe('TC-AUTH-PROFILE-TZ-002: Settings after a form login', () => {
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

      await page.context().clearCookies()
      await page.goto('/login?redirect=/backend/profile/time-zone', { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('form[data-auth-ready="1"]', { state: 'visible', timeout: 15_000 }).catch(() => null)
      const credentials = DEFAULT_CREDENTIALS.admin
      await page.getByLabel('Email').fill(credentials.email)
      const password = page.getByLabel('Password', { exact: true }).first()
      await password.fill(credentials.password)
      const fullLoads: string[] = []
      page.on('load', () => fullLoads.push(page.url()))
      await password.press('Enter')
      await page.waitForURL(/\/backend\/profile\/time-zone/, { timeout: 30_000 })

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
})
