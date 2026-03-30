import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

/**
 * TC-STAFF-022: Dashboard Widgets Visible
 * Verifies that the "Time Reporting" and "Hours by Project" dashboard widgets are visible.
 */
test.describe('TC-STAFF-022: Dashboard Widgets Visible', () => {
  test('should display Time Reporting and Hours by Project widgets on the dashboard', async ({ page }) => {
    await login(page, 'employee')

    await page.goto('/backend')

    // Verify "Time Reporting" widget is visible
    await expect(page.getByText('Time Reporting')).toBeVisible({ timeout: 10_000 })

    // Verify "Hours by Project" widget is visible
    await expect(page.getByText('Hours by Project')).toBeVisible()
  })
})
