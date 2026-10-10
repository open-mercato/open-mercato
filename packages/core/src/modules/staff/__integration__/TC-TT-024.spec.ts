import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
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
 * Covers the spec's five integration cases: a project-only entry created and
 * re-saved through the dialog, project access scoping, the task-mode read-only
 * project line, project-scoped tasks, and the settings page control.
 *
 * The setting is tenant-global, so every case reads it first and restores the
 * exact previous value in `finally`. The employee's staff profile is created
 * through the self endpoint when the tenant has none (no example data), and
 * removed afterwards only when this spec created it.
 */

const SETTINGS_PATH = '/api/staff/timesheets/settings'
const TIME_ENTRIES_PATH = '/api/staff/timesheets/time-entries'
const TASKS_PATH = '/api/staff/timesheets/tasks'
const SELF_MEMBER_PATH = '/api/staff/team-members/self'
const TEAM_MEMBERS_PATH = '/api/staff/team-members'

type SettingsBody = { defaults?: Record<string, unknown> } & Record<string, unknown>
type SelfStaffMember = { id: string; created: boolean }
type EntryRow = Record<string, unknown>

async function readSettings(request: APIRequestContext, token: string): Promise<SettingsBody> {
  const response = await apiRequest(request, 'GET', SETTINGS_PATH, { token })
  expect(response.ok(), 'GET /api/staff/timesheets/settings should succeed').toBeTruthy()
  return (await response.json()) as SettingsBody
}

async function putEntryMode(
  request: APIRequestContext,
  token: string,
  current: SettingsBody,
  entryMode: 'task' | 'project',
): Promise<boolean> {
  const response = await apiRequest(request, 'PUT', SETTINGS_PATH, {
    token,
    data: { ...current, defaults: { ...(current.defaults ?? {}), entryMode } },
  })
  return response.ok()
}

async function writeEntryMode(
  request: APIRequestContext,
  token: string,
  current: SettingsBody,
  entryMode: 'task' | 'project',
): Promise<void> {
  const ok = await putEntryMode(request, token, current, entryMode)
  expect(ok, `PUT /api/staff/timesheets/settings (entryMode=${entryMode}) should succeed`).toBeTruthy()
}

/** Teardown variant: never throws, so the cleanup steps after it still run. */
async function restoreEntryMode(request: APIRequestContext, token: string, original: SettingsBody): Promise<void> {
  const entryMode = original.defaults?.entryMode === 'project' ? 'project' : 'task'
  await putEntryMode(request, token, original, entryMode).catch(() => false)
}

