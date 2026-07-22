import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createStaffTeamMemberFixture,
  deleteStaffEntityIfExists,
} from '@open-mercato/core/helpers/integration/staffFixtures'

/**
 * TC-STAFF-016: Team Member Job History CRUD via API
 * Source: GitHub issue #2460 (staff coverage expansion).
 *
 * Job histories are a flat CRUD route scoped to a member via `entityId`.
 * TC-LOCK-OSS-036 exercises the optimistic-lock conflict bar on the nested edit;
 * the plain create/list/update/delete lifecycle was never asserted.
 *
 * Verified contract:
 * - POST /api/staff/job-histories { entityId, name, startDate, ... } -> 201 { id }.
 * - GET  /api/staff/job-histories?entityId=<memberId> lists snake_case fields.
 * - PUT  /api/staff/job-histories { id, endDate } -> 200 { ok: true } (no lock
 *   header -> proceeds).
 * - DELETE /api/staff/job-histories?id=<id> -> 200 { ok: true } (hard delete).
 */
const JOB_HISTORIES_PATH = '/api/staff/job-histories'
const MEMBERS_PATH = '/api/staff/team-members'

async function listJobHistories(
  request: APIRequestContext,
  token: string,
  memberId: string,
): Promise<Array<Record<string, unknown>>> {
  const response = await apiRequest(
    request,
    'GET',
    `${JOB_HISTORIES_PATH}?entityId=${encodeURIComponent(memberId)}`,
    { token },
  )
  expect(response.status(), 'GET /api/staff/job-histories should return 200').toBe(200)
  const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(response)
  return body?.items ?? []
}

test.describe('TC-STAFF-016: Team Member Job History CRUD via API', () => {
  test('creates, lists, updates, and deletes a team member job history entry', async ({ request }) => {
    let token: string | null = null
    let memberId: string | null = null
    let jobHistoryId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      memberId = await createStaffTeamMemberFixture(request, token, {
        displayName: `QA TC-STAFF-016 ${Date.now()}`,
      })

      const createResponse = await apiRequest(request, 'POST', JOB_HISTORIES_PATH, {
        token,
        data: {
          entityId: memberId,
          name: 'Senior Engineer',
          companyName: 'Globex Corporation',
          startDate: '2020-01-15',
          endDate: '2022-12-31',
        },
      })
      expect(createResponse.status(), 'POST /api/staff/job-histories should return 201').toBe(201)
      jobHistoryId = (await readJsonSafe<{ id?: string }>(createResponse))?.id ?? null
      expect(jobHistoryId, 'create should return a job history id').toBeTruthy()

      const created = (await listJobHistories(request, token, memberId)).find((entry) => entry.id === jobHistoryId)
      expect(created, 'created job history should appear in the list').toBeTruthy()
      expect(created!.name, 'name should persist').toBe('Senior Engineer')
      expect(created!.company_name, 'company_name should persist').toBe('Globex Corporation')
      expect(
        String(created!.start_date).startsWith('2020-01-15'),
        'start_date should persist',
      ).toBe(true)
      expect(
        String(created!.end_date).startsWith('2022-12-31'),
        'end_date should persist',
      ).toBe(true)

      const putResponse = await apiRequest(request, 'PUT', JOB_HISTORIES_PATH, {
        token,
        data: { id: jobHistoryId, endDate: '2023-06-30' },
      })
      expect(putResponse.status(), 'PUT /api/staff/job-histories should return 200').toBe(200)

      const updated = (await listJobHistories(request, token, memberId)).find((entry) => entry.id === jobHistoryId)
      expect(updated, 'updated job history should still be listed').toBeTruthy()
      expect(
        String(updated!.end_date).startsWith('2023-06-30'),
        'end_date should reflect the update',
      ).toBe(true)
      expect(updated!.name, 'untouched name should remain').toBe('Senior Engineer')

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `${JOB_HISTORIES_PATH}?id=${encodeURIComponent(jobHistoryId!)}`,
        { token },
      )
      expect(deleteResponse.status(), 'DELETE /api/staff/job-histories should return 200').toBe(200)
      const deletedId = jobHistoryId
      jobHistoryId = null

      const remaining = (await listJobHistories(request, token, memberId)).find((entry) => entry.id === deletedId)
      expect(remaining, 'deleted job history should no longer be listed').toBeFalsy()
    } finally {
      await deleteStaffEntityIfExists(request, token, JOB_HISTORIES_PATH, jobHistoryId)
      await deleteStaffEntityIfExists(request, token, MEMBERS_PATH, memberId)
    }
  })
})
