import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  assignEmployeeToProjectFixture,
  createTimeEntryFixture,
  createTimeProjectFixture,
  deleteStaffEntityIfExists,
  getSelfStaffMemberId,
} from '@open-mercato/core/helpers/integration/timesheetFixtures'
import { createTestCustomer, type TestCustomerFixture } from './fixtures'

/**
 * TC-STAFF-059: a segment PATCH never stores an endedAt earlier than startedAt.
 *
 * Endpoints:
 *   - POST  /api/staff/timesheets/time-entries/{id}/segments
 *   - PATCH /api/staff/timesheets/time-entries/{id}/segments/{segmentId}
 */

type SegmentItem = { startedAt?: string; endedAt?: string | null; segmentType?: string }
type ErrorBody = { code?: string; error?: string; fieldErrors?: Record<string, string> }

const START = '2026-01-05T08:00:00.000Z'
const END = '2026-01-05T10:00:00.000Z'

test.describe('TC-STAFF-059: time entry segment PATCH keeps endedAt after startedAt', () => {
  test('refuses inverted ranges and leaves the segment unchanged', async ({ request }) => {
    let token: string | null = null
    let customer: TestCustomerFixture | null = null
    let projectId: string | null = null
    let memberId: string | null = null
    let entryId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      customer = await createTestCustomer(request, token)
      projectId = await createTimeProjectFixture(request, token, {
        customerId: customer.id,
        name: `QA TC-STAFF-059 ${Date.now()}`,
      })
      const staffMemberId = await getSelfStaffMemberId(request, token)
      memberId = await assignEmployeeToProjectFixture(request, token, projectId, staffMemberId, {
        assignedStartDate: '2026-01-01',
      })
      entryId = await createTimeEntryFixture(request, token, {
        staffMemberId,
        timeProjectId: projectId,
        date: '2026-01-05',
        durationMinutes: 120,
      })

      const segmentsPath = `/api/staff/timesheets/time-entries/${encodeURIComponent(entryId)}/segments`
      const createRes = await apiRequest(request, 'POST', segmentsPath, {
        token,
        data: { startedAt: START, endedAt: END, segmentType: 'work' },
      })
      expect(createRes.status(), 'creating the segment succeeds').toBe(201)
      const segmentId = ((await readJsonSafe<{ id?: string }>(createRes))?.id ?? '') as string
      expect(segmentId, 'the segments API returned an id').toBeTruthy()
      const segmentPath = `${segmentsPath}/${encodeURIComponent(segmentId)}`

      const refusals: Array<{ data: Record<string, string>; field: string }> = [
        { data: { endedAt: '2026-01-05T07:00:00.000Z' }, field: 'endedAt' },
        { data: { startedAt: '2026-01-05T11:00:00.000Z' }, field: 'startedAt' },
        { data: { startedAt: '2026-01-05T12:00:00.000Z', endedAt: '2026-01-05T11:00:00.000Z' }, field: 'endedAt' },
      ]
      for (const refusal of refusals) {
        const res = await apiRequest(request, 'PATCH', segmentPath, { token, data: refusal.data })
        const body = await readJsonSafe<ErrorBody>(res)
        expect(res.status(), `PATCH ${JSON.stringify(refusal.data)} is refused`).toBe(400)
        expect(body?.code).toBe('segment_end_before_start')
        expect(body?.error, 'the refusal carries a message').toBeTruthy()
        expect(Object.keys(body?.fieldErrors ?? {})).toEqual([refusal.field])
      }

      const typeOnly = await apiRequest(request, 'PATCH', segmentPath, { token, data: { segmentType: 'break' } })
      expect(typeOnly.status(), 'a segmentType-only PATCH succeeds').toBe(200)
      const unchanged = (await readJsonSafe<{ item?: SegmentItem }>(typeOnly))?.item
      expect(unchanged?.startedAt, 'startedAt survived the refused edits').toBe(START)
      expect(unchanged?.endedAt, 'endedAt survived the refused edits').toBe(END)

      const forward = await apiRequest(request, 'PATCH', segmentPath, {
        token,
        data: { endedAt: '2026-01-05T11:00:00.000Z' },
      })
      expect(forward.status(), 'an ordered change succeeds').toBe(200)
      const extended = (await readJsonSafe<{ item?: SegmentItem }>(forward))?.item
      expect(extended?.endedAt).toBe('2026-01-05T11:00:00.000Z')
    } finally {
      if (token && entryId) {
        await apiRequest(request, 'DELETE', `/api/staff/timesheets/time-entries?id=${encodeURIComponent(entryId)}`, {
          token,
        }).catch(() => {})
      }
      if (token && projectId) {
        await deleteStaffEntityIfExists(
          request,
          token,
          `/api/staff/timesheets/time-projects/${encodeURIComponent(projectId)}/employees`,
          memberId,
        )
        await deleteStaffEntityIfExists(request, token, '/api/staff/timesheets/time-projects', projectId)
      }
      await customer?.cleanup()
    }
  })
})
