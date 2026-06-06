import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createStaffTeamMemberFixture,
  deleteStaffEntityIfExists,
} from '@open-mercato/core/helpers/integration/staffFixtures'

/**
 * TC-STAFF-007: Team Member Update via PUT API
 * Source: GitHub issue #2460 (staff coverage expansion).
 *
 * Create and delete are covered (TC-STAFF-002 covers team CRUD; the member
 * fixture covers create); the PUT/update path was never asserted. Updating a
 * member's display name and description must persist while leaving created_at
 * and is_active untouched and advancing updated_at.
 *
 * Verified contract: PUT /api/staff/team-members -> 200 { ok: true }; read-back
 * via GET ?ids= returns snake_case fields (display_name, description, is_active).
 */
const MEMBERS_PATH = '/api/staff/team-members'

async function readMember(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  const response = await apiRequest(request, 'GET', `${MEMBERS_PATH}?ids=${encodeURIComponent(id)}`, { token })
  expect(response.status(), 'GET /api/staff/team-members should return 200').toBe(200)
  const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(response)
  return (body?.items ?? []).find((item) => item.id === id) ?? null
}

test.describe('TC-STAFF-007: Team Member Update via PUT API', () => {
  test('updates display name and description, leaving created_at and is_active intact', async ({ request }) => {
    let token: string | null = null
    let memberId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      memberId = await createStaffTeamMemberFixture(request, token, {
        displayName: `QA TC-STAFF-007 Original ${Date.now()}`,
      })

      const before = await readMember(request, token, memberId)
      expect(before, 'created member should be retrievable').toBeTruthy()

      const updatedName = `QA TC-STAFF-007 Updated ${Date.now()}`
      const putResponse = await apiRequest(request, 'PUT', MEMBERS_PATH, {
        token,
        data: { id: memberId, displayName: updatedName, description: 'New description' },
      })
      expect(putResponse.status(), 'PUT /api/staff/team-members should return 200').toBe(200)
      const putBody = await readJsonSafe<{ ok?: boolean }>(putResponse)
      expect(putBody?.ok, 'update response should set ok: true').toBe(true)

      const after = await readMember(request, token, memberId)
      expect(after, 'updated member should be retrievable').toBeTruthy()
      expect(after!.display_name, 'display_name should reflect the update').toBe(updatedName)
      expect(after!.description, 'description should reflect the update').toBe('New description')
      expect(after!.is_active, 'is_active should be unchanged').toBe(before!.is_active)
      expect(after!.created_at, 'created_at should be unchanged').toBe(before!.created_at)
      expect(
        Date.parse(String(after!.updated_at)) > Date.parse(String(before!.updated_at)),
        'updated_at should advance on update',
      ).toBe(true)
    } finally {
      await deleteStaffEntityIfExists(request, token, MEMBERS_PATH, memberId)
    }
  })
})
