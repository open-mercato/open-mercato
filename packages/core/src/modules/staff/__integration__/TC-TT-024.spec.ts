import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  assignEmployeeToProjectFixture,
  deleteStaffEntityIfExists,
} from '@open-mercato/core/helpers/integration/timesheetFixtures'
import { createTestTimeProject, type TestTimeProjectFixture } from './fixtures'

export const integrationMeta = {
  dependsOnModules: ['customers'],
}

/**
 * TC-TT-024 — TimeEntryDialog project mode (#6989).
 *
 * With the tenant setting `defaults.entryMode = project`, an employee logs time to
 * a project without picking a task, and the project field lists only the projects
 * the employee is assigned to. With the setting back at `task`, the dialog shows
 * the picked task's project read-only.
 *
 * The setting is tenant-global, so the spec reads it first and restores the exact
 * previous value in `finally`.
 */

const SETTINGS_PATH = '/api/staff/timesheets/settings'
const TIME_ENTRIES_PATH = '/api/staff/timesheets/time-entries'
const TASKS_PATH = '/api/staff/timesheets/tasks'

type SettingsBody = { defaults?: Record<string, unknown> } & Record<string, unknown>

async function readSettings(request: APIRequestContext, token: string): Promise<SettingsBody> {
  const response = await apiRequest(request, 'GET', SETTINGS_PATH, { token })
  expect(response.ok(), 'GET /api/staff/timesheets/settings should succeed').toBeTruthy()
  return (await response.json()) as SettingsBody
}

async function writeEntryMode(
  request: APIRequestContext,
  token: string,
  current: SettingsBody,
  entryMode: 'task' | 'project',
): Promise<void> {
  const response = await apiRequest(request, 'PUT', SETTINGS_PATH, {
    token,
    data: { ...current, defaults: { ...(current.defaults ?? {}), entryMode } },
  })
  expect(response.ok(), `PUT /api/staff/timesheets/settings (entryMode=${entryMode}) should succeed`).toBeTruthy()
}

async function readEmployeeStaffMemberId(request: APIRequestContext, token: string): Promise<string> {
  const response = await apiRequest(request, 'GET', '/api/staff/team-members/self', { token })
  expect(response.ok(), 'GET /api/staff/team-members/self should succeed').toBeTruthy()
  const body = (await response.json()) as { member?: { id?: string } }
  const id = body.member?.id ?? ''
  expect(id.length > 0, 'Employee must have a staff member profile').toBeTruthy()
  return id
}

async function openAddEntryDialog(page: Page): Promise<void> {
  await page.goto('/backend/staff/time-tracking/entries')
  await page.getByRole('button', { name: /^add entry$/i }).first().click()
  await expect(page.getByTestId('entry-dialog')).toBeVisible({ timeout: 30_000 })
}

