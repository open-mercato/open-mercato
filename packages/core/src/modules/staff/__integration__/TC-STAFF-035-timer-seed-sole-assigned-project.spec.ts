import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
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

async function countAssignedProjects(
  request: Parameters<typeof apiRequest>[0],
  token: string,
): Promise<number> {
  const response = await apiRequest(request, 'GET', '/api/staff/timesheets/my-projects?pageSize=100', { token })
  expect(response.ok(), 'GET my-projects should succeed').toBeTruthy()
  const body = (await response.json()) as { items?: unknown[] }
  return Array.isArray(body.items) ? body.items.length : 0
}

/**
 * TC-STAFF-035: a member with exactly one assigned project can press Start on arrival
 *
 * Rung 4 — the case #3750 names explicitly. With one assignment there is nothing
 * to choose between, so making the member declare it is pure friction.
 *
 * The precondition is a property of the environment, not of the fixture: rung 4
 * only fires when the member has exactly one assignment in total. A fresh
 * database gives the employee none, so creating one project produces exactly
 * that. If the environment already carries assignments this suite does not own,
 * the rung is genuinely unreachable and the test skips with a reason rather than
 * deleting another suite's data or asserting something it is not testing.
 */
test.describe('TC-STAFF-035: sole assigned project seeds the picker', () => {
  test('should land with Start enabled and the only project preselected', async ({ page, request }) => {
    test.setTimeout(120_000)

    const stamp = Date.now()
    const projectName = `QA Sole Assigned ${stamp}`

    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    const staffMemberId = await getSelfStaffMemberId(request, employeeToken)

    const previousPreference = await readTimesheetPreference(request, employeeToken)
    let projectId: string | null = null
    let customer: TestCustomerFixture | null = null

    try {
      await stopRunningTimers(request, employeeToken, staffMemberId)
      // Rung 2 outranks rung 4, so a stored preference would mask what this
      // spec exists to assert.
      await setTimesheetPreference(request, employeeToken, null)

      const preExistingAssignments = await countAssignedProjects(request, employeeToken)
      test.skip(
        preExistingAssignments > 0,
        `Rung 4 requires exactly one assignment; this environment already has ${preExistingAssignments}.`,
      )

      customer = await createTestCustomer(request, adminToken)
      projectId = await createTimeProjectFixture(request, adminToken, {
        customerId: customer.id,
        name: projectName,
        code: `QSA-${stamp}`,
      })
      await assignEmployeeToProjectFixture(request, adminToken, projectId, staffMemberId)

      await login(page, 'employee')
      await page.goto('/backend/staff/timesheets')

      // The gate: no manual pick, no hint, Start immediately usable.
      const startButton = page.getByRole('button', { name: 'Start timer' })
      await expect(startButton).toBeVisible({ timeout: 30_000 })
      await expect(page.getByRole('button', { name: new RegExp(projectName) })).toBeVisible({ timeout: 30_000 })
      await expect(startButton).toBeEnabled()
      expect(
        await startButton.getAttribute('aria-describedby'),
        'A seeded picker leaves Start unblocked and undescribed',
      ).toBeNull()
    } finally {
      await stopRunningTimers(request, employeeToken, staffMemberId).catch(() => {})
      await setTimesheetPreference(request, employeeToken, previousPreference.lastProjectId).catch(() => {})
      await deleteStaffEntityIfExists(request, adminToken, '/api/staff/timesheets/time-projects', projectId)
      await customer?.cleanup()
    }
  })
})
