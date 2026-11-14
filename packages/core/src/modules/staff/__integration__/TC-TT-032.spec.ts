import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

/**
 * TC-TT-032 — Reapply rounding without the progress module (#9210).
 *
 * With `progress` disabled the route still queues the recalculation and answers
 * `202` with `progressJobId: null`. The settings page must report the queued
 * entries instead of claiming there is nothing to recalculate. The route answer
 * is stubbed because the shared test app always runs with `progress` enabled;
 * no data is written.
 */

const REAPPLY_PATH = '/api/staff/timesheets/settings/reapply-rounding'
const SETTINGS_PATH = '/api/staff/timesheets/settings'

test.describe('TC-TT-032: reapply rounding without a progress job', () => {
  test('reports the queued entries when the route answers without a progress job', async ({ page }) => {
    const reapplyCalls: string[] = []
    await page.route(`**${REAPPLY_PATH}`, async (route) => {
      reapplyCalls.push(route.request().method())
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, progressJobId: null, candidateCount: 7 }),
      })
    })

    await login(page, 'admin')
    const settingsLoaded = page.waitForResponse(
      (response) => response.url().includes(SETTINGS_PATH) && response.request().method() === 'GET',
    )
    await page.goto('/backend/staff/time-tracking/settings')
    await settingsLoaded

    const reapply = page.getByTestId('reapply-rounding')
    await expect(reapply).toBeEnabled({ timeout: 30_000 })
    await reapply.click()

    const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'))
    await dialog.getByRole('button', { name: /reapply to existing entries/i }).click()

    await expect(page.getByText('Recalculating rounded time on 7 entries in the background.')).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByText('There is nothing to recalculate.')).toHaveCount(0)
    expect(reapplyCalls).toEqual(['POST'])
  })
})
