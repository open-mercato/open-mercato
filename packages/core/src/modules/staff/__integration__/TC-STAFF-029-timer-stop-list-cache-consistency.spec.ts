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
 * TC-STAFF-029: Timer stop is visible in the cached time-entries list (#2609)
 *
 * The point of this test is the ORDERING, not the assertion. Step 5 issues the
 * filtered list GET *before* the stop, which warms the opt-in CRUD list cache
 * key. Before the fix, the hand-rolled timer-stop route wrote the entry straight
 * through the ORM and invalidated nothing, so step 7 — the same cache key — kept
 * serving the pre-stop `ended_at: null` snapshot and the UI rehydrated a
 * finished timer as still running.
 *
 * TC-STAFF-011 cannot catch this: its only list GET happens after the stop, so
 * the key is cold and the assertion reads through to the database.
 *
 * The test only has teeth with `ENABLE_CRUD_API_CACHE=true`, which every
 * `yarn test:integration*` script and the ephemeral runner already set.
 *
 * Self-contained: creates project + entry via the API, cleans up in `finally`.
 */
test.describe('TC-STAFF-029: Timer stop is visible in the cached time-entries list', () => {
  test('should return the stopped entry from a list cache key warmed before the stop', async ({ request }) => {
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
      name: `QA Timer Cache ${stamp}`,
      code: `QATC-${stamp}`,
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

      const startResponse = await apiRequest(
        request,
        'POST',
        `/api/staff/timesheets/time-entries/${entryId}/timer-start`,
        { token: employeeToken },
      )
      expect(startResponse.ok(), 'POST timer-start should succeed').toBeTruthy()

      // REQUIRED: warms the list cache key with the running (`ended_at: null`)
      // projection. Removing this line makes the whole test pass vacuously.
      const preStopEntries = await listEntriesForDate(request, employeeToken, staffMemberId, today)
      const preStopEntry = preStopEntries.find((item) => item.id === entryId)
      expect(preStopEntry, 'Running entry should appear in the pre-stop list').toBeTruthy()
      expect(preStopEntry!.ended_at, 'Running entry should have no ended_at before the stop').toBeFalsy()

      const stopResponse = await apiRequest(
        request,
        'POST',
        `/api/staff/timesheets/time-entries/${entryId}/timer-stop`,
        { token: employeeToken },
      )
      expect(stopResponse.status(), 'POST timer-stop should return 200').toBe(200)
      const stopBody = (await stopResponse.json()) as { ok?: boolean; durationMinutes?: number }
      expect(stopBody.ok, 'Timer stop should return ok: true').toBe(true)
      expect(typeof stopBody.durationMinutes, 'Timer stop should return durationMinutes').toBe('number')

      // Same cache key as the pre-stop request — this is the regression gate.
      const postStopEntries = await listEntriesForDate(request, employeeToken, staffMemberId, today)
      const postStopEntry = postStopEntries.find((item) => item.id === entryId)
      expect(postStopEntry, 'Stopped entry should appear in the post-stop list').toBeTruthy()
      expect(
        postStopEntry!.ended_at,
        'Stopped entry must have ended_at in the list served from the warmed cache key',
      ).toBeTruthy()
      expect(postStopEntry!.started_at, 'Stopped entry should still have started_at').toBeTruthy()

      // A different cache key (`?ids=`) that was never warmed. Before the fix
      // the two read paths disagreed; they must now agree.
      const byIdEntry = await getEntryById(request, employeeToken, entryId!)
      expect(byIdEntry, 'Stopped entry should be retrievable by id').toBeTruthy()
      expect(byIdEntry!.ended_at, 'The ids= read path should agree with the filtered list').toBe(
        postStopEntry!.ended_at,
      )
    } finally {
      await stopActiveEntries(request, employeeToken, staffMemberId, today).catch(() => {})
      await deleteStaffEntityIfExists(request, adminToken, '/api/staff/timesheets/time-entries', entryId)
      await deleteStaffEntityIfExists(request, adminToken, '/api/staff/timesheets/time-projects', projectId)
      await customer.cleanup()
    }
  })
})
