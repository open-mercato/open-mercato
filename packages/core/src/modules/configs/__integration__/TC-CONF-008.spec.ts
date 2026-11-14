import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { restoreDateLocaleSettingsAfterEach } from '@open-mercato/core/helpers/integration/dateLocaleFixtures'

/**
 * TC-CONF-008: Date & time settings page
 * Source: `.ai/specs/2026-05-18-date-locale-settings.md` (Phase 4)
 *
 * The Settings > System > Date & time page loads, previews a chosen preset, saves it,
 * and the saved pattern is what the API reports. A DatePicker elsewhere in the backend then shows
 * the saved pattern and week start. Restores the original settings.
 */
const PATH = '/api/configs/date-locale'

test.describe('TC-CONF-008: Date & time settings page', () => {
  // These tests change tenant-wide date settings; keep them from overlapping anything else that
  // renders dates if the suite's single worker is ever raised.
  test.describe.configure({ mode: 'serial' })
  restoreDateLocaleSettingsAfterEach()

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

      // CrudForm wraps each field in `[data-crud-field-id]`; its select trigger has no label link.
      await page.locator('[data-crud-field-id="dateFormatMode"]').getByRole('combobox').first().click()
      await page.getByRole('option', { name: /^yyyy-MM-dd/ }).click()
      await expect(preview).toContainText('2026-12-31')

      // CrudForm renders the save action in both its header and its footer.
      await page.getByRole('button', { name: 'Save settings' }).first().click()
      await expect(page.getByText('Date and time settings saved.')).toBeVisible()

      const saved = await apiRequest(request, 'GET', PATH, { token })
      const body = (await saved.json()) as { settings: { dateFormat: string | null } }
      expect(body.settings.dateFormat).toBe('yyyy-MM-dd')
    } finally {
      await apiRequest(request, 'PUT', PATH, { token, data: original.settings }).catch(() => {})
    }
  })

  test('a backend date picker uses the tenant pattern and week start', async ({ page, request }) => {
    test.setTimeout(120_000)
    const token = await getAuthToken(request, 'admin')
    const originalResponse = await apiRequest(request, 'GET', PATH, { token })
    const original = (await originalResponse.json()) as { settings: Record<string, unknown> }

    try {
      const saved = await apiRequest(request, 'PUT', PATH, {
        token,
        data: { ...original.settings, timeZone: 'UTC', dateFormat: 'dd.MM.yyyy', firstDayOfWeek: 0 },
      })
      expect(saved.status()).toBe(200)
      await login(page, 'admin')
      await page.goto('/backend/customers/deals/create')

      const trigger = page.getByRole('button', { name: 'Expected close date' })
      const grid = page.getByRole('grid').first()
      const now = new Date()
      const year = now.getUTCFullYear()
      const month = String(now.getUTCMonth() + 1).padStart(2, '0')

      // The deal form re-renders while its pipelines and custom fields load, which can close a
      // picker opened right after navigation; retry opening, picking and applying as one step.
      await expect(async () => {
        if (!(await grid.isVisible())) await trigger.click({ timeout: 2_000 })
        await expect(grid.locator('th[scope="col"]').first()).toHaveAttribute('aria-label', 'Sunday', { timeout: 2_000 })
        await grid.locator(`[data-day="${year}-${month}-15"] button`).click({ timeout: 2_000 })
        // The picker's default footer stages the pick until it is applied.
        await page.getByRole('button', { name: 'Apply', exact: true }).click({ timeout: 2_000 })
        await expect(trigger).toHaveText(`15.${month}.${year}`, { timeout: 2_000 })
      }).toPass({ timeout: 60_000 })
    } finally {
      await apiRequest(request, 'PUT', PATH, { token, data: original.settings }).catch(() => {})
    }
  })
})
