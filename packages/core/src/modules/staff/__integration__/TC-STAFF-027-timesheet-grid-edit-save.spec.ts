import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  assignEmployeeToProjectFixture,
  createTimeEntryFixture,
  createTimeProjectFixture,
  deleteStaffEntityIfExists,
} from '@open-mercato/core/helpers/integration/timesheetFixtures'

function getMonday(date: Date): Date {
  const day = date.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(date)
  monday.setDate(date.getDate() + diff)
  return monday
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

test.describe('TC-STAFF-027: Timesheets grid decimal edit save', () => {
  test('should keep a decimal cell edit dirty after blur and persist it as minutes', async ({ page, request }) => {
    test.setTimeout(90_000)

    const stamp = Date.now()
    const projectName = `QA Grid Edit ${stamp}`
    const projectCode = `QGE-${stamp}`
    const weekStart = getMonday(new Date())
    const entryDate = formatDateKey(weekStart)
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekStart.getDate() + 6)

    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    let projectId: string | null = null
    let entryId: string | null = null

    try {
      const selfRes = await apiRequest(request, 'GET', '/api/staff/team-members/self', { token: employeeToken })
      expect(selfRes.ok(), 'GET /api/staff/team-members/self should succeed').toBeTruthy()
      const selfBody = (await selfRes.json()) as { member?: { id?: string } }
      const employeeStaffMemberId = selfBody.member?.id ?? ''
      expect(employeeStaffMemberId.length > 0, 'Employee must have a staff member profile').toBeTruthy()

      projectId = await createTimeProjectFixture(request, adminToken, {
        name: projectName,
        code: projectCode,
      })
      await assignEmployeeToProjectFixture(request, adminToken, projectId, employeeStaffMemberId)
      const showInGridResponse = await apiRequest(
        request,
        'PATCH',
        `/api/staff/timesheets/my-projects/${projectId}`,
        { token: employeeToken, data: { showInGrid: true } },
      )
      expect(showInGridResponse.ok(), 'PATCH /api/staff/timesheets/my-projects/{id} should enable grid visibility').toBeTruthy()
      entryId = await createTimeEntryFixture(request, employeeToken, {
        staffMemberId: employeeStaffMemberId,
        timeProjectId: projectId,
        date: entryDate,
        durationMinutes: 3,
      })

      await login(page, 'employee')
      await page.goto('/backend/staff/timesheets')
      await expect(page.getByRole('table')).toBeVisible({ timeout: 30_000 })

      const row = page.getByRole('row').filter({ hasText: projectName })
      await expect(row).toBeVisible()
      const firstWeekdayInput = row.getByRole('textbox').first()
      await expect(firstWeekdayInput).toHaveValue('0.05')
      await firstWeekdayInput.click()
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
      await page.keyboard.press('Backspace')
      await page.keyboard.type('2.5')
      await expect(firstWeekdayInput).toHaveValue('2.5')

      await page.keyboard.press('Tab')
      await expect(firstWeekdayInput).toHaveValue('2.5')

      const saveButton = page.getByRole('button', { name: /save changes/i })
      await expect(saveButton).toBeEnabled()
      await saveButton.click()
      await expect(page.getByRole('alertdialog', { name: /save changes/i })).toBeVisible()
      await page.getByRole('button', { name: /^confirm$/i }).click()
      await expect(saveButton).toBeDisabled({ timeout: 30_000 })

      const listEntriesResponse = await apiRequest(
        request,
        'GET',
        `/api/staff/timesheets/time-entries?staffMemberId=${encodeURIComponent(employeeStaffMemberId)}&projectId=${encodeURIComponent(projectId)}&from=${entryDate}&to=${formatDateKey(weekEnd)}&pageSize=50`,
        { token: employeeToken },
      )
      expect(listEntriesResponse.ok(), 'GET /api/staff/timesheets/time-entries should succeed').toBeTruthy()
      const listEntriesBody = (await listEntriesResponse.json()) as { items?: Array<Record<string, unknown>> }
      const savedEntry = listEntriesBody.items?.find((item) => String(item.date ?? '').slice(0, 10) === entryDate)
      expect(savedEntry, 'The edited grid cell should create a time entry for the selected day').toBeTruthy()
      entryId = String(savedEntry!.id ?? '')
      expect(savedEntry!.duration_minutes).toBe(150)
    } finally {
      if (entryId) {
        await deleteStaffEntityIfExists(request, employeeToken, 'staff/timesheets/time-entries', entryId)
      }
      if (projectId) {
        await deleteStaffEntityIfExists(request, adminToken, 'staff/timesheets/time-projects', projectId)
      }
    }
  })
})
