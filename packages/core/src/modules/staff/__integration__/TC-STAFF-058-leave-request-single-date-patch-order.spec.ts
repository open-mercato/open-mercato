import { randomInt } from 'crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createStaffTeamMemberFixture,
  deleteStaffEntityIfExists,
} from '@open-mercato/core/helpers/integration/staffFixtures'

/**
 * TC-STAFF-058: a leave-request update that sends only one date cannot invert the range.
 *
 * The update schema only compares startDate/endDate when both are in the body, so the
 * command must check the merged record. A rejected patch returns 400 and leaves the stored
 * dates untouched; a single-date patch that keeps the range ordered still succeeds.
 *
 * Endpoints: POST/PUT/GET/DELETE /api/staff/leave-requests, POST/DELETE /api/staff/team-members
 */
const LEAVE_REQUESTS_PATH = '/api/staff/leave-requests'
const MEMBERS_PATH = '/api/staff/team-members'
const DAY_MS = 24 * 60 * 60 * 1000

type LeaveRequestRow = Record<string, unknown>
type ErrorBody = { error?: string; fieldErrors?: Record<string, string> }

function dayKey(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * DAY_MS).toISOString().slice(0, 10)
}

function storedDayKey(value: unknown): string | null {
  return typeof value === 'string' ? new Date(value).toISOString().slice(0, 10) : null
}

async function readStoredRange(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<{ startDate: string | null; endDate: string | null }> {
  const response = await apiRequest(request, 'GET', `${LEAVE_REQUESTS_PATH}?ids=${encodeURIComponent(id)}`, { token })
  expect(response.status(), 'GET /api/staff/leave-requests should return 200').toBe(200)
  const body = await readJsonSafe<{ items?: LeaveRequestRow[] }>(response)
  const row = (body?.items ?? []).find((item) => item.id === id)
  expect(row, 'the leave request should be listed').toBeTruthy()
  return {
    startDate: storedDayKey(row?.start_date ?? row?.startDate),
    endDate: storedDayKey(row?.end_date ?? row?.endDate),
  }
}

test.describe('TC-STAFF-058: leave-request single-date patch keeps the range ordered', () => {
  test('rejects a one-date patch that would put endDate before startDate', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let memberId: string | null = null
    let leaveRequestId: string | null = null
    const offset = randomInt(500, 2500)
    const startDate = dayKey(offset + 10)
    const endDate = dayKey(offset + 20)

    try {
      memberId = await createStaffTeamMemberFixture(request, token, {
        displayName: `QA TC-STAFF-058 ${Date.now()}`,
      })

      const createResponse = await apiRequest(request, 'POST', LEAVE_REQUESTS_PATH, {
        token,
        data: { memberId, startDate, endDate, timezone: 'UTC' },
      })
      leaveRequestId = (await readJsonSafe<{ id?: string }>(createResponse))?.id ?? null
      expect(createResponse.status(), 'POST /api/staff/leave-requests should return 201').toBe(201)
      expect(leaveRequestId, 'create response should include an id').toBeTruthy()
      const id = leaveRequestId as string

      const endOnlyResponse = await apiRequest(request, 'PUT', LEAVE_REQUESTS_PATH, {
        token,
        data: { id, endDate: dayKey(offset + 1) },
      })
      expect(endOnlyResponse.status(), 'endDate-only patch before startDate should return 400').toBe(400)
      const endOnlyBody = await readJsonSafe<ErrorBody>(endOnlyResponse)
      expect(endOnlyBody?.error, 'the 400 should carry a translated message').toBeTruthy()
      expect(endOnlyBody?.fieldErrors?.endDate, 'the 400 should point at endDate').toBeTruthy()
      expect(await readStoredRange(request, token, id)).toEqual({ startDate, endDate })

      const startOnlyResponse = await apiRequest(request, 'PUT', LEAVE_REQUESTS_PATH, {
        token,
        data: { id, startDate: dayKey(offset + 30) },
      })
      expect(startOnlyResponse.status(), 'startDate-only patch after endDate should return 400').toBe(400)
      expect(await readStoredRange(request, token, id)).toEqual({ startDate, endDate })

      const bothResponse = await apiRequest(request, 'PUT', LEAVE_REQUESTS_PATH, {
        token,
        data: { id, startDate: dayKey(offset + 30), endDate: dayKey(offset + 1) },
      })
      expect(bothResponse.status(), 'reversed patch with both dates should still return 400').toBe(400)
      expect(await readStoredRange(request, token, id)).toEqual({ startDate, endDate })

      const extendedEndDate = dayKey(offset + 25)
      const validResponse = await apiRequest(request, 'PUT', LEAVE_REQUESTS_PATH, {
        token,
        data: { id, endDate: extendedEndDate },
      })
      expect(validResponse.status(), 'an ordered endDate-only patch should return 200').toBe(200)
      expect(await readStoredRange(request, token, id)).toEqual({ startDate, endDate: extendedEndDate })
    } finally {
      await deleteStaffEntityIfExists(request, token, LEAVE_REQUESTS_PATH, leaveRequestId)
      await deleteStaffEntityIfExists(request, token, MEMBERS_PATH, memberId)
    }
  })
})
