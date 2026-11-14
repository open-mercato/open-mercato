import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
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

type RecordLockSettings = Record<string, unknown>

const STOPPED_NOTE_NOT_SAVED = 'Timer stopped, but your note could not be saved to it.'

async function getSelfStaffMemberId(request: APIRequestContext, token: string) {
  const response = await apiRequest(request, 'GET', '/api/staff/team-members/self', { token })
  expect(response.ok(), 'GET /api/staff/team-members/self should succeed').toBeTruthy()
  const body = (await response.json()) as { member?: { id?: string } }
  const staffMemberId = body.member?.id ?? ''
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

async function findProjectEntry(
  request: APIRequestContext,
  token: string,
  staffMemberId: string,
  date: string,
  projectId: string,
) {
  const entries = await listEntriesForDate(request, token, staffMemberId, date)
  return entries.find((entry) => entry.time_project_id === projectId && entry.started_at) ?? null
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

async function readRecordLockSettings(request: APIRequestContext, token: string): Promise<RecordLockSettings> {
  const response = await apiRequest(request, 'GET', '/api/record_locks/settings', { token })
  expect(response.ok(), 'GET /api/record_locks/settings should succeed').toBeTruthy()
  const body = (await response.json()) as { settings?: RecordLockSettings }
  return body.settings ?? {}
}

async function writeRecordLockSettings(request: APIRequestContext, token: string, settings: RecordLockSettings) {
  const response = await apiRequest(request, 'POST', '/api/record_locks/settings', { token, data: settings })
  expect(response.ok(), 'POST /api/record_locks/settings should succeed').toBeTruthy()
}

async function saveNote(page: Page, note: string) {
  const noteInput = page.getByPlaceholder('What are you working on?')
  await expect(noteInput).toBeEnabled()
  await noteInput.fill(note)
  await noteInput.press('Enter')
}

/**
 * TC-STAFF-051: Running-timer note edited in two windows, then stopped, with
 * enterprise record locks on (#8236).
 *
 * One employee, two windows of the same session, the record-lock defaults
 * (optimistic, every resource, notify on conflict). Editing the running note in
 * window X, then Y, then X again used to leave a pending record-lock conflict
 * that blocked every later note save AND Stop in both windows until the lock
 * expired and the page was reloaded. The TimerBar now writes without opening a
 * record-lock editing session, and Stop never depends on the note save.
 *
 * Self-contained: creates the project + assignment, stops and deletes the entry,
 * and restores the record-lock settings it set.
 */
test.describe('TC-STAFF-051: Timer note edited in two windows with record locks on', () => {
  test.describe.configure({ timeout: 180_000 })

  async function setUp(request: APIRequestContext, label: string) {
    const stamp = Date.now()
    const today = new Date().toISOString().slice(0, 10)
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    const staffMemberId = await getSelfStaffMemberId(request, employeeToken)
    await stopActiveEntries(request, employeeToken, staffMemberId, today)

    const previousSettings = await readRecordLockSettings(request, superadminToken)
    await writeRecordLockSettings(request, superadminToken, {
      ...previousSettings,
      enabled: true,
      strategy: 'optimistic',
      enabledResources: ['*'],
      notifyOnConflict: true,
    })

    const customer = await createTestCustomer(request, adminToken)
    const projectName = `QA TC-STAFF-051 ${label} ${stamp}`
    const projectId = await createTimeProjectFixture(request, adminToken, {
      customerId: customer.id,
      name: projectName,
      code: `Q51${label.slice(0, 1)}-${stamp}`,
    })
    await assignEmployeeToProjectFixture(request, adminToken, projectId, staffMemberId)

    const cleanUp = async () => {
      await stopActiveEntries(request, employeeToken, staffMemberId, today).catch(() => {})
      const entry = await findProjectEntry(request, employeeToken, staffMemberId, today, projectId).catch(() => null)
      await deleteStaffEntityIfExists(request, adminToken, '/api/staff/timesheets/time-entries', entry?.id ?? null)
      await deleteStaffEntityIfExists(request, adminToken, '/api/staff/timesheets/time-projects', projectId)
      await customer.cleanup()
      await writeRecordLockSettings(request, superadminToken, previousSettings).catch(() => {})
    }

    return { stamp, today, employeeToken, staffMemberId, projectId, projectName, cleanUp }
  }

  async function startTimerInWindow(page: Page, projectName: string) {
    await login(page, 'employee')
    await page.goto('/backend/staff/timesheets')
    await expect(page.getByPlaceholder('What are you working on?')).toBeVisible()
    await page.getByRole('button', { name: /^Project$/ }).click()
    await page.getByRole('button', { name: new RegExp(projectName) }).click()
    await page.getByRole('button', { name: /start timer/i }).click()
    await expect(page.getByRole('button', { name: /stop timer/i })).toBeVisible({ timeout: 30_000 })
  }

  async function openSecondWindow(page: Page) {
    const second = await page.context().newPage()
    await second.goto('/backend/staff/timesheets')
    await expect(second.getByRole('button', { name: /stop timer/i })).toBeVisible({ timeout: 30_000 })
    return second
  }

  test('saves the X, Y, X note edits and stops the timer from window X', async ({ page, request }) => {
    const fixture = await setUp(request, 'XYX')
    const noteOf = async () =>
      (await findProjectEntry(request, fixture.employeeToken, fixture.staffMemberId, fixture.today, fixture.projectId))?.notes ?? null
    try {
      const windowX = page
      await startTimerInWindow(windowX, fixture.projectName)

      const firstX = `Window X first ${fixture.stamp}`
      await saveNote(windowX, firstX)
      await expect.poll(noteOf).toBe(firstX)

      const windowY = await openSecondWindow(windowX)
      await expect(windowY.getByPlaceholder('What are you working on?')).toHaveValue(firstX)
      const fromY = `Window Y ${fixture.stamp}`
      await saveNote(windowY, fromY)
      await expect.poll(noteOf).toBe(fromY)

      // Window X picks Y's note up through its own 30s refetch, as in the report.
      await expect(windowX.getByPlaceholder('What are you working on?')).toHaveValue(fromY, { timeout: 45_000 })
      const secondX = `Window X again ${fixture.stamp}`
      await saveNote(windowX, secondX)
      await expect.poll(noteOf, { timeout: 15_000 }).toBe(secondX)
      await expect(windowX.getByTestId('record-conflict-banner')).toHaveCount(0)

      await windowX.getByRole('button', { name: /stop timer/i }).click()
      await expect
        .poll(async () =>
          (await findProjectEntry(request, fixture.employeeToken, fixture.staffMemberId, fixture.today, fixture.projectId))?.ended_at ?? null,
        { timeout: 15_000 })
        .not.toBeNull()
      await expect(windowX.getByRole('button', { name: /start timer/i })).toBeVisible()
      expect(await noteOf()).toBe(secondX)
      await windowY.close()
    } finally {
      await fixture.cleanUp()
    }
  })

  test('stops the timer even when the note typed in the stale window cannot be saved', async ({ page, request }) => {
    const fixture = await setUp(request, 'Stale')
    const entryOf = () =>
      findProjectEntry(request, fixture.employeeToken, fixture.staffMemberId, fixture.today, fixture.projectId)
    try {
      const windowX = page
      await startTimerInWindow(windowX, fixture.projectName)
      const windowY = await openSecondWindow(windowX)

      // X has an unsaved draft before Y saves, so X's refetches keep the version
      // the draft was based on and X's note save is a genuine conflict.
      const draftX = `Draft in window X ${fixture.stamp}`
      await windowX.getByPlaceholder('What are you working on?').fill(draftX)
      const fromY = `Saved in window Y ${fixture.stamp}`
      await saveNote(windowY, fromY)
      await expect.poll(async () => (await entryOf())?.notes ?? null).toBe(fromY)

      await windowX.getByRole('button', { name: /stop timer/i }).click()
      await expect(windowX.getByText(STOPPED_NOTE_NOT_SAVED)).toBeVisible()
      await expect
        .poll(async () => (await entryOf())?.ended_at ?? null, { timeout: 15_000 })
        .not.toBeNull()
      await expect(windowX.getByPlaceholder('What are you working on?')).toHaveValue(draftX)
      await expect(windowX.getByRole('button', { name: /start timer/i })).toBeVisible()
      await expect(windowX.getByTestId('record-conflict-banner')).toHaveCount(0)
      expect((await entryOf())?.notes ?? null).toBe(fromY)
      await windowY.close()
    } finally {
      await fixture.cleanUp()
    }
  })
})
