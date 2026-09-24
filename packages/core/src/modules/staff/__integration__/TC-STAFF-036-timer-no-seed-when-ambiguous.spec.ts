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

async function setShowInGrid(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  projectId: string,
  showInGrid: boolean,
) {
  const response = await apiRequest(
    request,
    'PATCH',
    `/api/staff/timesheets/my-projects/${encodeURIComponent(projectId)}`,
    { token, data: { showInGrid } },
  )
  expect(response.ok(), `PATCH my-projects/${projectId} should succeed: ${response.status()}`).toBeTruthy()
}

/**
 * TC-STAFF-036: several candidates produce no seed at all
 *
 * The deliberate non-feature. Rung 3 requires *exactly one* grid-visible
 * project and rung 4 *exactly one* assigned project, so two of each resolves to
 * `null`. Guessing among equals would silently log an afternoon to the wrong
 * client, and time data feeds billing — a disabled Start button with a stated
 * reason is the honest state and costs one click.
 *
 * This is the boundary that keeps the feature safe, so it is asserted directly
 * rather than inferred from the resolver's unit tests: the picker must stay
 * empty, Start must stay disabled, and the Phase 1 hint must explain why.
 */
test.describe('TC-STAFF-036: no seed when the choice is ambiguous', () => {
  test('should leave Start disabled with a reason when two projects are grid-visible', async ({
    page,
    request,
  }) => {
    test.setTimeout(150_000)

    const stamp = Date.now()
    const projectAName = `QA Ambiguous A ${stamp}`
    const projectBName = `QA Ambiguous B ${stamp}`

    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    const staffMemberId = await getSelfStaffMemberId(request, employeeToken)

    const previousPreference = await readTimesheetPreference(request, employeeToken)
    let projectAId: string | null = null
    let customer: TestCustomerFixture | null = null
    let projectBId: string | null = null

    try {
      // Rungs 1 and 2 both outrank ambiguity, so both must be cleared for the
      // rung-3/4 boundary to be the thing under test.
      await stopRunningTimers(request, employeeToken, staffMemberId)
      await setTimesheetPreference(request, employeeToken, null)

      customer = await createTestCustomer(request, adminToken)
      projectAId = await createTimeProjectFixture(request, adminToken, {
        customerId: customer.id,
        name: projectAName,
        code: `QAA-${stamp}`,
      })
      projectBId = await createTimeProjectFixture(request, adminToken, {
        customerId: customer.id,
        name: projectBName,
        code: `QAB-${stamp}`,
      })
      await assignEmployeeToProjectFixture(request, adminToken, projectAId, staffMemberId)
      await assignEmployeeToProjectFixture(request, adminToken, projectBId, staffMemberId)

      // `show_in_grid` defaults to false and is opt-in by design; the member's
      // own endpoint is the only thing that may set it.
      await setShowInGrid(request, employeeToken, projectAId, true)
      await setShowInGrid(request, employeeToken, projectBId, true)

      await login(page, 'employee')
      await page.goto('/backend/staff/timesheets')

      const startButton = page.getByRole('button', { name: 'Start timer' })
      await expect(startButton).toBeVisible({ timeout: 30_000 })

      // The gate: nothing was guessed.
      await expect(page.getByRole('button', { name: 'Project' })).toBeVisible()
      await expect(startButton).toBeDisabled()

      const describedBy = await startButton.getAttribute('aria-describedby')
      expect(describedBy, 'A blocked Start must reference its explanation').toBeTruthy()
      await expect(page.locator(`#${describedBy}`)).toHaveText('Pick a project to start the timer')

      // And the block is resolvable by the action the hint asks for.
      await page.getByRole('button', { name: 'Project' }).click()
      await page.getByRole('button', { name: new RegExp(projectAName) }).click()
      await expect(startButton).toBeEnabled()
    } finally {
      await stopRunningTimers(request, employeeToken, staffMemberId).catch(() => {})
      await setTimesheetPreference(request, employeeToken, previousPreference.lastProjectId).catch(() => {})
      await deleteStaffEntityIfExists(request, adminToken, '/api/staff/timesheets/time-projects', projectAId)
      await deleteStaffEntityIfExists(request, adminToken, '/api/staff/timesheets/time-projects', projectBId)
      await customer?.cleanup()
    }
  })
})
