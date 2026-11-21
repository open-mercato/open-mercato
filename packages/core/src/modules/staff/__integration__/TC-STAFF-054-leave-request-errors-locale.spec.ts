import { randomUUID } from 'crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createStaffTeamMemberFixture,
  deleteStaffEntityIfExists,
} from '@open-mercato/core/helpers/integration/staffFixtures'
import { extractOperation, undoByToken } from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-STAFF-054: leave-request command errors follow the caller's locale.
 *
 * The not-found (404) and already-finalized (400) errors raised by the leave-request
 * commands must be translated like the other errors in the same file. Requests are sent
 * with `Accept-Language: de` and token auth (no locale cookie).
 */
const LEAVE_REQUESTS_PATH = '/api/staff/leave-requests'
const ACCEPT_PATH = '/api/staff/leave-requests/accept'
const REJECT_PATH = '/api/staff/leave-requests/reject'
const MEMBERS_PATH = '/api/staff/team-members'
const GERMAN = { 'Accept-Language': 'de' }

test.describe('TC-STAFF-054: leave-request command errors follow the caller locale', () => {
  test('not-found and already-finalized errors are returned in German', async ({ request }) => {
    test.skip(Boolean(process.env.OM_FORCE_LOCALE), 'Locale is pinned via OM_FORCE_LOCALE in this environment')

    const token = await getAuthToken(request, 'admin')
    let memberId: string | null = null
    let leaveRequestId: string | null = null
    let acceptUndoToken: string | null = null

    try {
      memberId = await createStaffTeamMemberFixture(request, token, {
        displayName: `QA TC-STAFF-054 ${Date.now()}`,
      })

      const startDate = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000).toISOString()
      const endDate = new Date(Date.now() + 41 * 24 * 60 * 60 * 1000).toISOString()
      const createResponse = await apiRequest(request, 'POST', LEAVE_REQUESTS_PATH, {
        token,
        data: { memberId, startDate, endDate, timezone: 'UTC' },
      })
      leaveRequestId = (await readJsonSafe<{ id?: string }>(createResponse))?.id ?? null
      expect(createResponse.status(), 'POST /api/staff/leave-requests should return 201').toBe(201)
      expect(leaveRequestId, 'create response should include an id').toBeTruthy()

      const missingResponse = await apiRequest(request, 'POST', ACCEPT_PATH, {
        token,
        headers: GERMAN,
        data: { id: randomUUID() },
      })
      expect(missingResponse.status(), 'accepting a missing leave request should return 404').toBe(404)
      const missingBody = await readJsonSafe<{ error?: string }>(missingResponse)
      expect(missingBody?.error).toBe('Urlaubsantrag nicht gefunden.')

      const acceptResponse = await apiRequest(request, 'POST', ACCEPT_PATH, {
        token,
        data: { id: leaveRequestId },
      })
      expect(acceptResponse.status(), 'POST /api/staff/leave-requests/accept should return 200').toBe(200)
      acceptUndoToken = extractOperation(acceptResponse)?.undoToken ?? null

      const rejectResponse = await apiRequest(request, 'POST', REJECT_PATH, {
        token,
        headers: GERMAN,
        data: { id: leaveRequestId },
      })
      expect(rejectResponse.status(), 'rejecting an approved leave request should return 400').toBe(400)
      const rejectBody = await readJsonSafe<{ error?: string }>(rejectResponse)
      expect(rejectBody?.error).toBe('Der Urlaubsantrag wurde bereits abgeschlossen.')

      const deleteResponse = await apiRequest(request, 'DELETE', `${LEAVE_REQUESTS_PATH}?id=${leaveRequestId}`, {
        token,
        headers: GERMAN,
      })
      expect(deleteResponse.status(), 'deleting an approved leave request should return 400').toBe(400)
      const deleteBody = await readJsonSafe<{ error?: string }>(deleteResponse)
      expect(deleteBody?.error).toBe('Der Urlaubsantrag wurde bereits abgeschlossen.')

      if (acceptUndoToken) {
        const undoResponse = await undoByToken(request, token, acceptUndoToken)
        expect(undoResponse.ok(), 'undoing the approval should succeed so the request can be deleted').toBeTruthy()
        acceptUndoToken = null
      }
    } finally {
      if (acceptUndoToken) await undoByToken(request, token, acceptUndoToken).catch(() => undefined)
      await deleteStaffEntityIfExists(request, token, LEAVE_REQUESTS_PATH, leaveRequestId)
      await deleteStaffEntityIfExists(request, token, MEMBERS_PATH, memberId)
    }
  })
})
