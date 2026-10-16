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
 * TC-STAFF-034: the picker preselects the project the member last *started*
 *
 * Rung 2 of the seeding ladder. The memory is written on a successful start
 * only — never on selection — so an idle mis-click in the dropdown does not
 * become tomorrow's default.
 *
 * Two projects are assigned deliberately. With one, rung 4 ("sole assigned
 * project") would produce the same answer and the spec would pass without
 * proving anything about persistence. With two, only rung 2 can select project
 * A, so the assertion is about the stored preference and nothing else.
 *
 * The whole round trip runs through the UI because the preference is written by
 * the client after a successful start — an API-driven start writes nothing.
 *
 * Self-contained: creates both projects and their assignments, and restores the
 * member's preference in `finally` so it does not leak into other specs.
 */
test.describe('TC-STAFF-034: seed the picker from the last started project', () => {
  test('should preselect the last started project after a reload', async ({ page, request }) => {
    test.setTimeout(150_000)

    const stamp = Date.now()
    const projectAName = `QA Last Started A ${stamp}`
    const projectBName = `QA Last Started B ${stamp}`

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
        code: `QLA-${stamp}`,
      })
      projectBId = await createTimeProjectFixture(request, adminToken, {
        customerId: customer.id,
        name: projectBName,
        code: `QLB-${stamp}`,
      })
      await assignEmployeeToProjectFixture(request, adminToken, projectAId, staffMemberId)
      await assignEmployeeToProjectFixture(request, adminToken, projectBId, staffMemberId)

      await login(page, 'employee')
      await page.goto('/backend/staff/timesheets')

      const startButton = page.getByRole('button', { name: 'Start timer' })
      await expect(startButton).toBeVisible({ timeout: 30_000 })

      // Pick A explicitly, then start — only a *successful start* writes the memory.
      await page.getByRole('button', { name: 'Project' }).click()
      await page.getByRole('button', { name: new RegExp(projectAName) }).click()
      await expect(startButton).toBeEnabled()
      await startButton.click()

      const stopButton = page.getByRole('button', { name: 'Stop timer' })
      await expect(stopButton).toBeVisible({ timeout: 30_000 })

      // The shared store is the cross-surface contract; assert it directly as
      // well as through the picker, so a UI-only regression is distinguishable
      // from a persistence one.
      await expect
        .poll(async () => (await readTimesheetPreference(request, employeeToken)).lastProjectId, {
          timeout: 15_000,
        })
        .toBe(projectAId)

      await stopButton.click()
      await expect(page.getByRole('button', { name: 'Start timer' })).toBeVisible({ timeout: 30_000 })

      // The gate: a fresh mount with no running timer must recover A from the
      // stored preference rather than falling back to an empty picker.
      await page.reload()
      await expect(page.getByRole('button', { name: new RegExp(projectAName) })).toBeVisible({
        timeout: 30_000,
      })
      await expect(page.getByRole('button', { name: 'Start timer' })).toBeEnabled()
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
