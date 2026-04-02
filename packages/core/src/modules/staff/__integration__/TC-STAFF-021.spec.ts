import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

/**
 * TC-STAFF-021: Projects List Loads
 * Verifies the timesheets projects list renders with at least one project and an "Add Project" button for admin.
 */
test.describe('TC-STAFF-021: Projects List Loads', () => {
  test('should render the projects list with projects visible and Add Project button for admin', async ({ page }) => {
    await login(page, 'admin')

    await page.goto('/backend/staff/timesheets/projects')

    // Verify the projects page title renders
    await expect(page.getByText('Projects').first()).toBeVisible()

    // Verify at least one project row is visible in the table
    await expect(page.getByRole('table')).toBeVisible()
    const rowCount = await page.getByRole('row').count()
    expect(rowCount, 'Table should have header + at least one data row').toBeGreaterThanOrEqual(2)

    // Verify "Add Project" button is visible for admin
    await expect(
      page.getByRole('link', { name: /add project/i }).or(
        page.getByRole('button', { name: /add project/i }),
      ),
    ).toBeVisible()
  })
})