test.describe('TC-TT-024: TimeEntryDialog project mode', () => {
  test('logs a project-only entry and lists only the projects the employee may log to', async ({ page, request }) => {
    test.setTimeout(120_000)

    const stamp = Date.now()
    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    const original = await readSettings(request, adminToken)
    let assigned: TestTimeProjectFixture | null = null
    let unassigned: TestTimeProjectFixture | null = null
    const entryIds: string[] = []

    try {
      const staffMemberId = await readEmployeeStaffMemberId(request, employeeToken)
      assigned = await createTestTimeProject(request, adminToken, {
        name: `QATT24 assigned ${stamp}`,
        code: `QA24A-${stamp}`,
      })
      unassigned = await createTestTimeProject(request, adminToken, {
        name: `QATT24 hidden ${stamp}`,
        code: `QA24H-${stamp}`,
      })
      await assignEmployeeToProjectFixture(request, adminToken, assigned.id, staffMemberId)
      await writeEntryMode(request, adminToken, original, 'project')

      await login(page, 'employee')
      await openAddEntryDialog(page)

      const projectField = page.getByTestId('entry-dialog').getByTestId('entry-dialog-project').getByRole('combobox')
      await expect(projectField).toBeVisible()

      await projectField.fill(`QATT24 hidden ${stamp}`)
      await expect(page.getByRole('option', { name: new RegExp(`QATT24 hidden ${stamp}`) })).toHaveCount(0)

      await projectField.fill(`QATT24 assigned ${stamp}`)
      await page.getByRole('option', { name: new RegExp(`QATT24 assigned ${stamp}`) }).first().click()

      await page.locator('#entry-dialog-duration').fill('1h 30m')
      await page.getByTestId('entry-dialog-save').click()
      await expect(page.getByTestId('entry-dialog')).toBeHidden({ timeout: 30_000 })

      const listResponse = await apiRequest(
        request,
        'GET',
        `${TIME_ENTRIES_PATH}?staffMemberId=${encodeURIComponent(staffMemberId)}&projectId=${encodeURIComponent(assigned.id)}&pageSize=50`,
        { token: employeeToken },
      )
      expect(listResponse.ok(), 'GET /api/staff/timesheets/time-entries should succeed').toBeTruthy()
      const items = ((await listResponse.json()) as { items?: Array<Record<string, unknown>> }).items ?? []
      const saved = items.find((item) => item.duration_minutes === 90 || item.durationMinutes === 90)
      expect(saved, 'The dialog should have written a 90-minute entry on the assigned project').toBeTruthy()
      entryIds.push(String(saved!.id))
      expect(saved!.task_id ?? saved!.taskId ?? null).toBeNull()
      expect(saved!.time_project_id ?? saved!.timeProjectId).toBe(assigned.id)

      await page.reload()
      await page.getByRole('row').filter({ hasText: `QATT24 assigned ${stamp}` }).first().click()
      const editDialog = page.getByTestId('entry-dialog')
      await expect(editDialog).toBeVisible({ timeout: 30_000 })
      await expect(editDialog.getByTestId('entry-dialog-project').getByRole('combobox')).toHaveValue(
        new RegExp(`QATT24 assigned ${stamp}`),
      )
      await page.locator('#entry-dialog-duration').fill('2h')
      await page.getByTestId('entry-dialog-save').click()
      await expect(editDialog).toBeHidden({ timeout: 30_000 })

      const reread = await apiRequest(
        request,
        'GET',
        `${TIME_ENTRIES_PATH}?ids=${encodeURIComponent(String(saved!.id))}&pageSize=1`,
        { token: employeeToken },
      )
      expect(reread.ok(), 'GET /api/staff/timesheets/time-entries?ids= should succeed').toBeTruthy()
      const updated = (((await reread.json()) as { items?: Array<Record<string, unknown>> }).items ?? [])[0]
      expect(updated?.duration_minutes ?? updated?.durationMinutes).toBe(120)
      expect(updated?.task_id ?? updated?.taskId ?? null).toBeNull()
      expect(updated?.time_project_id ?? updated?.timeProjectId).toBe(assigned.id)
    } finally {
      for (const id of entryIds) {
        await deleteStaffEntityIfExists(request, employeeToken, TIME_ENTRIES_PATH, id)
      }
      await writeEntryMode(request, adminToken, original, original.defaults?.entryMode === 'project' ? 'project' : 'task')
      if (assigned) await assigned.cleanup()
      if (unassigned) await unassigned.cleanup()
    }
  })

  test('shows the picked task project read-only in task mode', async ({ page, request }) => {
    test.setTimeout(120_000)

    const stamp = Date.now()
    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    const original = await readSettings(request, adminToken)
    let project: TestTimeProjectFixture | null = null
    let taskId: string | null = null

    try {
      const staffMemberId = await readEmployeeStaffMemberId(request, employeeToken)
      project = await createTestTimeProject(request, adminToken, {
        name: `QATT24 task mode ${stamp}`,
        code: `QA24T-${stamp}`,
      })
      await assignEmployeeToProjectFixture(request, adminToken, project.id, staffMemberId)
      const taskResponse = await apiRequest(request, 'POST', TASKS_PATH, {
        token: adminToken,
        data: { timeProjectId: project.id, title: `QATT24 task ${stamp}` },
      })
      expect(taskResponse.ok(), `POST /api/staff/timesheets/tasks should succeed: ${taskResponse.status()}`).toBeTruthy()
      taskId = String(((await taskResponse.json()) as { id?: string }).id ?? '')
      await writeEntryMode(request, adminToken, original, 'task')

      await login(page, 'employee')
      await openAddEntryDialog(page)

      const dialog = page.getByTestId('entry-dialog')
      await expect(dialog.getByTestId('entry-dialog-project')).toHaveCount(0)
      await dialog.getByTestId('entry-dialog-task').getByRole('combobox').first().fill(`QATT24 task ${stamp}`)
      await page.getByRole('option', { name: new RegExp(`QATT24 task ${stamp}`) }).first().click()

      await expect(dialog.getByTestId('entry-dialog-task-hint')).toContainText(`QATT24 task mode ${stamp}`)
    } finally {
      await writeEntryMode(request, adminToken, original, original.defaults?.entryMode === 'project' ? 'project' : 'task')
      if (taskId) await deleteStaffEntityIfExists(request, adminToken, TASKS_PATH, taskId)
      if (project) await project.cleanup()
    }
  })
})
