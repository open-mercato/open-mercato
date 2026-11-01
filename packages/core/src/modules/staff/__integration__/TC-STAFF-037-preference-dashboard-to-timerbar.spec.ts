import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  assignEmployeeToProjectFixture,
  createTimeProjectFixture,
  deleteStaffEntityIfExists,
  getSelfStaffMemberId,
  readTimesheetPreference,
  setTimesheetPreference,
  stopRunningTimers,
} from '@open-mercato/core/helpers/integration/timesheetFixtures'
import { createTestCustomer, type TestCustomerFixture } from './fixtures'

/**
 * TC-STAFF-037: a project remembered by the dashboard widget preselects in the TimerBar
 *
 * The product has two timer surfaces that used to disagree about the same fact:
 * the dashboard widget remembered the last-used project privately, and the
 * timesheets page had no memory at all. Phase 3 moves that memory into one
 * `staff`-owned store both surfaces read.
 *
 * The widget's write is exercised here through the very call the widget makes —
 * `PUT /api/staff/timesheets/my-preferences` — rather than by placing the widget
 * on a dashboard, which would make this spec depend on dashboard layout
 * plumbing that has nothing to do with the behavior under test. That the widget
 * really issues this call, and really seeds itself from the response, is pinned
 * by `widgets/dashboard/timesheets-time-reporting/__tests__/widget.client.seeding.test.tsx`.
 *
 * Two projects are assigned so that only rung 2 can produce project A.
 */
test.describe('TC-STAFF-037: dashboard memory reaches the timesheets page', () => {
  test('should preselect the shared last-used project in the TimerBar', async ({ page, request }) => {
    test.setTimeout(120_000)

    const stamp = Date.now()
    const projectAName = `QA Cross D2T A ${stamp}`
    const projectBName = `QA Cross D2T B ${stamp}`

    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    const staffMemberId = await getSelfStaffMemberId(request, employeeToken)

    const previousPreference = await readTimesheetPreference(request, employeeToken)
    let projectAId: string | null = null
    let customer: TestCustomerFixture | null = null
    let projectBId: string | null = null

    try {
      await stopRunningTimers(request, employeeToken, staffMemberId)

      customer = await createTestCustomer(request, adminToken)
      projectAId = await createTimeProjectFixture(request, adminToken, {
        customerId: customer.id,
        name: projectAName,
        code: `QD2A-${stamp}`,
      })
      projectBId = await createTimeProjectFixture(request, adminToken, {
        customerId: customer.id,
        name: projectBName,
        code: `QD2B-${stamp}`,
      })
      await assignEmployeeToProjectFixture(request, adminToken, projectAId, staffMemberId)
      await assignEmployeeToProjectFixture(request, adminToken, projectBId, staffMemberId)

      // What the widget writes after a successful start.
      const saved = await setTimesheetPreference(request, employeeToken, projectAId)
      expect(saved.status(), 'PUT my-preferences should return 200').toBe(200)
      await expect
        .poll(async () => (await readTimesheetPreference(request, employeeToken)).lastProjectId)
        .toBe(projectAId)

      await login(page, 'employee')
      await page.goto('/backend/staff/timesheets')

      // The gate: the other surface honours it without a manual pick.
      await expect(page.getByRole('button', { name: new RegExp(projectAName) })).toBeVisible({
        timeout: 30_000,
      })
      await expect(page.getByRole('button', { name: 'Start timer' })).toBeEnabled()
    } finally {
      await stopRunningTimers(request, employeeToken, staffMemberId).catch(() => {})
      await setTimesheetPreference(request, employeeToken, previousPreference.lastProjectId).catch(() => {})
      await deleteStaffEntityIfExists(request, adminToken, '/api/staff/timesheets/time-projects', projectAId)
      await deleteStaffEntityIfExists(request, adminToken, '/api/staff/timesheets/time-projects', projectBId)
      await customer?.cleanup()
    }
  })
})
