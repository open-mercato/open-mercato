import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  Cleanup,
  addProjectMember,
  adminToken,
  createAccountlessMember,
  createProject,
  createStaffPerson,
} from './support/fixtures'

export const integrationMeta = {
  dependsOnModules: ['staff', 'customers'],
}

/**
 * TC-STAFF-056 — Time-project employee list is scoped to the caller's own projects (#8885).
 *
 * Covers: GET /api/staff/timesheets/time-projects/{id}/employees
 *
 * A plain Team Member (`employee` role: holds `staff.timesheets.projects.view`, not
 * `projects.manage`) who belongs to project A must not read project B's roster —
 * neither by naming B in the URL, nor by keeping A in the URL and redirecting the
 * list onto B via `?timeProjectId=` or an advanced filter on `time_project_id`.
 * Runs through the real CRUD factory, so it pins the wiring the route's unit test
 * mocks away: the factory merging client advanced filters over `buildFilters`.
 *
 * Self-contained: users, team members, projects and memberships are created here
 * and removed in `finally`.
 */

const EMPLOYEES_PATH = (projectId: string) => `/api/staff/timesheets/time-projects/${projectId}/employees`

type MemberRow = { id?: string; time_project_id?: string; staff_member_id?: string }

async function listRoster(
  request: APIRequestContext,
  token: string,
  projectId: string,
  query = '',
): Promise<{ status: number; items: MemberRow[]; reason: string | null }> {
  const response = await apiRequest(request, 'GET', `${EMPLOYEES_PATH(projectId)}${query}`, { token })
  const body = await readJsonSafe<{ items?: MemberRow[]; reason?: string }>(response)
  return { status: response.status(), items: body?.items ?? [], reason: body?.reason ?? null }
}

function advancedFilterOnProject(projectId: string): string {
  return (
    '?filter[conditions][0][field]=time_project_id' +
    '&filter[conditions][0][op]=is' +
    `&filter[conditions][0][value]=${encodeURIComponent(projectId)}`
  )
}

test.describe('TC-STAFF-056: time-project employee list enforces project access', () => {
  test('a member of project A cannot read project B roster by URL, query param or advanced filter', async ({ request }) => {
    test.setTimeout(120_000)
    const cleanup = new Cleanup()
    try {
      const admin = await adminToken(request)
      const member = await createStaffPerson(request, admin, cleanup, 'roster-a')
      const outsiderMemberId = await createAccountlessMember(request, admin, cleanup)

      const projectA = await createProject(request, admin, cleanup, 'Roster A')
      const projectB = await createProject(request, admin, cleanup, 'Roster B')

      const memberAssignmentId = await addProjectMember(request, admin, projectA.id, member.staffMemberId)
      cleanup.add(() => apiRequest(request, 'DELETE', `${EMPLOYEES_PATH(projectA.id)}?id=${memberAssignmentId}`, { token: admin }))
      const outsiderAssignmentId = await addProjectMember(request, admin, projectB.id, outsiderMemberId)
      cleanup.add(() => apiRequest(request, 'DELETE', `${EMPLOYEES_PATH(projectB.id)}?id=${outsiderAssignmentId}`, { token: admin }))

      const adminViewOfB = await listRoster(request, admin, projectB.id)
      expect(adminViewOfB.status, 'A manage-all caller still reads any project roster').toBe(200)
      expect(adminViewOfB.items.some((row) => row.id === outsiderAssignmentId)).toBe(true)

      const ownRoster = await listRoster(request, member.token, projectA.id)
      expect(ownRoster.status, 'A member reads their own project roster').toBe(200)
      expect(ownRoster.items.some((row) => row.id === memberAssignmentId)).toBe(true)

      const directB = await listRoster(request, member.token, projectB.id)
      expect(directB.status, 'A non-member is denied the other project roster').toBe(404)
      expect(directB.reason).toBe('no_project_access')
      expect(directB.items).toHaveLength(0)

      const assertNoProjectBRows = (rows: MemberRow[], label: string) => {
        expect(rows.find((row) => row.id === outsiderAssignmentId), `${label} must not expose project B rows`).toBeFalsy()
        expect(rows.every((row) => row.time_project_id === projectA.id), `${label} must stay scoped to project A`).toBe(true)
      }

      const viaQueryParam = await listRoster(
        request,
        member.token,
        projectA.id,
        `?timeProjectId=${encodeURIComponent(projectB.id)}`,
      )
      expect(viaQueryParam.status).toBe(200)
      assertNoProjectBRows(viaQueryParam.items, '?timeProjectId= redirect')

      const viaAdvancedFilter = await listRoster(request, member.token, projectA.id, advancedFilterOnProject(projectB.id))
      expect(viaAdvancedFilter.status).toBe(200)
      assertNoProjectBRows(viaAdvancedFilter.items, 'advanced filter on time_project_id')
    } finally {
      await cleanup.run()
    }
  })
})
