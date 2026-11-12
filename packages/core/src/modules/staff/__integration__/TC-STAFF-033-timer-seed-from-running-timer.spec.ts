import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  assignEmployeeToProjectFixture,
  createTimeProjectFixture,
  deleteStaffEntityIfExists,
  getSelfStaffMemberId,
  startTimerFixture,
  stopRunningTimers,
} from '@open-mercato/core/helpers/integration/timesheetFixtures'
import { createTestCustomer, type TestCustomerFixture } from './fixtures'

/**
 * TC-STAFF-033: the picker follows the running timer across a reload and a stop
 *
 * Issue #3750 reports two symptoms — the picker resets after a refresh, and it
 * looks reset after a stop — which share one root cause. While a timer runs,
 * `TimerBar` renders a static project label instead of the picker. If the timer
 * was adopted from the server rather than started in this browser session,
 * `selectedProjectId` was never set, so the moment `isRunning` flips false the
 * picker re-renders from a still-`null` state and appears wiped.
 *
 * Rung 1 of the seeding ladder fixes both: the running timer's project is
 * authoritative and is applied on mount, so a reload shows it and a stop leaves
 * the picker holding it with Start immediately usable.
 *
 * REGRESSION GATE for the `$exists` dependency: `useActiveTimesheetTimer`
 * resolves the running timer through `?running=true`, which matches zero rows on
 * any base lacking `50cf84394`. If this spec fails, check the branch base before
 * debugging the seeding logic.
 *
 * Self-contained: creates its own project, assignment and timer; cleans up in
 * `finally`.
 */
test.describe('TC-STAFF-033: seed the picker from the running timer', () => {
  test('should show the running project after a reload and keep it after a stop', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000)

    const stamp = Date.now()
    const projectName = `QA Seed Running ${stamp}`
    const today = new Date().toISOString().slice(0, 10)

    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    const staffMemberId = await getSelfStaffMemberId(request, employeeToken)

    let projectId: string | null = null
    let customer: TestCustomerFixture | null = null
    let entryId: string | null = null

    try {
      await stopRunningTimers(request, employeeToken, staffMemberId)

      customer = await createTestCustomer(request, adminToken)
      projectId = await createTimeProjectFixture(request, adminToken, {
        customerId: customer.id,
        name: projectName,
        code: `QSR-${stamp}`,
      })
      await assignEmployeeToProjectFixture(request, adminToken, projectId, staffMemberId)

      // Started via the API, so the browser session has never seen this project
      // — exactly the "adopted from the server" case the defect lives in.
      entryId = await startTimerFixture(request, employeeToken, {
        staffMemberId,
        timeProjectId: projectId,
        date: today,
      })

      await login(page, 'employee')
      await page.goto('/backend/staff/timesheets')

      // While running, TimerBar shows a static label and a Stop control.
      const stopButton = page.getByRole('button', { name: 'Stop timer' })
      await expect(stopButton).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText(projectName).first()).toBeVisible()

      await stopButton.click()

      // The gate: once the picker returns, it must already hold the project the
      // timer was running on, and Start must be usable without a re-pick.
      const pickerButton = page.getByRole('button', { name: new RegExp(projectName) })
      await expect(pickerButton).toBeVisible({ timeout: 30_000 })

      const startButton = page.getByRole('button', { name: 'Start timer' })
      await expect(startButton).toBeEnabled()
      expect(
        await startButton.getAttribute('aria-describedby'),
        'An enabled Start button must carry no blocked-state description',
      ).toBeNull()
    } finally {
      await stopRunningTimers(request, employeeToken, staffMemberId).catch(() => {})
      await deleteStaffEntityIfExists(request, adminToken, '/api/staff/timesheets/time-entries', entryId)
      await deleteStaffEntityIfExists(request, adminToken, '/api/staff/timesheets/time-projects', projectId)
      await customer?.cleanup()
    }
  })
})
