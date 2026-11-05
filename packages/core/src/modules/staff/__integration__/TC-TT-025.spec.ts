import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  expectOperation,
  skipIfUndoTestsDisabled,
  undoByToken,
  undoOk,
} from '@open-mercato/core/helpers/integration/undoHarness'
import { createTestCustomer, type TestCustomerFixture } from './fixtures'

export const integrationMeta = {
  dependsOnModules: ['customers', 'audit_logs'],
}

/**
 * TC-TT-025 — Undo cannot reach past the closed-report lock (#7507).
 *
 * An entry a closed report has frozen refuses every forward write with 409
 * `time_entry_locked`. The audit-log undo of an earlier create, update or entry-tag
 * assignment must refuse the same way and change nothing, and must work again
 * once the report is unlocked.
 */

const PROJECTS_PATH = '/api/staff/timesheets/time-projects'
const ENTRIES_PATH = '/api/staff/timesheets/time-entries'
const REPORTS_PATH = '/api/staff/timesheets/reports'
const TAGS_PATH = '/api/staff/timesheets/tags'
const ENTRY_TAGS_PATH = '/api/staff/timesheets/tags/entry-assignments'
const SELF_MEMBER_PATH = '/api/staff/team-members/self'
const LOCKED_CODE = 'time_entry_locked'
const ENTRY_LOCKED_MESSAGE = 'This time entry is locked in a closed report and cannot be changed. Unlock the report first.'
const TAGS_LOCKED_MESSAGE = 'This time entry is locked in a closed report and its tags cannot be changed.'
const ENTRY_DATE = '2026-04-14'
const PERIOD_FROM = '2026-04-01'
const PERIOD_TO = '2026-04-30'
const PASSWORD = 'StrongSecret123!'

type EntryRow = { id?: string; duration_minutes?: number; durationMinutes?: number }

type World = {
  token: string
  customer: TestCustomerFixture | null
  projectId: string | null
  staffMemberId: string | null
  selfMemberCreated: boolean
  entryIds: string[]
  reportIds: string[]
  tagIds: string[]
}

async function ensureSelfStaffMemberId(
  request: APIRequestContext,
  token: string,
  displayName: string,
): Promise<{ id: string; created: boolean }> {
  const read = async (): Promise<string | null> => {
    const response = await apiRequest(request, 'GET', SELF_MEMBER_PATH, { token })
    if (!response.ok()) return null
    const body = await readJsonSafe<{ member?: { id?: string } | null }>(response)
    const id = body?.member?.id
    return typeof id === 'string' && id.length > 0 ? id : null
  }
  const existing = await read()
  if (existing) return { id: existing, created: false }
  const response = await apiRequest(request, 'POST', SELF_MEMBER_PATH, { token, data: { displayName } })
  expect(response.ok(), `POST ${SELF_MEMBER_PATH} should create the staff profile: ${response.status()}`).toBeTruthy()
  const created = await read()
  expect(created, 'The staff profile should be readable right after creation').toBeTruthy()
  return { id: created as string, created: true }
}

async function setUpProject(request: APIRequestContext, world: World, stamp: string): Promise<void> {
  const self = await ensureSelfStaffMemberId(request, world.token, `QATT25 Member ${stamp}`)
  world.staffMemberId = self.id
  world.selfMemberCreated = self.created
  world.customer = await createTestCustomer(request, world.token, { displayName: `QATT25 Customer ${stamp}` })
  const projectResponse = await apiRequest(request, 'POST', PROJECTS_PATH, {
    token: world.token,
    data: {
      name: `QATT25 Project ${stamp}`,
      code: `QT25-${stamp}`,
      customerId: world.customer.id,
      status: 'active',
      hourlyRate: 100,
      currencyCode: 'EUR',
      billableByDefault: true,
    },
  })
  expect(projectResponse.ok(), `POST ${PROJECTS_PATH} should create the project: ${projectResponse.status()}`).toBeTruthy()
  world.projectId = ((await readJsonSafe<{ id?: string }>(projectResponse))?.id ?? null) as string | null
  expect(world.projectId, 'The project create response should carry an id').toBeTruthy()
  const assignResponse = await apiRequest(request, 'POST', `${PROJECTS_PATH}/${world.projectId}/employees`, {
    token: world.token,
    data: { staffMemberId: world.staffMemberId, status: 'active', assignedStartDate: PERIOD_FROM },
  })
  expect(assignResponse.ok(), `Assigning the member to the project should succeed: ${assignResponse.status()}`).toBeTruthy()
}

