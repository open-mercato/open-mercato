import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createTestCustomer, type TestCustomerFixture } from './fixtures'

export const integrationMeta = {
  dependsOnModules: ['customers'],
}

/**
 * TC-TT-023 — An hour two closed reports quote (D-5 opt-in).
 *
 * Source: `.ai/specs/2026-08-12-time-tracking-consulting-suite.md`
 *   D-5 — an hour already frozen in an earlier report can be re-included in a later
 *   one by a deliberate opt-in, at its frozen values.
 *   § Data Models — `locked_report_id` is the denormalized fast path of
 *   `staff_time_report_entries`; close and unlock maintain both.
 *
 * What is pinned, through the real routes and the real database:
 *
 *   1. Both closed reports keep the shared hour on their sheet and in their export,
 *      and each sheet total equals the total the report stored when it closed.
 *   2. Unlocking the report that locked the hour first does not free it while the
 *      other closed report still quotes it — the lock moves to that report, and an
 *      edit of the entry is still refused, naming that report.
 *   3. The lock follows the remaining closed report back and forth, and the hour
 *      is freed only when the last closed report quoting it is unlocked.
 */

const PROJECTS_PATH = '/api/staff/timesheets/time-projects'
const ENTRIES_PATH = '/api/staff/timesheets/time-entries'
const REPORTS_PATH = '/api/staff/timesheets/reports'
const SELF_MEMBER_PATH = '/api/staff/team-members/self'

const ENTRY_DATE = '2026-03-10'
const PERIOD_FROM = '2026-03-01'
const PERIOD_TO = '2026-03-31'
const DURATION_MINUTES = 120
const HOURLY_RATE = 150
const EXPECTED_AMOUNT = 300

