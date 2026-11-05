import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { restoreDateLocaleSettingsAfterEach } from '@open-mercato/core/helpers/integration/dateLocaleFixtures'

/**
 * TC-AUTH-PROFILE-TZ-003: Saving a personal time zone on the profile page
 * Source: `.ai/specs/2026-05-18-date-locale-settings.md` (Q2 — user override is timezone only)
 *
 * Profile → Time zone previews the chosen zone, saves it, shows it again after a reload, and
 * switching back to "Organization default" clears it. The tenant pattern ends in the zone offset
 * (`XXX`), so the preview names the zone it renders in. Restores the profile and tenant settings.
 */
const SETTINGS_PATH = '/api/configs/date-locale'
const PROFILE_PATH = '/api/auth/profile'

test.describe('TC-AUTH-PROFILE-TZ-003: Profile time zone page', () => {
  // Changes tenant-wide date settings; keep it from overlapping other date-rendering tests.
  test.describe.configure({ mode: 'serial' })
  restoreDateLocaleSettingsAfterEach()

  test('picks, saves, reloads and clears a personal time zone', async ({ page, request }) => {
    test.setTimeout(120_000)
    const token = await getAuthToken(request, 'admin')
    const originalProfile = (await (await apiRequest(request, 'GET', PROFILE_PATH, { token })).json()) as {
      timezone?: string | null
    }
    const originalSettings = (await (await apiRequest(request, 'GET', SETTINGS_PATH, { token })).json()) as {
      settings: Record<string, unknown>
    }
    const readProfileZone = async () =>
      ((await (await apiRequest(request, 'GET', PROFILE_PATH, { token })).json()) as { timezone?: string | null }).timezone ?? null

    // CrudForm renders the save action in both its header and its footer.
    const saveButton = page.getByRole('button', { name: 'Save time zone' }).first()

    try {
      const saved = await apiRequest(request, 'PUT', SETTINGS_PATH, {
        token,
        data: { ...originalSettings.settings, timeZone: 'UTC', dateTimeFormat: "yyyy-MM-dd 'omtz' XXX" },
      })
      expect(saved.status()).toBe(200)
      expect((await apiRequest(request, 'PUT', PROFILE_PATH, { token, data: { timezone: null } })).status()).toBe(200)

      await login(page, 'admin')
      await page.goto('/backend/profile/time-zone')
      const preview = page.getByTestId('profile-time-zone-preview')
      const zoneField = page.getByRole('combobox').first()
      await expect(preview).toHaveText(/omtz Z$/)

      await zoneField.fill('Asia/Tokyo')
      await page.getByRole('option', { name: 'Asia/Tokyo', exact: true }).click()
      await expect(preview).toHaveText(/omtz \+09:00$/)
      await saveButton.click()
      await expect(page.getByText('Time zone saved.')).toBeVisible()
      await expect.poll(readProfileZone).toBe('Asia/Tokyo')

      await page.reload()
      await expect(zoneField).toHaveValue('Asia/Tokyo')
      await expect(preview).toHaveText(/omtz \+09:00$/)

      await zoneField.fill('Organization default')
      await page.getByRole('option', { name: 'Organization default', exact: true }).click()
      await expect(preview).toHaveText('Shown in the organization time zone after you save.')
      await saveButton.click()
      await expect(page.getByText('Time zone saved.')).toBeVisible()
      await expect.poll(readProfileZone).toBeNull()

      await page.reload()
      await expect(preview).toHaveText(/omtz Z$/)
    } finally {
      await apiRequest(request, 'PUT', PROFILE_PATH, { token, data: { timezone: originalProfile.timezone ?? null } }).catch(() => {})
      await apiRequest(request, 'PUT', SETTINGS_PATH, { token, data: originalSettings.settings }).catch(() => {})
    }
  })
})
