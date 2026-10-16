import { expect, test, type APIRequestContext } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  assignEmployeeToProjectFixture,
  createTimeProjectFixture,
  deleteStaffEntityIfExists,
} from '@open-mercato/core/helpers/integration/timesheetFixtures'
import { createTestCustomer } from './fixtures'

type TimeEntryListItem = {
  id?: string
  time_project_id?: string
  notes?: string | null
  started_at?: string | null
  ended_at?: string | null
}

async function getSelfStaffMemberId(request: APIRequestContext, token: string) {
  const selfResponse = await apiRequest(request, 'GET', '/api/staff/team-members/self', {
    token,
  })
  expect(selfResponse.ok(), 'GET /api/staff/team-members/self should succeed').toBeTruthy()
  const selfBody = (await selfResponse.json()) as { member?: { id?: string } }
  const staffMemberId = selfBody.member?.id ?? ''
  expect(staffMemberId.length > 0, 'Employee must have a staff member profile').toBeTruthy()
  return staffMemberId
}

async function listEntriesForDate(
  request: APIRequestContext,
  token: string,
  staffMemberId: string,
  date: string,
) {
  const response = await apiRequest(
    request,
    'GET',
    `/api/staff/timesheets/time-entries?staffMemberId=${encodeURIComponent(staffMemberId)}&from=${date}&to=${date}&pageSize=50`,
    { token },
  )
  expect(response.ok(), 'GET /api/staff/timesheets/time-entries should succeed').toBeTruthy()
  const body = (await response.json()) as { items?: TimeEntryListItem[] }
  return body.items ?? []
}

async function stopActiveEntries(
  request: APIRequestContext,
  token: string,
  staffMemberId: string,
  date: string,
) {
  const entries = await listEntriesForDate(request, token, staffMemberId, date)
  for (const entry of entries) {
    if (!entry.id || !entry.started_at || entry.ended_at) continue
    await apiRequest(
      request,
      'POST',
      `/api/staff/timesheets/time-entries/${encodeURIComponent(entry.id)}/timer-stop`,
      { token },
    ).catch(() => {})
  }
}

/**
 * TC-STAFF-028: Running Timer Note Edits Persist
 * Verifies employees can update the timer note while the timer is running and
 * the updated note persists on the active entry.
 * Covers the TimerBar "editable description while running" UX improvement.
 * Self-contained: creates project + assigns employee in setup, cleans up in teardown.
 */
test.describe('TC-STAFF-028: Running Timer Note Edits Persist', () => {
  test('should persist note edits made while a timer is running', async ({ page, request }) => {
    const stamp = Date.now()
    const today = new Date().toISOString().slice(0, 10)
    const initialNote = `Initial timer note ${stamp}`
    const updatedNote = `Updated timer note ${stamp}`

    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    const employeeStaffMemberId = await getSelfStaffMemberId(request, employeeToken)

    await stopActiveEntries(request, employeeToken, employeeStaffMemberId, today)

    const customer = await createTestCustomer(request, adminToken)
    const projectId = await createTimeProjectFixture(request, adminToken, {
      customerId: customer.id,
      name: `QA Timer UX ${stamp}`,
      code: `QATX-${stamp}`,
    })

    let createdEntryId: string | null = null

    await assignEmployeeToProjectFixture(request, adminToken, projectId, employeeStaffMemberId)

    try {
      await login(page, 'employee')
      await page.goto('/backend/staff/timesheets')

      const projectButton = page.getByRole('button', { name: /^Project$/ })
      const noteInput = page.getByPlaceholder('What are you working on?')
      await expect(noteInput).toBeVisible()
      await expect(projectButton).toBeVisible()

      await noteInput.fill(initialNote)
      await projectButton.click()
      await page.getByRole('button', { name: new RegExp(`QA Timer UX ${stamp}`) }).click()
      await page.getByRole('button', { name: /start timer/i }).click()
      await expect(page.getByRole('button', { name: /stop timer/i })).toBeVisible({ timeout: 30_000 })

      await expect(noteInput).toHaveValue(initialNote)
      await noteInput.fill(updatedNote)
      await noteInput.press('Enter')

      await expect
        .poll(async () => {
          const entries = await listEntriesForDate(
            request,
            employeeToken,
            employeeStaffMemberId,
            today,
          )
          const matchingEntry = entries.find(
            (entry) => entry.time_project_id === projectId && entry.started_at && !entry.ended_at,
          )
          createdEntryId = matchingEntry?.id ?? null
          return matchingEntry?.notes ?? null
        })
        .toBe(updatedNote)

      await expect(noteInput).toHaveValue(updatedNote)
    } finally {
      await stopActiveEntries(request, employeeToken, employeeStaffMemberId, today).catch(() => {})
      if (!createdEntryId) {
        const cleanupEntries = await listEntriesForDate(
          request,
          employeeToken,
          employeeStaffMemberId,
          today,
        ).catch(() => [])
        createdEntryId =
          cleanupEntries.find((entry) => entry.time_project_id === projectId)?.id ?? null
      }
      await deleteStaffEntityIfExists(
        request,
        adminToken,
        '/api/staff/timesheets/time-entries',
        createdEntryId,
      )
      await deleteStaffEntityIfExists(
        request,
        adminToken,
        '/api/staff/timesheets/time-projects',
        projectId,
      )
      await customer.cleanup()
    }
  })
})
