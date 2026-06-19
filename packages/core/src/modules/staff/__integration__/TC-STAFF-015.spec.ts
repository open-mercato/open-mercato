import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createStaffTeamMemberFixture,
  deleteStaffEntityIfExists,
} from '@open-mercato/core/helpers/integration/staffFixtures'

/**
 * TC-STAFF-015: Team Member Tag Lifecycle (Assign and Unassign)
 * Source: GitHub issue #2460 (staff coverage expansion).
 *
 * Both the assign and unassign routes exist; neither was exercised. Tags live as
 * a string array on the member (`tags`), so the lifecycle is read back via the
 * team-members list.
 *
 * Verified contract:
 * - POST /api/staff/team-members/tags/assign { memberId, tag } -> 201 { id }
 *   (409 'Tag already assigned.' on a duplicate).
 * - POST /api/staff/team-members/tags/unassign { memberId, tag } -> 200 { id }
 *   (404 'Tag assignment not found.' when the tag is absent).
 * - GET /api/staff/team-members?ids=<id> returns the live `tags` array.
 */
const MEMBERS_PATH = '/api/staff/team-members'
const ASSIGN_PATH = '/api/staff/team-members/tags/assign'
const UNASSIGN_PATH = '/api/staff/team-members/tags/unassign'

async function readMemberTags(
  request: APIRequestContext,
  token: string,
  memberId: string,
): Promise<string[]> {
  const response = await apiRequest(request, 'GET', `${MEMBERS_PATH}?ids=${encodeURIComponent(memberId)}`, { token })
  expect(response.status(), 'GET /api/staff/team-members should return 200').toBe(200)
  const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(response)
  const member = (body?.items ?? []).find((item) => item.id === memberId)
  const tags = member?.tags
  return Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === 'string') : []
}

test.describe('TC-STAFF-015: Team Member Tag Lifecycle (Assign and Unassign)', () => {
  test('assigns multiple tags and unassigns one without disturbing the rest', async ({ request }) => {
    let token: string | null = null
    let memberId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      memberId = await createStaffTeamMemberFixture(request, token, {
        displayName: `QA TC-STAFF-015 ${Date.now()}`,
      })

      const assignContractor = await apiRequest(request, 'POST', ASSIGN_PATH, {
        token,
        data: { memberId, tag: 'contractor' },
      })
      expect(assignContractor.status(), 'first tag assign should return 201').toBe(201)
      expect((await readJsonSafe<{ id?: string }>(assignContractor))?.id, 'assign should echo the member id').toBe(memberId)

      let tags = await readMemberTags(request, token, memberId!)
      expect(tags, "member tags should include 'contractor'").toContain('contractor')

      const assignSenior = await apiRequest(request, 'POST', ASSIGN_PATH, {
        token,
        data: { memberId, tag: 'senior' },
      })
      expect(assignSenior.status(), 'second tag assign should return 201').toBe(201)

      tags = await readMemberTags(request, token, memberId!)
      expect(tags, "member tags should include 'contractor'").toContain('contractor')
      expect(tags, "member tags should include 'senior'").toContain('senior')

      // Re-assigning an existing tag is rejected as a conflict.
      const duplicateAssign = await apiRequest(request, 'POST', ASSIGN_PATH, {
        token,
        data: { memberId, tag: 'senior' },
      })
      expect(duplicateAssign.status(), 're-assigning an existing tag should return 409').toBe(409)

      const unassignContractor = await apiRequest(request, 'POST', UNASSIGN_PATH, {
        token,
        data: { memberId, tag: 'contractor' },
      })
      expect(unassignContractor.status(), 'tag unassign should return 200').toBe(200)

      tags = await readMemberTags(request, token, memberId!)
      expect(tags, "unassigned 'contractor' should be gone").not.toContain('contractor')
      expect(tags, "'senior' should remain after unassigning 'contractor'").toContain('senior')

      // Unassigning a tag that is no longer present is a not-found error.
      const unassignMissing = await apiRequest(request, 'POST', UNASSIGN_PATH, {
        token,
        data: { memberId, tag: 'contractor' },
      })
      expect(unassignMissing.status(), 'unassigning an absent tag should return 404').toBe(404)
    } finally {
      await deleteStaffEntityIfExists(request, token, MEMBERS_PATH, memberId)
    }
  })
})
