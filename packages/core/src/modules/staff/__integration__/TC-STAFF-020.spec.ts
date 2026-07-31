import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createTimeProjectFixture, assignEmployeeToProjectFixture, deleteStaffEntityIfExists } from '@open-mercato/core/helpers/integration/timesheetFixtures'

/**
 * TC-STAFF-020: My Timesheets Grid Loads
 * Verifies the default weekly timesheet grid renders with project rows, day columns, and save button.
 * Self-contained: creates project + assigns employee in setup, cleans up in teardown.
 */
test.describe('TC-STAFF-020: My Timesheets Grid Loads', () => {
  test('should render the weekly timesheet grid with projects, day columns, and save button', async ({ page, request }) => {
    test.setTimeout(60_000)

    // Setup fixtures via API
    const projectSuffix = Date.now()
    const projectName = `QA Grid Project ${projectSuffix}`
    const adminToken = await getAuthToken(request, 'admin')
    const projectId = await createTimeProjectFixture(request, adminToken, {
      name: projectName,
      code: `QAG-${projectSuffix}`,
    })

    const employeeToken = await getAuthToken(request, 'employee')
    const selfRes = await apiRequest(request, 'GET', '/api/staff/team-members/self', { token: employeeToken })
    const selfBody = (await selfRes.json()) as { member?: { id?: string } }
    const employeeStaffMemberId = selfBody.member?.id ?? ''
    expect(employeeStaffMemberId.length > 0, 'Employee must have a staff member profile').toBeTruthy()

    await assignEmployeeToProjectFixture(request, adminToken, projectId, employeeStaffMemberId)
    const showInGridRes = await apiRequest(request, 'PATCH', `/api/staff/timesheets/my-projects/${projectId}`, {
      token: employeeToken,
      data: { showInGrid: true },
    })
    expect(showInGridRes.ok(), `Failed to make project visible in grid: ${showInGridRes.status()}`).toBeTruthy()

    try {
      await login(page, 'employee')
      await page.goto('/backend/staff/timesheets')

      // Verify the grid table renders
      const table = page.getByRole('table')
      await expect(table).toBeVisible({ timeout: 30_000 })

      // Verify project names appear as row headers
      await expect(table.getByRole('columnheader', { name: /project/i })).toBeVisible()
      await expect(table.getByText(projectName)).toBeVisible()

      // Verify the current weekly view renders day columns. The old monthly
      // assertion hard-coded day "1", which is not present in most weeks.
      const monday = new Date()
      const day = monday.getDay()
      const diff = day === 0 ? -6 : 1 - day
      monday.setDate(monday.getDate() + diff)
      await expect(table.getByRole('columnheader', { name: new RegExp(`\\b${monday.getDate()}\\b`) })).toBeVisible()

      // Verify "Daily Total" footer row is present
      await expect(table.getByText('Daily Total')).toBeVisible()

      // Verify "Save Changes" button is present
      await expect(page.getByRole('button', { name: /save changes/i })).toBeVisible()
    } finally {
      await deleteStaffEntityIfExists(request, adminToken, 'staff/timesheets/time-projects', projectId)
    }
  })
})
