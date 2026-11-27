import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  assignEmployeeToProjectFixture,
  createTimeProjectFixture,
  deleteStaffEntityIfExists,
} from '@open-mercato/core/helpers/integration/timesheetFixtures'
import { createTestCustomer } from './fixtures'

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

async function listRunningEntries(request: APIRequestContext, token: string, staffMemberId: string) {
  const response = await apiRequest(
    request,
    'GET',
    `/api/staff/timesheets/time-entries?staffMemberId=${encodeURIComponent(staffMemberId)}&running=true&pageSize=50`,
    { token },
  )
  expect(response.ok(), 'GET ...?running=true should succeed').toBeTruthy()
  const body = (await response.json()) as { items?: TimeEntryListItem[] }
  return body.items ?? []
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
 * TC-STAFF-030: The `running=true` time-entries lookup actually returns the open timer
 *
 * `useActiveTimesheetTimer` — and therefore the TimerBar Start/Stop control, the
 * sidebar indicator and the dashboard time-reporting widget — resolves the active
 * timer solely through `?running=true`. Issue #3717 introduced that filter so an
 * overnight timer stays controllable after the date rolls over.
 *
 * The filter was built as `{ started_at: { $ne: null }, ended_at: null }`, which the
 * query engine renders as `started_at != NULL AND ended_at = NULL`. Both are UNKNOWN
 * in SQL's three-valued logic, so the lookup matched **zero rows unconditionally** —
 * no running timer was ever visible and the Stop button never appeared. The existing
 * unit test asserted the filter map's shape, so it stayed green throughout.
 *
 * This spec executes the query against a real running timer, which is the only way
 * that class of defect surfaces. It covers both branches: the entry must be present
 * while running and absent once stopped — and it reads the lookup once before
 * starting, so the assertions hold against an already-warmed cache key rather than
 * only a cold read.
 *
 * Self-contained: creates project + entry via the API, cleans up in `finally`.
 */
test.describe('TC-STAFF-030: running=true returns the open timer', () => {
  test('should list a running entry and drop it once stopped', async ({ request }) => {
    const stamp = Date.now()
    const today = new Date().toISOString().slice(0, 10)

    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    const staffMemberId = await getSelfStaffMemberId(request, employeeToken)

    await stopActiveEntries(request, employeeToken, staffMemberId, today)

    const customer = await createTestCustomer(request, adminToken)
    const projectId = await createTimeProjectFixture(request, adminToken, {
      customerId: customer.id,
      name: `QA Running Lookup ${stamp}`,
      code: `QARL-${stamp}`,
    })
    let entryId: string | null = null

    try {
      await assignEmployeeToProjectFixture(request, adminToken, projectId, staffMemberId)

      // Nothing is running yet. This read also warms the `running=true` cache key,
      // which is deliberate: the UI polls it on page load before the user ever
      // clicks Start, so the post-start read below must survive a warmed key.
      const beforeStart = await listRunningEntries(request, employeeToken, staffMemberId)
      expect(beforeStart, 'No timer should be running before the test starts one').toHaveLength(0)

      // Start through the atomic create-and-start endpoint (#3311) — the same
      // one `startTimerEntry` / TimerBar calls. Deliberately NOT the legacy
      // `POST /{id}/timer-start`: that route mutates the entry outside the
      // command bus and invalidates no cache, so a key warmed before the start
      // keeps reporting "not running" and this spec would fail for a reason
      // unrelated to the filter it exists to pin. That gap is its own follow-up.
      const startResponse = await apiRequest(
        request,
        'POST',
        '/api/staff/timesheets/time-entries/start-timer',
        {
          token: employeeToken,
          data: { staffMemberId, timeProjectId: projectId, date: today, notes: null },
        },
      )
      expect(startResponse.ok(), 'POST start-timer should succeed').toBeTruthy()
      entryId = ((await startResponse.json()) as { id?: string }).id ?? null
      expect(entryId, 'start-timer response should contain the entry id').toBeTruthy()

      // The regression gate: this returned an empty list for every caller, which
      // is why the TimerBar never rendered a Stop button.
      const whileRunning = await listRunningEntries(request, employeeToken, staffMemberId)
      const runningEntry = whileRunning.find((item) => item.id === entryId)
      expect(runningEntry, 'A started, unfinished entry must appear in the running lookup').toBeTruthy()
      expect(runningEntry!.started_at, 'Running entry should expose started_at').toBeTruthy()
      expect(runningEntry!.ended_at, 'Running entry should have no ended_at').toBeFalsy()

      const stopResponse = await apiRequest(
        request,
        'POST',
        `/api/staff/timesheets/time-entries/${entryId}/timer-stop`,
        { token: employeeToken },
      )
      expect(stopResponse.status(), 'POST timer-stop should return 200').toBe(200)

      // The `$exists: false` half: a stopped entry must drop out of the lookup.
      const afterStop = await listRunningEntries(request, employeeToken, staffMemberId)
      expect(
        afterStop.some((item) => item.id === entryId),
        'A stopped entry must not appear in the running lookup',
      ).toBeFalsy()
    } finally {
      await stopActiveEntries(request, employeeToken, staffMemberId, today).catch(() => {})
      await deleteStaffEntityIfExists(request, adminToken, '/api/staff/timesheets/time-entries', entryId)
      await deleteStaffEntityIfExists(request, adminToken, '/api/staff/timesheets/time-projects', projectId)
      await customer.cleanup()
    }
  })
})
