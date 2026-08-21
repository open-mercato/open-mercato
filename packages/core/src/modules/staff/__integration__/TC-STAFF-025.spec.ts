import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createStaffTeamMemberFixture,
  deleteStaffEntityIfExists,
} from '@open-mercato/core/helpers/integration/staffFixtures'

/**
 * TC-STAFF-025: Leave Request Rejection — Already-Decided State Guard
 * Source: GitHub issue #2460 (proposed there as "TC-STAFF-024"; renumbered to
 * 025 because TC-STAFF-024 already exists as the time-entries date-filter
 * regression guard).
 *
 * A leave request may only be decided once. Approving and then rejecting the
 * same request must be blocked by the `ensurePendingStatus` guard.
 *
 * Verified contract (against the real route/command):
 * - Reject on a non-pending request -> 400 { error: 'Leave request is already
 *   finalized.' }. The command throws CrudHttpError(400); it is NOT 409, and the
 *   message says "finalized" (not "already decided"/"already approved").
 * - The original decision (status, decided_at) is left untouched.
 */
const LEAVE_REQUESTS_PATH = '/api/staff/leave-requests'
const ACCEPT_PATH = '/api/staff/leave-requests/accept'
const REJECT_PATH = '/api/staff/leave-requests/reject'
const MEMBERS_PATH = '/api/staff/team-members'

async function readLeaveRequest(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  const response = await apiRequest(request, 'GET', `${LEAVE_REQUESTS_PATH}?ids=${encodeURIComponent(id)}`, { token })
  expect(response.status(), 'GET /api/staff/leave-requests should return 200').toBe(200)
  const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(response)
  return (body?.items ?? []).find((item) => item.id === id) ?? null
}

test.describe('TC-STAFF-025: Leave Request Rejection — Already-Decided State Guard', () => {
  test('cannot reject a leave request that was already approved', async ({ request }) => {
    let token: string | null = null
    let memberId: string | null = null
    let leaveRequestId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')

      memberId = await createStaffTeamMemberFixture(request, token, {
        displayName: `QA TC-STAFF-025 ${Date.now()}`,
      })

      const startDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      const endDate = new Date(Date.now() + 35 * 24 * 60 * 60 * 1000).toISOString()
      const createResponse = await apiRequest(request, 'POST', LEAVE_REQUESTS_PATH, {
        token,
        data: { memberId, startDate, endDate, timezone: 'UTC' },
      })
      expect(createResponse.status(), 'POST /api/staff/leave-requests should return 201').toBe(201)
      leaveRequestId = (await readJsonSafe<{ id?: string }>(createResponse))?.id ?? null
      expect(leaveRequestId, 'create response should include an id').toBeTruthy()

      const acceptResponse = await apiRequest(request, 'POST', ACCEPT_PATH, {
        token,
        data: { id: leaveRequestId, decisionComment: 'Approved by QA automation' },
      })
      expect(acceptResponse.status(), 'POST /api/staff/leave-requests/accept should return 200').toBe(200)

      const approved = await readLeaveRequest(request, token, leaveRequestId!)
      expect(approved?.status, 'status should be approved after acceptance').toBe('approved')
      const decidedAtAfterAccept = approved?.decided_at

      const rejectResponse = await apiRequest(request, 'POST', REJECT_PATH, {
        token,
        data: { id: leaveRequestId, decisionComment: 'Late rejection attempt' },
      })
      expect(rejectResponse.status(), 'rejecting an already-decided request must fail with 400').toBe(400)
      const rejectBody = await readJsonSafe<{ error?: string }>(rejectResponse)
      expect(
        typeof rejectBody?.error === 'string' && rejectBody!.error.length > 0,
        'a 400 error message should be present',
      ).toBe(true)
      expect(
        String(rejectBody?.error).toLowerCase(),
        'error should explain the request is already finalized',
      ).toContain('finalized')

      const afterReject = await readLeaveRequest(request, token, leaveRequestId!)
      expect(afterReject?.status, 'status must remain approved after the failed reject').toBe('approved')
      expect(
        afterReject?.decided_at,
        'decided_at must be unchanged after the failed reject',
      ).toBe(decidedAtAfterAccept)
    } finally {
      // Approved leave requests cannot be deleted via the API (delete requires
      // pending status); best-effort cleanup, member fixture removed regardless.
      await deleteStaffEntityIfExists(request, token, LEAVE_REQUESTS_PATH, leaveRequestId)
      await deleteStaffEntityIfExists(request, token, MEMBERS_PATH, memberId)
    }
  })
})
