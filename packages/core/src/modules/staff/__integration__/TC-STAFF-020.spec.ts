import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createTimeProjectFixture, assignEmployeeToProjectFixture, deleteStaffEntityIfExists } from '@open-mercato/core/helpers/integration/timesheetFixtures'

/**
 * TC-STAFF-020: My Timesheets Grid Loads
 * Verifies the monthly timesheet grid renders with project rows, day columns, and save button.
 * Self-contained: creates project + assigns employee in setup, cleans up in teardown.
 */
test.describe('TC-STAFF-020: My Timesheets Grid Loads', () => {
  test('should render the monthly timesheet grid with projects, day columns, and save button', async ({ page, request }) => {
    test.setTimeout(60_000)

    // Setup fixtures via API
    const adminToken = await getAuthToken(request, 'admin')
    const projectId = await createTimeProjectFixture(request, adminToken, {
      name: `QA Grid Project ${Date.now()}`,
      code: `QAG-${Date.now()}`,
    })

    const employeeToken = await getAuthToken(request, 'employee')
    const selfRes = await apiRequest(request, 'GET', '/api/staff/team-members/self', { token: employeeToken })
    const selfBody = (await selfRes.json()) as { member?: { id?: string } }
    const employeeStaffMemberId = selfBody.member?.id ?? ''
    expect(employeeStaffMemberId.length > 0, 'Employee must have a staff member profile').toBeTruthy()

    await assignEmployeeToProjectFixture(request, adminToken, projectId, employeeStaffMemberId)

    try {
      await login(page, 'employee')
      await page.goto('/backend/staff/timesheets')

      // Verify the grid table renders
      await expect(page.getByRole('table')).toBeVisible({ timeout: 30_000 })

      // Verify project names appear as row headers
      await expect(page.getByText('Project').first()).toBeVisible()

      // Verify day columns exist (day numbers in the header)
      await expect(page.getByText('1').first()).toBeVisible()

      // Verify "Daily Total" footer row is present
      await expect(page.getByText('Daily Total')).toBeVisible()

      // Verify "Save Changes" button is present
      await expect(page.getByRole('button', { name: /save changes/i })).toBeVisible()
    } finally {
      await deleteStaffEntityIfExists(request, adminToken, 'staff/timesheets/time-projects', projectId)
    }
  })
})
