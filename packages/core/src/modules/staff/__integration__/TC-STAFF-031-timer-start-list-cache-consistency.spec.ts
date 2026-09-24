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
  duration_minutes?: number
}

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

async function getEntryById(request: APIRequestContext, token: string, entryId: string) {
  const response = await apiRequest(
    request,
    'GET',
    `/api/staff/timesheets/time-entries?ids=${encodeURIComponent(entryId)}`,
    { token },
  )
  expect(response.ok(), 'GET /api/staff/timesheets/time-entries?ids= should succeed').toBeTruthy()
  const body = (await response.json()) as { items?: TimeEntryListItem[] }
  return body.items?.find((item) => item.id === entryId) ?? null
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
 * TC-STAFF-031: Timer start is visible in the cached time-entries list
 *
 * The mirror of TC-STAFF-029 for the start side, and — as there — the ORDERING is
 * the point. Step 5 issues the filtered list GET *before* the start, warming the
 * opt-in CRUD list cache key with the not-yet-started projection. Before the fix,
 * `[id]/timer-start` wrote `started_at` and `source` straight through the ORM and
 * invalidated nothing, so step 7 — the same cache key — kept serving the
 * pre-start `started_at: null` snapshot.
 *
 * The route now delegates to `staff.timesheets.time_entries.start_timer_existing`,
 * so the command bus flushes the `staff.timesheet` tag the list caches under.
 *
 * The test only has teeth with `ENABLE_CRUD_API_CACHE=true`, which every
 * `yarn test:integration*` script and the ephemeral runner already set.
 *
 * Self-contained: creates project + entry via the API, cleans up in `finally`.
 */
test.describe('TC-STAFF-031: Timer start is visible in the cached time-entries list', () => {
  test('should return the started entry from a list cache key warmed before the start', async ({ request }) => {
    const stamp = Date.now()
    const today = new Date().toISOString().slice(0, 10)

    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    const staffMemberId = await getSelfStaffMemberId(request, employeeToken)

    // The single-active-timer invariant (#2855) rejects a start while another
    // timer runs, so clear any leftovers from earlier specs first.
    await stopActiveEntries(request, employeeToken, staffMemberId, today)

    const customer = await createTestCustomer(request, adminToken)
    const projectId = await createTimeProjectFixture(request, adminToken, {
      customerId: customer.id,
      name: `QA Timer Start Cache ${stamp}`,
      code: `QATSC-${stamp}`,
    })
    let entryId: string | null = null

    try {
      await assignEmployeeToProjectFixture(request, adminToken, projectId, staffMemberId)

      const createResponse = await apiRequest(request, 'POST', '/api/staff/timesheets/time-entries', {
        token: employeeToken,
        data: {
          staffMemberId,
          timeProjectId: projectId,
          date: today,
          durationMinutes: 0,
          source: 'timer',
        },
      })
      expect(createResponse.status(), 'POST /api/staff/timesheets/time-entries should return 201').toBe(201)
      const createBody = (await createResponse.json()) as { id?: string }
      entryId = createBody.id ?? null
      expect(entryId, 'Create response should contain the entry id').toBeTruthy()

      // REQUIRED: warms the list cache key with the not-yet-started projection.
      // Removing this line makes the whole test pass vacuously.
      const preStartEntries = await listEntriesForDate(request, employeeToken, staffMemberId, today)
      const preStartEntry = preStartEntries.find((item) => item.id === entryId)
      expect(preStartEntry, 'Created entry should appear in the pre-start list').toBeTruthy()
      expect(preStartEntry!.started_at, 'Created entry should have no started_at before the start').toBeFalsy()

      const startResponse = await apiRequest(
        request,
        'POST',
        `/api/staff/timesheets/time-entries/${entryId}/timer-start`,
        { token: employeeToken },
      )
      expect(startResponse.status(), 'POST timer-start should return 200').toBe(200)
      const startBody = (await startResponse.json()) as { ok?: boolean }
      expect(startBody.ok, 'Timer start should return ok: true').toBe(true)

      // Same cache key as the pre-start request — this is the regression gate.
      const postStartEntries = await listEntriesForDate(request, employeeToken, staffMemberId, today)
      const postStartEntry = postStartEntries.find((item) => item.id === entryId)
      expect(postStartEntry, 'Started entry should appear in the post-start list').toBeTruthy()
      expect(
        postStartEntry!.started_at,
        'Started entry must have started_at in the list served from the warmed cache key',
      ).toBeTruthy()
      expect(postStartEntry!.ended_at, 'Started entry should still be running').toBeFalsy()

      // A different cache key (`?ids=`) that was never warmed. Before the fix
      // the two read paths disagreed; they must now agree.
      const byIdEntry = await getEntryById(request, employeeToken, entryId!)
      expect(byIdEntry, 'Started entry should be retrievable by id').toBeTruthy()
      expect(byIdEntry!.started_at, 'The ids= read path should agree with the filtered list').toBe(
        postStartEntry!.started_at,
      )
    } finally {
      await stopActiveEntries(request, employeeToken, staffMemberId, today).catch(() => {})
      await deleteStaffEntityIfExists(request, adminToken, '/api/staff/timesheets/time-entries', entryId)
      await deleteStaffEntityIfExists(request, adminToken, '/api/staff/timesheets/time-projects', projectId)
      await customer.cleanup()
    }
  })
})
