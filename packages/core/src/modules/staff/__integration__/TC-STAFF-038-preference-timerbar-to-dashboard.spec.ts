import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  assignEmployeeToProjectFixture,
  createTimeProjectFixture,
  deleteStaffEntityIfExists,
  deleteTimeEntriesForProject,
  getSelfStaffMemberId,
  readTimesheetPreference,
  setTimesheetPreference,
  stopRunningTimers,
} from '@open-mercato/core/helpers/integration/timesheetFixtures'
import { createTestCustomer, type TestCustomerFixture } from './fixtures'

/**
 * TC-STAFF-038: a timer started from the TimerBar teaches the dashboard widget
 *
 * The reverse direction of TC-STAFF-037, and the one that proves the
 * unification is genuinely shared rather than a one-way read. Before this
 * change the widget owned the only memory and the timesheets page could not
 * write to it; a spec that only asserted dashboard → TimerBar would pass on an
 * implementation where the page still had no voice.
 *
 * The assertion is made against the shared store the widget reads on mount
 * (`GET /api/staff/timesheets/my-preferences`) rather than by rendering the
 * widget, for the same reason as TC-STAFF-037: the widget's own read is pinned
 * by its component tests, and dashboard layout plumbing is not under test here.
 *
 * Two projects are assigned so the recorded value can only have come from the
 * deliberate pick, not from a single-candidate fallback.
 */
test.describe('TC-STAFF-038: timesheets page memory reaches the dashboard widget', () => {
  test('should publish the started project to the shared preference store', async ({ page, request }) => {
    test.setTimeout(150_000)

    const stamp = Date.now()
    const projectAName = `QA Cross T2D A ${stamp}`
    const projectBName = `QA Cross T2D B ${stamp}`

    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    const staffMemberId = await getSelfStaffMemberId(request, employeeToken)

    const previousPreference = await readTimesheetPreference(request, employeeToken)
    let projectAId: string | null = null
    let customer: TestCustomerFixture | null = null
    let projectBId: string | null = null

    try {
      await stopRunningTimers(request, employeeToken, staffMemberId)
      await setTimesheetPreference(request, employeeToken, null)

      customer = await createTestCustomer(request, adminToken)
      projectAId = await createTimeProjectFixture(request, adminToken, {
        customerId: customer.id,
        name: projectAName,
        code: `QT2A-${stamp}`,
      })
      projectBId = await createTimeProjectFixture(request, adminToken, {
        customerId: customer.id,
        name: projectBName,
        code: `QT2B-${stamp}`,
      })
      await assignEmployeeToProjectFixture(request, adminToken, projectAId, staffMemberId)
      await assignEmployeeToProjectFixture(request, adminToken, projectBId, staffMemberId)

      await login(page, 'employee')
      await page.goto('/backend/staff/timesheets')

      const startButton = page.getByRole('button', { name: 'Start timer' })
      await expect(startButton).toBeVisible({ timeout: 30_000 })

      await page.getByRole('button', { name: 'Project' }).click()
      await page.getByRole('button', { name: new RegExp(projectBName) }).click()
      await expect(startButton).toBeEnabled()
      await startButton.click()

      await expect(page.getByRole('button', { name: 'Stop timer' })).toBeVisible({ timeout: 30_000 })

      // The gate: the store the widget reads now holds what the page started.
      await expect
        .poll(async () => (await readTimesheetPreference(request, employeeToken)).lastProjectId, {
          timeout: 15_000,
        })
        .toBe(projectBId)
    } finally {
      await stopRunningTimers(request, employeeToken, staffMemberId).catch(() => {})
      await deleteTimeEntriesForProject(request, employeeToken, staffMemberId, projectAId).catch(() => {})
      await deleteTimeEntriesForProject(request, employeeToken, staffMemberId, projectBId).catch(() => {})
      await setTimesheetPreference(request, employeeToken, previousPreference.lastProjectId).catch(() => {})
      await deleteStaffEntityIfExists(request, adminToken, '/api/staff/timesheets/time-projects', projectAId)
      await deleteStaffEntityIfExists(request, adminToken, '/api/staff/timesheets/time-projects', projectBId)
      await customer?.cleanup()
    }
  })
})
