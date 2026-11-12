import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteStaffEntityIfExists } from '@open-mercato/core/helpers/integration/timesheetFixtures'
import { createTestTimeProject, type TestTimeProjectFixture } from './fixtures'

export const integrationMeta = {
  dependsOnModules: ['customers'],
}

const OUTSIDE_ASSIGNMENT = 'This date is outside your assignment to this project.'

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function getMonday(date: Date): Date {
  const day = date.getDay()
  const monday = addDays(date, day === 0 ? -6 : 1 - day)
  monday.setHours(0, 0, 0, 0)
  return monday
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

async function openGridWeek(page: Page, today: Date, target: Date): Promise<void> {
  await page.goto('/backend/staff/time-tracking/timesheet?period=week&view=grid')
  await expect(page.getByRole('table')).toBeVisible({ timeout: 30_000 })
  const weeks = Math.round((getMonday(target).getTime() - getMonday(today).getTime()) / (7 * 24 * 3600 * 1000))
  const step = page.getByRole('button', { name: weeks < 0 ? 'Previous period' : 'Next period' })
  for (let index = 0; index < Math.abs(weeks); index += 1) {
    await step.click()
  }
}

async function saveGrid(page: Page): Promise<void> {
  await page.getByRole('button', { name: /save changes/i }).click()
  await expect(page.getByRole('alertdialog', { name: /save changes/i })).toBeVisible()
  await page.getByRole('button', { name: /^confirm$/i }).click()
}

async function listEntryIds(
  request: APIRequestContext,
  token: string,
  staffMemberId: string,
  projectId: string,
  day: Date,
): Promise<string[]> {
  const query = new URLSearchParams({
    staffMemberId,
    projectId,
    from: formatDateKey(day),
    to: formatDateKey(day),
    pageSize: '50',
  })
  const response = await apiRequest(request, 'GET', `/api/staff/timesheets/time-entries?${query}`, { token })
  expect(response.ok(), 'GET /api/staff/timesheets/time-entries should succeed').toBeTruthy()
  const body = (await response.json()) as { items?: Array<Record<string, unknown>> }
  return (body.items ?? [])
    .filter((item) => String(item.date ?? '').slice(0, 10) === formatDateKey(day))
    .map((item) => String(item.id ?? ''))
}

test.describe('TC-STAFF-028: Timesheets grid marks the cell the server refused', () => {
  test('should name the reason, mark only the refused cell, and save the rest once it is cleared', async ({ page, request }) => {
    test.setTimeout(120_000)

    const stamp = Date.now()
    const projectName = `QA Grid Refused ${stamp}`
    const today = new Date()
    today.setHours(12, 0, 0, 0)
    const weekMonday = getMonday(addDays(today, -14))
    const beforeStart = weekMonday
    const assignmentStart = addDays(weekMonday, 1)
    const assignmentEnd = addDays(today, -3)

    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    let project: TestTimeProjectFixture | null = null
    let staffMemberId = ''

    try {
      const selfRes = await apiRequest(request, 'GET', '/api/staff/team-members/self', { token: employeeToken })
      expect(selfRes.ok(), 'GET /api/staff/team-members/self should succeed').toBeTruthy()
      const selfBody = (await selfRes.json()) as { member?: { id?: string } }
      staffMemberId = selfBody.member?.id ?? ''
      expect(staffMemberId.length > 0, 'Employee must have a staff member profile').toBeTruthy()

      project = await createTestTimeProject(request, adminToken, { name: projectName, code: `QGR-${stamp}` })
      const assignResponse = await apiRequest(
        request,
        'POST',
        `/api/staff/timesheets/time-projects/${project.id}/employees`,
        {
          token: adminToken,
          data: {
            staffMemberId,
            status: 'active',
            assignedStartDate: formatDateKey(assignmentStart),
            assignedEndDate: formatDateKey(assignmentEnd),
          },
        },
      )
      expect(assignResponse.ok(), 'Assigning the employee for a bounded window should succeed').toBeTruthy()
      const showInGridResponse = await apiRequest(
        request,
        'PATCH',
        `/api/staff/timesheets/my-projects/${project.id}`,
        { token: employeeToken, data: { showInGrid: true } },
      )
      expect(showInGridResponse.ok(), 'PATCH /api/staff/timesheets/my-projects/{id} should enable grid visibility').toBeTruthy()

      await login(page, 'employee')
      await openGridWeek(page, today, assignmentStart)

      const refusedCell = page.getByRole('textbox', { name: `${projectName} · ${formatDateKey(beforeStart)}`, exact: true })
      const allowedCell = page.getByRole('textbox', { name: `${projectName} · ${formatDateKey(assignmentStart)}`, exact: true })
      await expect(refusedCell).toBeVisible({ timeout: 30_000 })
      await refusedCell.fill('1')
      await allowedCell.fill('1')
      await saveGrid(page)

      await expect(
        page.getByText(OUTSIDE_ASSIGNMENT, { exact: true }).and(page.locator(':not([role="alert"])')),
      ).toBeVisible({ timeout: 15_000 })
      await expect(refusedCell).toHaveAttribute('aria-invalid', 'true')
      await expect(refusedCell).toHaveAttribute('title', OUTSIDE_ASSIGNMENT)
      await expect(allowedCell).toHaveAttribute('aria-invalid', 'false')
      expect(await listEntryIds(request, employeeToken, staffMemberId, project.id, beforeStart)).toHaveLength(0)
      expect(await listEntryIds(request, employeeToken, staffMemberId, project.id, assignmentStart)).toHaveLength(0)

      await refusedCell.fill('')
      await expect(refusedCell).toHaveAttribute('aria-invalid', 'false')
      await saveGrid(page)
      await expect(page.getByText('Timesheet saved.').first()).toBeVisible({ timeout: 15_000 })
      expect(await listEntryIds(request, employeeToken, staffMemberId, project.id, assignmentStart)).toHaveLength(1)
      expect(await listEntryIds(request, employeeToken, staffMemberId, project.id, beforeStart)).toHaveLength(0)
    } finally {
      if (project && staffMemberId) {
        for (const day of [beforeStart, assignmentStart]) {
          const entryIds = await listEntryIds(request, adminToken, staffMemberId, project.id, day).catch(() => [])
          for (const entryId of entryIds) {
            await deleteStaffEntityIfExists(request, adminToken, '/api/staff/timesheets/time-entries', entryId)
          }
        }
      }
      if (project) {
        await project.cleanup()
      }
    }
  })
})
