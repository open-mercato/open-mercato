import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

/**
 * TC-STAFF-020: My Timesheets Grid Loads
 * Verifies the monthly timesheet grid renders with project rows, day columns, and save button.
 */
test.describe('TC-STAFF-020: My Timesheets Grid Loads', () => {
  test('should render the monthly timesheet grid with projects, day columns, and save button', async ({ page }) => {
    await login(page, 'employee')

    await page.goto('/backend/staff/timesheets')

    // Verify the grid table renders
    await expect(page.getByRole('table')).toBeVisible()

    // Verify project names appear as row headers
    await expect(page.getByText('Project').first()).toBeVisible()

    // Verify day columns exist (day numbers in the header)
    await expect(page.getByText('1').first()).toBeVisible()

    // Verify "Daily Total" footer row is present (confirms grid structure)
    await expect(page.getByText('Daily Total')).toBeVisible()

    // Verify "Save Changes" button is present
    await expect(page.getByRole('button', { name: /save changes/i })).toBeVisible()
  })
})
