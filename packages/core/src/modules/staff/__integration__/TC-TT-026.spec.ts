import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { apiRequestWithSelectedOrg } from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createTestCustomer, type TestCustomerFixture } from './fixtures'

export const integrationMeta = {
  dependsOnModules: ['customers'],
}

/**
 * TC-TT-026 — "My projects" under "All organizations" (#7465).
 *
 * `GET /api/staff/timesheets/time-projects?mine=1` narrows the list to the
 * projects the caller is an active member of. Under the "All organizations"
 * selection (`om_selected_org=__all__`) no organization is in scope, and the
 * route used to look the caller's staff profile up with an empty-string
 * organization id against a uuid column.
 *
 * Pinned through the real cookie → auth → scope → CRUD pipeline:
 *   1. With the caller's organization selected, `mine=1` returns the project
 *      the caller is assigned to.
 *   2. With "All organizations" selected, `mine=1` answers 200 with an empty
 *      list instead of failing on an invalid uuid.
 */

const PROJECTS_PATH = '/api/staff/timesheets/time-projects'
const SELF_MEMBER_PATH = '/api/staff/team-members/self'
const MINE_LIST_PATH = `${PROJECTS_PATH}?mine=1&pageSize=100`

type ListBody = { items?: Array<{ id?: string }> }

async function ensureSelfStaffMemberId(
  request: APIRequestContext,
  token: string,
  displayName: string,
): Promise<{ id: string; created: boolean }> {
  const read = async (): Promise<string | null> => {
    const response = await apiRequest(request, 'GET', SELF_MEMBER_PATH, { token })
    if (!response.ok()) return null
    const body = await readJsonSafe<{ member?: { id?: string } | null }>(response)
    const id = body?.member?.id
    return typeof id === 'string' && id.length > 0 ? id : null
  }
  const existing = await read()
  if (existing) return { id: existing, created: false }
  const response = await apiRequest(request, 'POST', SELF_MEMBER_PATH, { token, data: { displayName } })
  expect(response.ok(), `POST ${SELF_MEMBER_PATH} should create the staff profile: ${response.status()}`).toBeTruthy()
  const created = await read()
  expect(created, 'The staff profile should be readable right after creation').toBeTruthy()
  return { id: created as string, created: true }
}

test.describe('TC-TT-026: "my projects" under "All organizations"', () => {
  test('mine=1 lists the assigned project in the organization and an empty list under "All organizations"', async ({
    request,
  }) => {
    const stamp = String(Date.now()).slice(-9)
    const token = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(token)

    let customer: TestCustomerFixture | null = null
    let projectId: string | null = null
    let selfMember: { id: string; created: boolean } | null = null

    try {
      selfMember = await ensureSelfStaffMemberId(request, token, `QATT26 Member ${stamp}`)
      customer = await createTestCustomer(request, token, { displayName: `QATT26 Customer ${stamp}` })

      const projectResponse = await apiRequest(request, 'POST', PROJECTS_PATH, {
        token,
        data: {
          name: `QATT26 Project ${stamp}`,
          code: `QT26-${stamp}`,
          customerId: customer.id,
          projectType: 'internal',
          status: 'active',
        },
      })
      expect(projectResponse.ok(), `POST ${PROJECTS_PATH} should create the project: ${projectResponse.status()}`).toBeTruthy()
      projectId = ((await readJsonSafe<{ id?: string }>(projectResponse))?.id ?? null) as string | null
      expect(projectId, 'The project create response should carry an id').toBeTruthy()

      const assignResponse = await apiRequest(request, 'POST', `${PROJECTS_PATH}/${projectId}/employees`, {
        token,
        data: { staffMemberId: selfMember.id, status: 'active', assignedStartDate: new Date().toISOString().slice(0, 10) },
      })
      expect(
        assignResponse.ok(),
        `Assigning the member to the project should succeed: ${assignResponse.status()} ${await assignResponse.text()}`,
      ).toBeTruthy()

      const scopedResponse = await apiRequestWithSelectedOrg(request, 'GET', MINE_LIST_PATH, {
        token,
        selectedOrgId: organizationId,
      })
      expect(scopedResponse.status(), 'mine=1 in the caller organization should succeed').toBe(200)
      const scopedIds = ((await readJsonSafe<ListBody>(scopedResponse))?.items ?? []).map((item) => item.id)
      expect(scopedIds, 'The assigned project should be listed in the caller organization').toContain(projectId)

      const allOrganizationsResponse = await apiRequestWithSelectedOrg(request, 'GET', MINE_LIST_PATH, {
        token,
        selectedOrgId: '__all__',
      })
      expect(
        allOrganizationsResponse.status(),
        'mine=1 under "All organizations" should answer 200, not fail on an empty organization id',
      ).toBe(200)
      const allOrganizationsItems = (await readJsonSafe<ListBody>(allOrganizationsResponse))?.items ?? []
      expect(allOrganizationsItems, 'No organization is in scope, so no project is "mine"').toEqual([])
    } finally {
      if (projectId) {
        await apiRequest(request, 'DELETE', `${PROJECTS_PATH}?id=${encodeURIComponent(projectId)}`, { token }).catch(() => {})
      }
      if (customer) await customer.cleanup()
      if (selfMember?.created) {
        await apiRequest(request, 'DELETE', `/api/staff/team-members?id=${encodeURIComponent(selfMember.id)}`, { token }).catch(
          () => {},
        )
      }
    }
  })
})