async function readSelfStaffMemberId(request: APIRequestContext, token: string): Promise<string | null> {
  const response = await apiRequest(request, 'GET', SELF_MEMBER_PATH, { token })
  expect(response.ok(), `GET ${SELF_MEMBER_PATH} should succeed: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<{ member?: { id?: string } | null }>(response)
  const id = body?.member?.id
  return typeof id === 'string' && id.length > 0 ? id : null
}

async function ensureSelfStaffMember(
  request: APIRequestContext,
  token: string,
  displayName: string,
): Promise<SelfStaffMember> {
  const existing = await readSelfStaffMemberId(request, token)
  if (existing) return { id: existing, created: false }
  const response = await apiRequest(request, 'POST', SELF_MEMBER_PATH, { token, data: { displayName } })
  expect(response.ok(), `POST ${SELF_MEMBER_PATH} should create the staff profile: ${response.status()}`).toBeTruthy()
  const created = await readSelfStaffMemberId(request, token)
  expect(created, 'The staff profile should be readable right after creation').toBeTruthy()
  return { id: created as string, created: true }
}

async function removeSelfStaffMemberIfCreated(
  request: APIRequestContext,
  adminToken: string,
  member: SelfStaffMember | null,
): Promise<void> {
  if (!member?.created) return
  await deleteStaffEntityIfExists(request, adminToken, TEAM_MEMBERS_PATH, member.id)
}

async function listEntries(
  request: APIRequestContext,
  token: string,
  staffMemberId: string,
  projectId: string,
): Promise<EntryRow[]> {
  const response = await apiRequest(
    request,
    'GET',
    `${TIME_ENTRIES_PATH}?staffMemberId=${encodeURIComponent(staffMemberId)}&projectId=${encodeURIComponent(projectId)}&pageSize=50`,
    { token },
  )
  expect(response.ok(), 'GET /api/staff/timesheets/time-entries should succeed').toBeTruthy()
  return ((await response.json()) as { items?: EntryRow[] }).items ?? []
}

/** Deletes every entry the employee has on the given projects, including any a failed assertion left behind. */
async function deleteEntriesOnProjects(
  request: APIRequestContext,
  token: string,
  staffMemberId: string | null,
  projectIds: Array<string | null | undefined>,
): Promise<void> {
  if (!staffMemberId) return
  for (const projectId of projectIds) {
    if (!projectId) continue
    const rows = await listEntries(request, token, staffMemberId, projectId).catch(() => [] as EntryRow[])
    for (const row of rows) {
      await deleteStaffEntityIfExists(request, token, TIME_ENTRIES_PATH, String(row.id))
    }
  }
}

async function createTask(
  request: APIRequestContext,
  token: string,
  timeProjectId: string,
  title: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', TASKS_PATH, { token, data: { timeProjectId, title } })
  expect(response.ok(), `POST /api/staff/timesheets/tasks should succeed: ${response.status()}`).toBeTruthy()
  const id = String(((await response.json()) as { id?: string }).id ?? '')
  expect(id.length > 0, 'The created task should carry an id').toBeTruthy()
  return id
}

function minutesOf(row: EntryRow | undefined): unknown {
  return row?.duration_minutes ?? row?.durationMinutes
}

function taskIdOf(row: EntryRow | undefined): unknown {
  return row?.task_id ?? row?.taskId ?? null
}

function projectIdOf(row: EntryRow | undefined): unknown {
  return row?.time_project_id ?? row?.timeProjectId
}

/**
 * The settings page reloads its draft when the organization scope settles, which
 * can land after the first load. Interacting before that reload loses the edit,
 * so wait until the page has stopped fetching its settings.
 */
async function waitForSettingsPageToSettle(settingsResponses: () => number[]): Promise<void> {
  await expect
    .poll(
      () => {
        const times = settingsResponses()
        return times.length > 0 && Date.now() - times[times.length - 1] > 1_500
      },
      { timeout: 30_000, intervals: [250] },
    )
    .toBe(true)
}

async function openAddEntryDialog(page: Page): Promise<void> {
  await page.goto('/backend/staff/time-tracking/entries')
  await page.getByRole('button', { name: /^add entry$/i }).first().click()
  await expect(page.getByTestId('entry-dialog')).toBeVisible({ timeout: 30_000 })
}

function projectCombobox(page: Page) {
  return page.getByTestId('entry-dialog').getByTestId('entry-dialog-project').getByRole('combobox')
}

function taskSection(page: Page) {
  return page.getByTestId('entry-dialog').getByTestId('entry-dialog-task')
}

function taskCombobox(page: Page) {
  return taskSection(page).getByRole('combobox').first()
}

async function pickProject(page: Page, name: string): Promise<void> {
  await projectCombobox(page).fill(name)
  await page.getByRole('option', { name: new RegExp(name) }).first().click()
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
    let selfMember: SelfStaffMember | null = null

    try {
      selfMember = await ensureSelfStaffMember(request, employeeToken, `QATT24 Employee ${stamp}`)
      const staffMemberId = selfMember.id
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
      await expect(projectCombobox(page)).toBeVisible()

      await projectCombobox(page).fill(`${stamp}`)
      await expect(page.getByRole('option', { name: new RegExp(`QATT24 assigned ${stamp}`) }).first()).toBeVisible({
        timeout: 15_000,
      })
      await expect(page.getByRole('option', { name: new RegExp(`QATT24 hidden ${stamp}`) })).toHaveCount(0)
      await page.getByRole('option', { name: new RegExp(`QATT24 assigned ${stamp}`) }).first().click()

      await page.locator('#entry-dialog-duration').fill('1h 30m')
      await page.getByTestId('entry-dialog-save').click()
      await expect(page.getByTestId('entry-dialog')).toBeHidden({ timeout: 30_000 })

      const items = await listEntries(request, employeeToken, staffMemberId, assigned.id)
      const saved = items.find((item) => minutesOf(item) === 90)
      expect(saved, 'The dialog should have written a 90-minute entry on the assigned project').toBeTruthy()
      expect(taskIdOf(saved)).toBeNull()
      expect(projectIdOf(saved)).toBe(assigned.id)

      await page.reload()
      await page.getByRole('row').filter({ hasText: `QATT24 assigned ${stamp}` }).first().click()
      const editDialog = page.getByTestId('entry-dialog')
      await expect(editDialog).toBeVisible({ timeout: 30_000 })
      await expect(projectCombobox(page)).toHaveValue(new RegExp(`QATT24 assigned ${stamp}`))
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
      const updated = (((await reread.json()) as { items?: EntryRow[] }).items ?? [])[0]
      expect(minutesOf(updated)).toBe(120)
      expect(taskIdOf(updated)).toBeNull()
      expect(projectIdOf(updated)).toBe(assigned.id)
    } finally {
      await deleteEntriesOnProjects(request, employeeToken, selfMember?.id ?? null, [assigned?.id])
      await restoreEntryMode(request, adminToken, original)
      if (assigned) await assigned.cleanup()
      if (unassigned) await unassigned.cleanup()
      await removeSelfStaffMemberIfCreated(request, adminToken, selfMember)
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
    let selfMember: SelfStaffMember | null = null

    try {
      selfMember = await ensureSelfStaffMember(request, employeeToken, `QATT24 Employee ${stamp}`)
      project = await createTestTimeProject(request, adminToken, {
        name: `QATT24 task mode ${stamp}`,
        code: `QA24T-${stamp}`,
      })
      await assignEmployeeToProjectFixture(request, adminToken, project.id, selfMember.id)
      taskId = await createTask(request, adminToken, project.id, `QATT24 task ${stamp}`)
      await writeEntryMode(request, adminToken, original, 'task')

      await login(page, 'employee')
      await openAddEntryDialog(page)

      const dialog = page.getByTestId('entry-dialog')
      await expect(dialog.getByTestId('entry-dialog-project')).toHaveCount(0)
      await taskCombobox(page).fill(`QATT24 task ${stamp}`)
      await page.getByRole('option', { name: new RegExp(`QATT24 task ${stamp}`) }).first().click()

      await expect(dialog.getByTestId('entry-dialog-task-hint')).toContainText(`QATT24 task mode ${stamp}`)
    } finally {
      await restoreEntryMode(request, adminToken, original)
      if (taskId) await deleteStaffEntityIfExists(request, adminToken, TASKS_PATH, taskId)
      if (project) await project.cleanup()
      await removeSelfStaffMemberIfCreated(request, adminToken, selfMember)
    }
  })

  test('offers and saves only the chosen project tasks, and clears the task when the project changes', async ({
    page,
    request,
  }) => {
    test.setTimeout(150_000)

    const stamp = Date.now()
    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    const original = await readSettings(request, adminToken)
    let projectA: TestTimeProjectFixture | null = null
    let projectB: TestTimeProjectFixture | null = null
    const taskIds: string[] = []
    let selfMember: SelfStaffMember | null = null
    const taskATitle = `QATT24 scoped A ${stamp}`
    const taskBTitle = `QATT24 scoped B ${stamp}`

    try {
      selfMember = await ensureSelfStaffMember(request, employeeToken, `QATT24 Employee ${stamp}`)
      const staffMemberId = selfMember.id
      projectA = await createTestTimeProject(request, adminToken, { name: `QATT24 proj A ${stamp}`, code: `QA24PA-${stamp}` })
      projectB = await createTestTimeProject(request, adminToken, { name: `QATT24 proj B ${stamp}`, code: `QA24PB-${stamp}` })
      await assignEmployeeToProjectFixture(request, adminToken, projectA.id, staffMemberId)
      await assignEmployeeToProjectFixture(request, adminToken, projectB.id, staffMemberId)
      const taskAId = await createTask(request, adminToken, projectA.id, taskATitle)
      taskIds.push(taskAId)
      taskIds.push(await createTask(request, adminToken, projectB.id, taskBTitle))
      await writeEntryMode(request, adminToken, original, 'project')

      await login(page, 'employee')
      await openAddEntryDialog(page)
      const dialog = page.getByTestId('entry-dialog')
      await expect(dialog.getByTestId('entry-dialog-task-hint')).toContainText('Pick a project first')

      await pickProject(page, `QATT24 proj A ${stamp}`)
      const scopedSearch = page.waitForRequest(
        (req) =>
          req.url().includes(TASKS_PATH) &&
          req.url().includes(`timeProjectId=${projectA!.id}`) &&
          req.url().includes(`q=${encodeURIComponent(String(stamp))}`),
        { timeout: 15_000 },
      )
      await taskCombobox(page).fill(String(stamp))
      await scopedSearch
      await expect(page.getByRole('option', { name: new RegExp(taskATitle) }).first()).toBeVisible({ timeout: 15_000 })
      await expect(page.getByRole('option', { name: new RegExp(taskBTitle) })).toHaveCount(0)
      await page.getByRole('option', { name: new RegExp(taskATitle) }).first().click()
      await expect(taskSection(page)).toContainText(taskATitle)

      await page.locator('#entry-dialog-duration').fill('45m')
      await page.getByTestId('entry-dialog-save').click()
      await expect(dialog).toBeHidden({ timeout: 30_000 })

      const saved = (await listEntries(request, employeeToken, staffMemberId, projectA.id)).find(
        (item) => minutesOf(item) === 45,
      )
      expect(saved, 'The dialog should have written a 45-minute entry on project A').toBeTruthy()
      expect(taskIdOf(saved)).toBe(taskAId)
      expect(projectIdOf(saved)).toBe(projectA.id)

      await openAddEntryDialog(page)
      await pickProject(page, `QATT24 proj A ${stamp}`)
      await taskCombobox(page).fill(String(stamp))
      await page.getByRole('option', { name: new RegExp(taskATitle) }).first().click()
      await expect(taskSection(page)).toContainText(taskATitle)

      await pickProject(page, `QATT24 proj B ${stamp}`)
      await expect(taskSection(page)).not.toContainText(taskATitle)
      await expect(taskCombobox(page)).toBeVisible()
      await expect(dialog.getByTestId('entry-dialog-task-hint')).toContainText('leave empty to log the time to the project')
    } finally {
      await deleteEntriesOnProjects(request, employeeToken, selfMember?.id ?? null, [projectA?.id, projectB?.id])
      await restoreEntryMode(request, adminToken, original)
      for (const id of taskIds) await deleteStaffEntityIfExists(request, adminToken, TASKS_PATH, id)
      if (projectA) await projectA.cleanup()
      if (projectB) await projectB.cleanup()
      await removeSelfStaffMemberIfCreated(request, adminToken, selfMember)
    }
  })

  test('the settings page entry-mode control persists and drives the dialog', async ({ page, request }) => {
    test.setTimeout(120_000)

    const adminToken = await getAuthToken(request, 'admin')
    const original = await readSettings(request, adminToken)
    let adminMember: SelfStaffMember | null = null

    try {
      adminMember = await ensureSelfStaffMember(request, adminToken, `QATT24 Admin ${Date.now()}`)
      await writeEntryMode(request, adminToken, original, 'task')

      await login(page, 'admin')
      const settingsLoads: number[] = []
      page.on('response', (response) => {
        if (response.request().method() === 'GET' && new URL(response.url()).pathname === SETTINGS_PATH) {
          settingsLoads.push(Date.now())
        }
      })
      await page.goto('/backend/staff/time-tracking/settings')
      const control = page.getByTestId('time-tracking-settings-entry-mode')
      await expect(control.getByRole('radio', { name: 'a task' })).toBeChecked({ timeout: 30_000 })
      await waitForSettingsPageToSettle(() => settingsLoads)
      await control.getByRole('radio', { name: 'a project' }).click()
      await expect(control.getByRole('radio', { name: 'a project' })).toBeChecked()
      await expect(page.getByTestId('save-settings')).toBeEnabled()
      const saved = page.waitForResponse(
        (response) => response.url().includes(SETTINGS_PATH) && response.request().method() === 'PUT',
      )
      await page.getByTestId('save-settings').click()
      expect((await saved).ok(), 'Saving the settings page should succeed').toBeTruthy()

      await page.reload()
      await expect(
        page.getByTestId('time-tracking-settings-entry-mode').getByRole('radio', { name: 'a project' }),
      ).toBeChecked({ timeout: 30_000 })

      const reread = await readSettings(request, adminToken)
      expect(reread.defaults?.entryMode).toBe('project')

      await openAddEntryDialog(page)
      await expect(projectCombobox(page)).toBeVisible()
    } finally {
      await restoreEntryMode(request, adminToken, original)
      await removeSelfStaffMemberIfCreated(request, adminToken, adminMember)
    }
  })
})