type SheetBody = {
  report?: { status?: string }
  totals?: { entryCount?: number; billableMinutes?: number; totalAmount?: number | null }
  rowCount?: number
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

async function createReport(
  request: APIRequestContext,
  token: string,
  input: { customerId: string; projectId: string; title: string; includeAlreadyReported: boolean },
): Promise<string> {
  const response = await apiRequest(request, 'POST', REPORTS_PATH, {
    token,
    data: {
      customerId: input.customerId,
      title: input.title,
      periodKind: 'custom',
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      includeAlreadyReported: input.includeAlreadyReported,
      timeProjectIds: [input.projectId],
    },
  })
  expect(response.status(), `POST ${REPORTS_PATH} should create the report "${input.title}"`).toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(typeof body?.id === 'string' && body.id.length > 0, 'The report create response should carry an id').toBeTruthy()
  return body?.id as string
}

async function updateReport(
  request: APIRequestContext,
  token: string,
  reportId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const response = await apiRequest(request, 'PUT', REPORTS_PATH, { token, data: { id: reportId, ...data } })
  expect(response.ok(), `PUT ${REPORTS_PATH} should update the draft report: ${response.status()}`).toBeTruthy()
}

async function closeReport(request: APIRequestContext, token: string, reportId: string) {
  return apiRequest(request, 'POST', `${REPORTS_PATH}/${reportId}/close`, { token, data: {} })
}

async function unlockReport(request: APIRequestContext, token: string, reportId: string, reason: string) {
  return apiRequest(request, 'POST', `${REPORTS_PATH}/${reportId}/unlock`, { token, data: { reason } })
}

async function readSheet(request: APIRequestContext, token: string, reportId: string): Promise<SheetBody> {
  const response = await apiRequest(request, 'GET', `${REPORTS_PATH}/${reportId}/sheet`, { token })
  expect(response.ok(), `GET report sheet should succeed: ${response.status()}`).toBeTruthy()
  return ((await readJsonSafe<SheetBody>(response)) ?? {}) as SheetBody
}

async function readCsvExport(request: APIRequestContext, token: string, reportId: string): Promise<string> {
  const response = await apiRequest(request, 'GET', `${REPORTS_PATH}/${reportId}/export?format=csv`, { token })
  expect(response.ok(), `GET report CSV export should succeed: ${response.status()}`).toBeTruthy()
  return response.text()
}

async function readStoredTotalAmount(request: APIRequestContext, token: string, reportId: string): Promise<number> {
  const response = await apiRequest(request, 'GET', `${REPORTS_PATH}?id=${encodeURIComponent(reportId)}`, { token })
  expect(response.ok(), `GET ${REPORTS_PATH} should succeed: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(response)
  const row = body?.items?.find((item) => item.id === reportId)
  expect(row, 'The report should be listed').toBeTruthy()
  return Number(row?.total_amount ?? row?.totalAmount)
}

/**
 * Asks the lock gate itself which report holds the entry. The entries list is
 * not used for this: close and unlock do not invalidate its response cache, so
 * with `ENABLE_CRUD_API_CACHE` on it can still show the previous owner. A write
 * that changes no billing field is refused with 409 naming the owning report
 * while the entry is locked, and succeeds once it is free.
 */
async function readLockOwner(
  request: APIRequestContext,
  token: string,
  input: { entryId: string; notes: string },
): Promise<string | null> {
  const response = await apiRequest(request, 'PUT', ENTRIES_PATH, {
    token,
    data: { id: input.entryId, notes: input.notes },
  })
  if (response.ok()) return null
  expect(response.status(), 'a locked entry refuses the write with 409').toBe(409)
  const body = await readJsonSafe<{ code?: string; lockedReportId?: string | null }>(response)
  expect(body?.code).toBe('time_entry_locked')
  expect(typeof body?.lockedReportId === 'string' && body.lockedReportId.length > 0).toBeTruthy()
  return body?.lockedReportId as string
}

test.describe('TC-TT-023: an hour two closed reports quote', () => {
  test('both closed reports keep the hour, and it stays locked until the last of them is unlocked', async ({ request }) => {
    test.setTimeout(180_000)

    const stamp = String(Date.now()).slice(-9)
    const entryNote = `QATT23 shared hour ${stamp}`
    const token = await getAuthToken(request, 'admin')

    let customer: TestCustomerFixture | null = null
    let projectId: string | null = null
    let entryId: string | null = null
    let selfMember: { id: string; created: boolean } | null = null
    const reportIds: string[] = []

    try {
      selfMember = await ensureSelfStaffMemberId(request, token, `QATT23 Leader ${stamp}`)
      const staffMemberId = selfMember.id
      customer = await createTestCustomer(request, token, { displayName: `QATT23 Customer ${stamp}` })

      const projectResponse = await apiRequest(request, 'POST', PROJECTS_PATH, {
        token,
        data: {
          name: `QATT23 Project ${stamp}`,
          code: `QT23-${stamp}`,
          customerId: customer.id,
          status: 'active',
          hourlyRate: HOURLY_RATE,
          currencyCode: 'EUR',
          billableByDefault: true,
        },
      })
      expect(projectResponse.ok(), `POST ${PROJECTS_PATH} should create the project: ${projectResponse.status()}`).toBeTruthy()
      projectId = ((await readJsonSafe<{ id?: string }>(projectResponse))?.id ?? null) as string | null
      expect(projectId, 'The project create response should carry an id').toBeTruthy()

      const assignResponse = await apiRequest(request, 'POST', `${PROJECTS_PATH}/${projectId}/employees`, {
        token,
        data: { staffMemberId, status: 'active', assignedStartDate: PERIOD_FROM },
      })
      expect(assignResponse.ok(), `Assigning the member to the project should succeed: ${assignResponse.status()}`).toBeTruthy()

      const entryResponse = await apiRequest(request, 'POST', ENTRIES_PATH, {
        token,
        data: {
          staffMemberId,
          timeProjectId: projectId,
          date: ENTRY_DATE,
          durationMinutes: DURATION_MINUTES,
          source: 'manual',
          isBillable: true,
          notes: entryNote,
        },
      })
      expect(entryResponse.status(), `POST ${ENTRIES_PATH} should create the entry`).toBe(201)
      entryId = ((await readJsonSafe<{ id?: string }>(entryResponse))?.id ?? null) as string | null
      expect(entryId, 'The entry create response should carry an id').toBeTruthy()
      const entryRef = { entryId: entryId as string, notes: entryNote }

      // The earlier report bills the hour and takes its lock.
      const earlierId = await createReport(request, token, {
        customerId: customer.id,
        projectId: projectId as string,
        title: `QATT23 earlier ${stamp}`,
        includeAlreadyReported: false,
      })
      reportIds.push(earlierId)
      const earlierClose = await closeReport(request, token, earlierId)
      expect(earlierClose.ok(), `Closing the earlier report should succeed: ${earlierClose.status()}`).toBeTruthy()
      expect(await readLockOwner(request, token, entryRef)).toBe(earlierId)

      // The later report deliberately re-includes the already billed hour (D-5).
      const laterId = await createReport(request, token, {
        customerId: customer.id,
        projectId: projectId as string,
        title: `QATT23 later ${stamp}`,
        includeAlreadyReported: true,
      })
      reportIds.push(laterId)
      const laterClose = await closeReport(request, token, laterId)
      expect(laterClose.ok(), `Closing the later report should succeed: ${laterClose.status()}`).toBeTruthy()
      expect(await readLockOwner(request, token, entryRef), 'the earlier report keeps the lock').toBe(earlierId)

      // 1. Each closed report renders what it froze, and agrees with the total it stored.
      for (const reportId of [earlierId, laterId]) {
        const sheet = await readSheet(request, token, reportId)
        expect(sheet.report?.status).toBe('closed')
        expect(sheet.totals?.entryCount, 'a closed report keeps the hour it froze on its sheet').toBe(1)
        expect(sheet.totals?.billableMinutes).toBe(DURATION_MINUTES)
        expect(sheet.totals?.totalAmount).toBe(EXPECTED_AMOUNT)
        expect(sheet.rowCount).toBe(1)
        expect(await readStoredTotalAmount(request, token, reportId)).toBe(sheet.totals?.totalAmount)
        expect(await readCsvExport(request, token, reportId), 'the export carries the frozen hour').toContain(entryNote)
      }

      // 2. Unlocking the report that locked the hour first must not free it.
      const earlierUnlock = await unlockReport(request, token, earlierId, 'QATT23: correcting the earlier report')
      expect(earlierUnlock.ok(), `Unlocking the earlier report should succeed: ${earlierUnlock.status()}`).toBeTruthy()
      const earlierUnlockBody = await readJsonSafe<{ status?: string; unlockedEntryCount?: number }>(earlierUnlock)
      expect(earlierUnlockBody?.status).toBe('draft')
      expect(earlierUnlockBody?.unlockedEntryCount, 'no hour became editable').toBe(0)
      expect(
        await readLockOwner(request, token, entryRef),
        'the lock moves to the closed report that still quotes the hour',
      ).toBe(laterId)

      const refusedEdit = await apiRequest(request, 'PUT', ENTRIES_PATH, {
        token,
        data: { id: entryId, durationMinutes: DURATION_MINUTES + 60 },
      })
      expect(refusedEdit.status(), 'an hour a closed report quotes stays read-only').toBe(409)
      expect((await readJsonSafe<{ code?: string }>(refusedEdit))?.code).toBe('time_entry_locked')

      const laterSheetAfterUnlock = await readSheet(request, token, laterId)
      expect(laterSheetAfterUnlock.totals?.entryCount).toBe(1)
      expect(laterSheetAfterUnlock.totals?.totalAmount).toBe(EXPECTED_AMOUNT)

      // 3. Re-closing the earlier report with the opt-in quotes the hour again; the lock
      //    then follows whichever closed report remains.
      await updateReport(request, token, earlierId, { includeAlreadyReported: true })
      const earlierReclose = await closeReport(request, token, earlierId)
      expect(earlierReclose.ok(), `Re-closing the earlier report should succeed: ${earlierReclose.status()}`).toBeTruthy()
      expect(await readLockOwner(request, token, entryRef)).toBe(laterId)
      for (const reportId of [earlierId, laterId]) {
        const sheet = await readSheet(request, token, reportId)
        expect(sheet.totals?.entryCount).toBe(1)
        expect(sheet.totals?.totalAmount).toBe(EXPECTED_AMOUNT)
      }

      const laterUnlock = await unlockReport(request, token, laterId, 'QATT23: correcting the later report')
      expect(laterUnlock.ok(), `Unlocking the later report should succeed: ${laterUnlock.status()}`).toBeTruthy()
      expect((await readJsonSafe<{ unlockedEntryCount?: number }>(laterUnlock))?.unlockedEntryCount).toBe(0)
      expect(await readLockOwner(request, token, entryRef)).toBe(earlierId)

      const lastUnlock = await unlockReport(request, token, earlierId, 'QATT23: releasing the hour')
      expect(lastUnlock.ok(), `Unlocking the last closed report should succeed: ${lastUnlock.status()}`).toBeTruthy()
      expect((await readJsonSafe<{ unlockedEntryCount?: number }>(lastUnlock))?.unlockedEntryCount).toBe(1)
      expect(await readLockOwner(request, token, entryRef), 'no closed report quotes the hour any more').toBeNull()

      const allowedEdit = await apiRequest(request, 'PUT', ENTRIES_PATH, {
        token,
        data: { id: entryId, durationMinutes: DURATION_MINUTES + 60 },
      })
      expect(allowedEdit.ok(), `A freed hour should be editable again: ${allowedEdit.status()}`).toBeTruthy()
    } finally {
      for (const reportId of reportIds) {
        await unlockReport(request, token, reportId, 'QATT23 cleanup').catch(() => {})
      }
      for (const reportId of reportIds) {
        await apiRequest(request, 'DELETE', `${REPORTS_PATH}?id=${encodeURIComponent(reportId)}`, { token }).catch(() => {})
      }
      if (entryId) {
        await apiRequest(request, 'DELETE', `${ENTRIES_PATH}?id=${encodeURIComponent(entryId)}`, { token }).catch(() => {})
      }
      if (projectId) {
        await apiRequest(request, 'DELETE', `${PROJECTS_PATH}?id=${encodeURIComponent(projectId)}`, { token }).catch(() => {})
      }
      if (customer) await customer.cleanup()
      if (selfMember?.created) {
        await apiRequest(request, 'DELETE', `/api/staff/team-members?id=${encodeURIComponent(selfMember.id)}`, { token }).catch(
          () => {},
        )
      }
    }
  })
})
