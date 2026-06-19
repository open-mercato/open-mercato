import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createStaffTeamMemberFixture,
  deleteStaffEntityIfExists,
} from '@open-mercato/core/helpers/integration/staffFixtures'

/**
 * TC-STAFF-006: Leave Request Rejection via API with Decision Comment
 * Source: GitHub issue #2460 (staff coverage expansion).
 *
 * Reject is the untested twin of the approve flow (TC-STAFF-004). A manager
 * rejects a pending leave request with a decision comment; the request must land
 * in `rejected` with the comment, decider, and decision timestamp persisted.
 *
 * Verified contract (against the real route/command):
 * - POST /api/staff/leave-requests/reject -> 200 { ok: true, id } (NOT 201).
 * - Read-back via GET ?ids= returns snake_case fields (decision_comment,
 *   decided_at, decided_by_user_id); decided_by_user_id equals the actor user id.
 */
const LEAVE_REQUESTS_PATH = '/api/staff/leave-requests'
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

test.describe('TC-STAFF-006: Leave Request Rejection via API with Decision Comment', () => {
  test('rejects a pending leave request and persists the decision', async ({ request }) => {
    let token: string | null = null
    let memberId: string | null = null
    let leaveRequestId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      const actorUserId = getTokenScope(token).userId

      memberId = await createStaffTeamMemberFixture(request, token, {
        displayName: `QA TC-STAFF-006 ${Date.now()}`,
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

      const decisionComment = 'Rejected by QA automation — conflicting coverage window.'
      const rejectResponse = await apiRequest(request, 'POST', REJECT_PATH, {
        token,
        data: { id: leaveRequestId, decisionComment },
      })
      expect(rejectResponse.status(), 'POST /api/staff/leave-requests/reject should return 200').toBe(200)
      const rejectBody = await readJsonSafe<{ ok?: boolean; id?: string }>(rejectResponse)
      expect(rejectBody?.ok, 'reject response should set ok: true').toBe(true)
      expect(rejectBody?.id, 'reject response id should match the request').toBe(leaveRequestId)

      const item = await readLeaveRequest(request, token, leaveRequestId!)
      expect(item, 'rejected leave request should be retrievable').toBeTruthy()
      expect(item!.status, 'status should be rejected').toBe('rejected')
      expect(item!.decision_comment, 'decision comment should persist').toBe(decisionComment)
      const decidedAt = item!.decided_at
      expect(
        typeof decidedAt === 'string' && decidedAt.length > 0,
        'decided_at should be a recent ISO timestamp',
      ).toBe(true)
      expect(item!.decided_by_user_id, 'decided_by_user_id should match the authenticated user').toBe(actorUserId)
    } finally {
      // Finalized (rejected) leave requests cannot be deleted via the API (delete
      // requires pending status), so this mirrors TC-STAFF-004's best-effort
      // cleanup; the member fixture is removed regardless.
      await deleteStaffEntityIfExists(request, token, LEAVE_REQUESTS_PATH, leaveRequestId)
      await deleteStaffEntityIfExists(request, token, MEMBERS_PATH, memberId)
    }
  })
})
