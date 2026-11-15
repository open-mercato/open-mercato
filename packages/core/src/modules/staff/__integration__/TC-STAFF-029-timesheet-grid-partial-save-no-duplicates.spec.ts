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
  const saveButton = page.getByRole('button', { name: /save changes/i })
  await expect(saveButton).toBeEnabled({ timeout: 15_000 })
  await saveButton.click()
  await expect(page.getByRole('alertdialog', { name: /save changes/i })).toBeVisible()
  await page.getByRole('button', { name: /^confirm$/i }).click()
  await expect(page.getByRole('alertdialog', { name: /save changes/i })).toBeHidden()
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

async function assignEmployee(
  request: APIRequestContext,
  token: string,
  projectId: string,
  staffMemberId: string,
  window: { start: Date; end?: Date },
): Promise<void> {
  const response = await apiRequest(request, 'POST', `/api/staff/timesheets/time-projects/${projectId}/employees`, {
    token,
    data: {
      staffMemberId,
      status: 'active',
      assignedStartDate: formatDateKey(window.start),
      ...(window.end ? { assignedEndDate: formatDateKey(window.end) } : {}),
    },
  })
  expect(response.ok(), `Assigning the employee to ${projectId} should succeed`).toBeTruthy()
}

async function showInGrid(request: APIRequestContext, token: string, projectId: string): Promise<void> {
  const response = await apiRequest(request, 'PATCH', `/api/staff/timesheets/my-projects/${projectId}`, {
    token,
    data: { showInGrid: true },
  })
  expect(response.ok(), 'PATCH /api/staff/timesheets/my-projects/{id} should enable grid visibility').toBeTruthy()
}

test.describe('TC-STAFF-029: Timesheets grid partial save never duplicates stored cells', () => {
  test('should keep one entry per saved cell when a Projects + tasks save is refused and retried', async ({ page, request }) => {
    test.setTimeout(120_000)

    const stamp = Date.now()
    const boundedName = `QA Grid Bounded ${stamp}`
    const openName = `QA Grid Open ${stamp}`
    const taskTitle = `QA Grid Task ${stamp}`
    const today = new Date()
    today.setHours(12, 0, 0, 0)
    const weekMonday = getMonday(addDays(today, 14))
    const pastGrace = weekMonday
    const openDay = addDays(weekMonday, 2)
    const boundedEnd = addDays(pastGrace, -15)

    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    let bounded: TestTimeProjectFixture | null = null
    let open: TestTimeProjectFixture | null = null
    let taskId: string | null = null
    let staffMemberId = ''

    try {
      const selfRes = await apiRequest(request, 'GET', '/api/staff/team-members/self', { token: employeeToken })
      expect(selfRes.ok(), 'GET /api/staff/team-members/self should succeed').toBeTruthy()
      const selfBody = (await selfRes.json()) as { member?: { id?: string } }
      staffMemberId = selfBody.member?.id ?? ''
      expect(staffMemberId.length > 0, 'Employee must have a staff member profile').toBeTruthy()

      bounded = await createTestTimeProject(request, adminToken, { name: boundedName, code: `QGB-${stamp}` })
      open = await createTestTimeProject(request, adminToken, {
        name: openName,
        code: `QGO-${stamp}`,
        customer: bounded.customer,
      })
      const taskResponse = await apiRequest(request, 'POST', '/api/staff/timesheets/tasks', {
        token: adminToken,
        data: { timeProjectId: bounded.id, title: taskTitle },
      })
      expect(taskResponse.ok(), 'POST /api/staff/timesheets/tasks should succeed').toBeTruthy()
      taskId = ((await taskResponse.json()) as { id?: string }).id ?? null

      await assignEmployee(request, adminToken, bounded.id, staffMemberId, { start: addDays(today, -20), end: boundedEnd })
      await assignEmployee(request, adminToken, open.id, staffMemberId, { start: addDays(today, -10) })
      await showInGrid(request, employeeToken, bounded.id)
      await showInGrid(request, employeeToken, open.id)

      await login(page, 'employee')
      await openGridWeek(page, today, pastGrace)
      await page.getByRole('radio', { name: 'Projects + tasks' }).click()
      await page.getByRole('combobox', { name: 'Add a task row' }).click()
      await page.getByRole('option', { name: `${boundedName} · ${taskTitle}` }).click()

      const openCell = page.getByRole('textbox', { name: `${openName} · ${formatDateKey(openDay)}`, exact: true })
      const taskCell = page.getByRole('textbox', {
        name: `${boundedName} · ${taskTitle} · ${formatDateKey(pastGrace)}`,
        exact: true,
      })
      await expect(openCell).toBeVisible({ timeout: 30_000 })
      await openCell.fill('1')
      await taskCell.fill('1')

      await saveGrid(page)
      await expect(
        page.getByText(OUTSIDE_ASSIGNMENT, { exact: true }).and(page.locator(':not([role="alert"])')),
      ).toBeVisible({ timeout: 15_000 })
      await expect(taskCell).toHaveAttribute('aria-invalid', 'true')
      await expect.poll(() => listEntryIds(request, employeeToken, staffMemberId, open!.id, openDay)).toHaveLength(1)

      await saveGrid(page)
      await expect(taskCell).toHaveAttribute('aria-invalid', 'true')
      await saveGrid(page)
      await expect(taskCell).toHaveAttribute('aria-invalid', 'true')
      expect(await listEntryIds(request, employeeToken, staffMemberId, open.id, openDay)).toHaveLength(1)

      await openGridWeek(page, today, pastGrace)
      await expect(
        page.getByRole('textbox', { name: `${openName} · ${formatDateKey(openDay)}`, exact: true }),
      ).toHaveValue('1', { timeout: 30_000 })
    } finally {
      if (staffMemberId) {
        for (const [project, day] of [[open, openDay], [bounded, pastGrace]] as const) {
          if (!project) continue
          const entryIds = await listEntryIds(request, adminToken, staffMemberId, project.id, day).catch(() => [])
          for (const entryId of entryIds) {
            await deleteStaffEntityIfExists(request, adminToken, '/api/staff/timesheets/time-entries', entryId)
          }
        }
      }
      await deleteStaffEntityIfExists(request, adminToken, '/api/staff/timesheets/tasks', taskId)
      if (open) await open.cleanup()
      if (bounded) await bounded.cleanup()
    }
  })
})
