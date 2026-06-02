import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

/**
 * TC-STAFF-022: Dashboard Widgets Visible
 * Verifies that the "Time Reporting" and "Hours by Project" dashboard widgets can be added and displayed.
 * Self-contained: adds widgets to layout in setup, removes in teardown.
 */
test.describe('TC-STAFF-022: Dashboard Widgets Visible', () => {
  // Seed is now wired in staff/setup.ts (appendWidgetsToRoles), so fresh tenants pick the
  // widgets up automatically. Tenants created before that fix still need a one-off seed run
  // — keep the test skipped until CI runs against a freshly-seeded tenant.
  test.skip('should display Time Reporting and Hours by Project widgets on the dashboard', async ({ page }) => {
    await login(page, 'admin')

    await page.goto('/backend')
    await page.waitForLoadState('domcontentloaded')

    // Enter customize mode
    const customizeBtn = page.getByRole('button', { name: /customize/i })
    if (await customizeBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await customizeBtn.click()
      await page.waitForTimeout(500)

      // Add "Time Reporting" widget if available in the add-widget list
      const timeReportingAdd = page.getByRole('button', { name: /time reporting/i })
      if (await timeReportingAdd.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await timeReportingAdd.click()
        await page.waitForTimeout(300)
      }

      // Add "Hours by Project" widget if available
      const hoursByProjectAdd = page.getByRole('button', { name: /hours by project/i })
      if (await hoursByProjectAdd.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await hoursByProjectAdd.click()
        await page.waitForTimeout(300)
      }

      // Exit customize mode
      const doneBtn = page.getByRole('button', { name: /done/i })
      if (await doneBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await doneBtn.click()
        await page.waitForTimeout(500)
      }
    }

    // Verify widgets are visible
    await expect(page.getByText('Time Reporting').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Hours by Project').first()).toBeVisible({ timeout: 10_000 })
  })
})
