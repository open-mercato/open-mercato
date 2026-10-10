import { expect, test, type APIRequestContext } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  assignEmployeeToProjectFixture,
  createTimeProjectFixture,
  deleteStaffEntityIfExists,
} from '@open-mercato/core/helpers/integration/timesheetFixtures'
import { createTestCustomer, type TestCustomerFixture } from './fixtures'

type TimeEntryListItem = {
  id?: string
  started_at?: string | null
  ended_at?: string | null
}

async function getSelfStaffMemberId(request: APIRequestContext, token: string) {
  const response = await apiRequest(request, 'GET', '/api/staff/team-members/self', { token })
  expect(response.ok(), 'GET /api/staff/team-members/self should succeed').toBeTruthy()
  const body = (await response.json()) as { member?: { id?: string } }
  const staffMemberId = body.member?.id ?? ''
  expect(staffMemberId.length > 0, 'Employee must have a staff member profile').toBeTruthy()
  return staffMemberId
}

async function stopActiveEntries(request: APIRequestContext, token: string, staffMemberId: string) {
  const response = await apiRequest(
    request,
    'GET',
    `/api/staff/timesheets/time-entries?staffMemberId=${encodeURIComponent(staffMemberId)}&running=true&pageSize=50`,
    { token },
  )
  if (!response.ok()) return
  const body = (await response.json()) as { items?: TimeEntryListItem[] }
  for (const entry of body.items ?? []) {
    if (!entry.id) continue
    await apiRequest(
      request,
      'POST',
      `/api/staff/timesheets/time-entries/${encodeURIComponent(entry.id)}/timer-stop`,
      { token },
    ).catch(() => {})
  }
}

/**
 * TC-STAFF-032: The disabled Start button explains why it is disabled
 *
 * `selectedProjectId` initialises to `null` and the Start control is
 * `disabled={isStarting || !selectedProjectId}` on an icon-only `IconButton`
 * whose sole label is `aria-label="Start timer"`. On every page load the user
 * therefore meets a greyed button with no stated reason and no visual link to
 * the picker that would unblock it — issue #3750, item 2.
 *
 * A disabled button emits no pointer events, so the reason cannot ride on the
 * button's own hover. The fix wraps the control in a focusable span for the
 * tooltip trigger and wires the reason through `aria-describedby`, which is
 * what this spec asserts: the association a screen-reader user actually gets,
 * not merely that some text exists somewhere on the page.
 *
 * The "no projects assigned at all" branch is covered by the sibling component
 * test (`lib/timesheets-ui/__tests__/TimerBar.startHint.test.tsx`); producing a
 * genuinely zero-assignment employee in a shared environment would mean
 * deleting assignments this suite does not own.
 *
 * Self-contained: creates its own project and assignment, cleans up in `finally`.
 */
test.describe('TC-STAFF-032: disabled Start button states its reason', () => {
  test('should describe the blocked Start control and clear it once a project is picked', async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000)

    const stamp = Date.now()
    const projectName = `QA Start Hint ${stamp}`

    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    const staffMemberId = await getSelfStaffMemberId(request, employeeToken)
    let projectId: string | null = null
    let customer: TestCustomerFixture | null = null

    try {
      // A running timer swaps Start for Stop and there would be no hint to assert.
      await stopActiveEntries(request, employeeToken, staffMemberId)

      // The picker also seeds from the saved "last started" project. A timer start
      // earlier in the run (TC-STAFF-028) leaves one behind, which would preselect
      // it, enable Start and remove the very hint this spec asserts.
      const resetPreferenceResponse = await apiRequest(
        request,
        'PUT',
        '/api/staff/timesheets/my-preferences',
        { token: employeeToken, data: { lastProjectId: null } },
      )
      expect(
        resetPreferenceResponse.ok(),
        'PUT /api/staff/timesheets/my-preferences should clear the saved project',
      ).toBeTruthy()

      customer = await createTestCustomer(request, adminToken)
      projectId = await createTimeProjectFixture(request, adminToken, {
        customerId: customer.id,
        name: projectName,
        code: `QSH-${stamp}`,
      })
      await assignEmployeeToProjectFixture(request, adminToken, projectId, staffMemberId)

      await login(page, 'employee')
      await page.goto('/backend/staff/timesheets')

      // The timer bar renders before the assigned projects arrive; wait for the grid
      // so the hint is read once the picker has had its chance to seed.
      await expect(page.getByRole('table')).toBeVisible({ timeout: 30_000 })
      await expect(
        page.getByRole('button', { name: 'Project', exact: true }),
        'The picker must start unseeded for the blocked state to exist',
      ).toBeVisible()

      const startButton = page.getByRole('button', { name: 'Start timer' })
      await expect(startButton).toBeVisible({ timeout: 30_000 })
      await expect(startButton).toBeDisabled()

      // The regression gate: the control must point at its own explanation.
      const describedBy = await startButton.getAttribute('aria-describedby')
      expect(describedBy, 'Disabled Start must reference a description element').toBeTruthy()
      await expect(page.locator(`#${describedBy}`)).toHaveText('Pick a project to start the timer')

      // Picking a project is the action the hint asks for; it must resolve the block.
      await page.getByRole('button', { name: 'Project' }).click()
      await page.getByRole('button', { name: new RegExp(projectName) }).click()

      await expect(startButton).toBeEnabled()
      expect(
        await startButton.getAttribute('aria-describedby'),
        'An enabled Start button must carry no blocked-state description',
      ).toBeNull()
      await expect(page.getByText('Pick a project to start the timer')).toHaveCount(0)
    } finally {
      await stopActiveEntries(request, employeeToken, staffMemberId).catch(() => {})
      await deleteStaffEntityIfExists(request, adminToken, '/api/staff/timesheets/time-projects', projectId)
      await customer?.cleanup()
    }
  })
})