async function createEntry(
  request: APIRequestContext,
  world: World,
  token: string,
  input: { durationMinutes: number; notes: string },
): Promise<{ id: string; undoToken: string }> {
  const response = await apiRequest(request, 'POST', ENTRIES_PATH, {
    token,
    data: {
      staffMemberId: world.staffMemberId,
      timeProjectId: world.projectId,
      date: ENTRY_DATE,
      durationMinutes: input.durationMinutes,
      source: 'manual',
      isBillable: true,
      notes: input.notes,
    },
  })
  expect(response.status(), `POST ${ENTRIES_PATH} should create the entry`).toBe(201)
  const operation = expectOperation(response, `create ${input.notes}`)
  const id = ((await readJsonSafe<{ id?: string }>(response))?.id ?? null) as string | null
  expect(id, 'The entry create response should carry an id').toBeTruthy()
  world.entryIds.push(id as string)
  return { id: id as string, undoToken: operation.undoToken }
}

async function updateEntryMinutes(
  request: APIRequestContext,
  token: string,
  entryId: string,
  durationMinutes: number,
): Promise<string> {
  const response = await apiRequest(request, 'PUT', ENTRIES_PATH, { token, data: { id: entryId, durationMinutes } })
  expect(response.ok(), `PUT ${ENTRIES_PATH} should update the entry: ${response.status()}`).toBeTruthy()
  return expectOperation(response, 'update entry').undoToken
}

