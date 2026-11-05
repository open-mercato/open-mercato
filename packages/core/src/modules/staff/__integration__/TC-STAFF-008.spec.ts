import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createStaffTeamMemberFixture,
  deleteStaffEntityIfExists,
} from '@open-mercato/core/helpers/integration/staffFixtures'

/**
 * TC-STAFF-008: Team Member Comments CRUD via API
 * Source: GitHub issue #2460 (staff coverage expansion).
 *
 * Comments are a flat CRUD route scoped to a member via `entityId` (NOT a nested
 * /team-members/<id>/comments route). The note text field is `body`.
 *
 * Verified contract:
 * - POST /api/staff/comments { entityId, body } -> 201 { id, authorUserId }.
 * - GET  /api/staff/comments?entityId=<memberId> lists snake_case fields (body).
 * - PUT  /api/staff/comments { id, body } -> 200 { ok: true }.
 * - DELETE /api/staff/comments?id=<id> -> 200 { ok: true } (soft delete; the
 *   record drops out of the list).
 */
const COMMENTS_PATH = '/api/staff/comments'
const MEMBERS_PATH = '/api/staff/team-members'

async function listComments(
  request: APIRequestContext,
  token: string,
  memberId: string,
): Promise<Array<Record<string, unknown>>> {
  const response = await apiRequest(
    request,
    'GET',
    `${COMMENTS_PATH}?entityId=${encodeURIComponent(memberId)}`,
    { token },
  )
  expect(response.status(), 'GET /api/staff/comments should return 200').toBe(200)
  const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(response)
  return body?.items ?? []
}

test.describe('TC-STAFF-008: Team Member Comments CRUD via API', () => {
  test('creates, lists, updates, and deletes a team member comment', async ({ request }) => {
    let token: string | null = null
    let memberId: string | null = null
    let commentId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      memberId = await createStaffTeamMemberFixture(request, token, {
        displayName: `QA TC-STAFF-008 ${Date.now()}`,
      })

      const createResponse = await apiRequest(request, 'POST', COMMENTS_PATH, {
        token,
        data: { entityId: memberId, body: 'Initial comment' },
      })
      expect(createResponse.status(), 'POST /api/staff/comments should return 201').toBe(201)
      commentId = (await readJsonSafe<{ id?: string }>(createResponse))?.id ?? null
      expect(commentId, 'create should return a comment id').toBeTruthy()

      const created = (await listComments(request, token, memberId)).find((comment) => comment.id === commentId)
      expect(created, 'created comment should appear in the list').toBeTruthy()
      expect(created!.body, 'comment body should persist').toBe('Initial comment')
      const createdUpdatedAt = Date.parse(String(created!.updated_at))

      const putResponse = await apiRequest(request, 'PUT', COMMENTS_PATH, {
        token,
        data: { id: commentId, body: 'Updated comment' },
      })
      expect(putResponse.status(), 'PUT /api/staff/comments should return 200').toBe(200)

      const updated = (await listComments(request, token, memberId)).find((comment) => comment.id === commentId)
      expect(updated, 'updated comment should still be listed').toBeTruthy()
      expect(updated!.body, 'comment body should reflect the update').toBe('Updated comment')
      expect(
        Date.parse(String(updated!.updated_at)) > createdUpdatedAt,
        'updated_at should advance on update',
      ).toBe(true)

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `${COMMENTS_PATH}?id=${encodeURIComponent(commentId!)}`,
        { token },
      )
      expect(deleteResponse.status(), 'DELETE /api/staff/comments should return 200').toBe(200)
      const deletedId = commentId
      commentId = null

      const remaining = (await listComments(request, token, memberId)).find((comment) => comment.id === deletedId)
      expect(remaining, 'deleted comment should no longer be listed').toBeFalsy()
    } finally {
      await deleteStaffEntityIfExists(request, token, COMMENTS_PATH, commentId)
      await deleteStaffEntityIfExists(request, token, MEMBERS_PATH, memberId)
    }
  })
})
