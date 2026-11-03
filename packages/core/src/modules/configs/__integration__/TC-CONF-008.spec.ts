import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'

/**
 * TC-CONF-008: Date & time settings page
 * Source: `.ai/specs/2026-05-18-date-locale-settings.md` (Phase 4)
 *
 * The Settings > System > Date & time page loads, previews a chosen preset, saves it,
 * and the saved pattern is what the API reports. Restores the original settings.
 */
const PATH = '/api/configs/date-locale'

test.describe('TC-CONF-008: Date & time settings page', () => {
  // These tests change tenant-wide date settings; keep them from overlapping anything else that
  // renders dates if the suite's single worker is ever raised.
  test.describe.configure({ mode: 'serial' })

  test('previews and saves a date format preset', async ({ page, request }) => {
    test.setTimeout(120_000)
    const token = await getAuthToken(request, 'admin')
    const originalResponse = await apiRequest(request, 'GET', PATH, { token })
    const original = (await originalResponse.json()) as { settings: Record<string, unknown> }

    try {
      await apiRequest(request, 'PUT', PATH, { token, data: { timeZone: 'UTC' } })
      await login(page, 'admin')
      await page.goto('/backend/config/date-locale')

      const preview = page.getByTestId('date-locale-preview')
      await expect(preview).toBeVisible()

      await page.getByRole('combobox', { name: 'Date format' }).click()
      await page.getByRole('option', { name: /^yyyy-MM-dd/ }).click()
      await expect(preview).toContainText('2026-12-31')

      await page.getByRole('button', { name: 'Save settings' }).click()
      await expect(page.getByText('Date and time settings saved.')).toBeVisible()

      const saved = await apiRequest(request, 'GET', PATH, { token })
      const body = (await saved.json()) as { settings: { dateFormat: string | null } }
      expect(body.settings.dateFormat).toBe('yyyy-MM-dd')
    } finally {
      await apiRequest(request, 'PUT', PATH, { token, data: original.settings }).catch(() => {})
    }
  })
})