async function readEntryMinutes(request: APIRequestContext, token: string, entryId: string): Promise<number | null> {
  const query = new URLSearchParams({ ids: entryId, from: PERIOD_FROM, to: PERIOD_TO })
  const response = await apiRequest(request, 'GET', `${ENTRIES_PATH}?${query.toString()}`, { token })
  expect(response.ok(), `GET ${ENTRIES_PATH} should succeed: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<{ items?: EntryRow[] }>(response)
  const row = body?.items?.find((item) => item.id === entryId)
  if (!row) return null
  return Number(row.duration_minutes ?? row.durationMinutes)
}

async function closeReportOverProject(request: APIRequestContext, world: World, title: string): Promise<string> {
  const response = await apiRequest(request, 'POST', REPORTS_PATH, {
    token: world.token,
    data: {
      customerId: world.customer?.id,
      title,
      periodKind: 'custom',
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      includeAlreadyReported: false,
      timeProjectIds: [world.projectId],
    },
  })
  expect(response.status(), `POST ${REPORTS_PATH} should create the report`).toBe(201)
  const reportId = ((await readJsonSafe<{ id?: string }>(response))?.id ?? null) as string | null
  expect(reportId, 'The report create response should carry an id').toBeTruthy()
  world.reportIds.push(reportId as string)
  const close = await apiRequest(request, 'POST', `${REPORTS_PATH}/${reportId}/close`, { token: world.token, data: {} })
  expect(close.ok(), `Closing the report should succeed: ${close.status()}`).toBeTruthy()
  return reportId as string
}

async function unlockReport(request: APIRequestContext, token: string, reportId: string, reason: string) {
  return apiRequest(request, 'POST', `${REPORTS_PATH}/${reportId}/unlock`, { token, data: { reason } })
}

async function expectUndoRefused(
  request: APIRequestContext,
  token: string,
  undoToken: string,
  expected: { message: string; reportId: string },
  context: string,
): Promise<void> {
  const response = await undoByToken(request, token, undoToken)
  const body = await readJsonSafe<{ code?: string; error?: string; lockedReportId?: string | null }>(response)
  expect(response.status(), `${context}: undo must be refused with 409, got ${JSON.stringify(body)}`).toBe(409)
  expect(body?.code, `${context}: refusal code`).toBe(LOCKED_CODE)
  expect(body?.error, `${context}: refusal message should be localized`).toBe(expected.message)
  expect(body?.lockedReportId, `${context}: refusal names the closing report`).toBe(expected.reportId)
}

async function cleanUp(request: APIRequestContext, world: World): Promise<void> {
  for (const reportId of world.reportIds) {
    await unlockReport(request, world.token, reportId, 'QATT25 cleanup').catch(() => {})
  }
  for (const reportId of world.reportIds) {
    await apiRequest(request, 'DELETE', `${REPORTS_PATH}?id=${encodeURIComponent(reportId)}`, { token: world.token }).catch(() => {})
  }
  for (const entryId of world.entryIds) {
    await apiRequest(request, 'DELETE', `${ENTRIES_PATH}?id=${encodeURIComponent(entryId)}`, { token: world.token }).catch(() => {})
  }
  for (const tagId of world.tagIds) {
    await apiRequest(request, 'DELETE', `${TAGS_PATH}?id=${encodeURIComponent(tagId)}`, { token: world.token }).catch(() => {})
  }
  if (world.projectId) {
    await apiRequest(request, 'DELETE', `${PROJECTS_PATH}?id=${encodeURIComponent(world.projectId)}`, { token: world.token }).catch(() => {})
  }
  if (world.customer) await world.customer.cleanup()
  if (world.selfMemberCreated && world.staffMemberId) {
    await apiRequest(request, 'DELETE', `/api/staff/team-members?id=${encodeURIComponent(world.staffMemberId)}`, {
      token: world.token,
    }).catch(() => {})
  }
}

function emptyWorld(token: string): World {
  return {
    token,
    customer: null,
    projectId: null,
    staffMemberId: null,
    selfMemberCreated: false,
    entryIds: [],
    reportIds: [],
    tagIds: [],
  }
}

test.describe('TC-TT-025: undo cannot reach past the closed-report lock (#7507)', () => {
  test.beforeEach(() => {
    skipIfUndoTestsDisabled()
  })

  test('create, update and tag-assignment undos are refused while the report is closed', async ({ request }) => {
    test.setTimeout(180_000)
    const stamp = String(Date.now()).slice(-9)
    const world = emptyWorld(await getAuthToken(request, 'admin'))

    try {
      await setUpProject(request, world, stamp)

      const edited = await createEntry(request, world, world.token, { durationMinutes: 60, notes: `QATT25 edited ${stamp}` })
      const updateUndoToken = await updateEntryMinutes(request, world.token, edited.id, 90)
      const created = await createEntry(request, world, world.token, { durationMinutes: 30, notes: `QATT25 created ${stamp}` })

      const tagResponse = await apiRequest(request, 'POST', TAGS_PATH, {
        token: world.token,
        data: { slug: `qatt25-${stamp}`, label: `QATT25 ${stamp}` },
      })
      expect(tagResponse.status(), `POST ${TAGS_PATH} should create the tag`).toBe(201)
      const tagId = ((await readJsonSafe<{ id?: string }>(tagResponse))?.id ?? null) as string | null
      expect(tagId, 'The tag create response should carry an id').toBeTruthy()
      world.tagIds.push(tagId as string)
      const assignResponse = await apiRequest(request, 'POST', ENTRY_TAGS_PATH, {
        token: world.token,
        data: { timeEntryId: edited.id, tagIds: [tagId] },
      })
      expect(assignResponse.ok(), `POST ${ENTRY_TAGS_PATH} should assign the tag: ${assignResponse.status()}`).toBeTruthy()
      const assignUndoToken = expectOperation(assignResponse, 'assign entry tag').undoToken

      const reportId = await closeReportOverProject(request, world, `QATT25 report ${stamp}`)

      await expectUndoRefused(request, world.token, updateUndoToken, { message: ENTRY_LOCKED_MESSAGE, reportId }, 'update undo')
      expect(await readEntryMinutes(request, world.token, edited.id), 'the billed minutes survive the refused undo').toBe(90)

      await expectUndoRefused(request, world.token, created.undoToken, { message: ENTRY_LOCKED_MESSAGE, reportId }, 'create undo')
      expect(await readEntryMinutes(request, world.token, created.id), 'the billed entry is not deleted').toBe(30)

      await expectUndoRefused(request, world.token, assignUndoToken, { message: TAGS_LOCKED_MESSAGE, reportId }, 'tag assign undo')

      const unlock = await unlockReport(request, world.token, reportId, 'QATT25: correcting the report')
      expect(unlock.ok(), `Unlocking the report should succeed: ${unlock.status()}`).toBeTruthy()

      await undoOk(request, world.token, assignUndoToken, 'tag assign undo once the report is unlocked')
      await undoOk(request, world.token, updateUndoToken, 'update undo once the report is unlocked')
      expect(await readEntryMinutes(request, world.token, edited.id), 'the unlocked undo restores the earlier minutes').toBe(60)
    } finally {
      await cleanUp(request, world)
    }
  })

  test('the audit log shows the translated lock refusal when an undo is blocked', async ({ page, request }) => {
    test.setTimeout(180_000)
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId, tenantId } = getTokenContext(adminToken)
    const stamp = randomUUID().slice(0, 8)
    const world = emptyWorld(adminToken)
    const fixture: { roleId: string | null; userId: string | null } = { roleId: null, userId: null }

    try {
      await setUpProject(request, world, stamp)
      const entry = await createEntry(request, world, adminToken, { durationMinutes: 45, notes: `QATT25 ui ${stamp}` })

      const email = `qa-tt-025-${stamp}@example.com`
      fixture.roleId = await createRoleFixture(request, superadminToken, { name: `qa-tt-025-${stamp}`, tenantId })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: fixture.roleId,
        features: [
          'staff.timesheets.view',
          'staff.timesheets.manage_own',
          'staff.timesheets.manage_all',
          'staff.timesheets.projects.view',
          'audit_logs.view_self',
          'audit_logs.undo_self',
        ],
        organizations: [organizationId],
      })
      fixture.userId = await createUserFixture(request, superadminToken, {
        email,
        password: PASSWORD,
        organizationId,
        roles: [fixture.roleId],
        name: 'QA TC-TT-025 Editor',
      })
      const editorToken = await getAuthToken(request, email, PASSWORD)
      await updateEntryMinutes(request, editorToken, entry.id, 75)

      await closeReportOverProject(request, world, `QATT25 ui report ${stamp}`)

      const loginForm = new URLSearchParams()
      loginForm.set('email', email)
      loginForm.set('password', PASSWORD)
      const loginResponse = await page.request.post('/api/auth/login', {
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        data: loginForm.toString(),
      })
      expect(loginResponse.ok(), 'the editor should log in').toBe(true)

      await page.goto('/backend/audit-logs')
      const updateRow = page.getByRole('row').filter({ hasText: 'Update time entry' }).first()
      await expect(updateRow).toBeVisible({ timeout: 20_000 })
      const undoResponse = page.waitForResponse((response) => (
        response.url().includes('/api/audit_logs/audit-logs/actions/undo') && response.request().method() === 'POST'
      ))
      await updateRow.getByRole('button', { name: 'Undo last action' }).click()
      expect((await undoResponse).status(), 'the UI undo must be refused').toBe(409)
      await expect(page.getByText(ENTRY_LOCKED_MESSAGE).first()).toBeVisible({ timeout: 10_000 })

      expect(await readEntryMinutes(request, adminToken, entry.id), 'the billed minutes survive the refused UI undo').toBe(75)
    } finally {
      await cleanUp(request, world)
      await deleteUserIfExists(request, superadminToken, fixture.userId)
      await deleteRoleIfExists(request, superadminToken, fixture.roleId)
    }
  })
})
