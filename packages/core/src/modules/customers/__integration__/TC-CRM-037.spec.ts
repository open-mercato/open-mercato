import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createCompanyFixture, deleteEntityIfExists, readJsonSafe } from '@open-mercato/core/helpers/integration/crmFixtures'

type JsonRecord = Record<string, unknown>

type TeamMemberResponse = {
  items?: Array<{
    userId?: string
    user_id?: string
  }>
}

type CompanyPeopleResponse = JsonRecord & {
  people?: Array<JsonRecord>
}

type RolesResponse = JsonRecord & {
  items?: Array<JsonRecord>
}

test.describe('TC-CRM-037: Company people and roles payload extensions', () => {
  test('should expose extended people include fields and nullable role phone', async ({ request }) => {
    let token: string | null = null
    let companyId: string | null = null
    let personId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, token, `QA Company People ${Date.now()}`)

      const createPersonResponse = await apiRequest(request, 'POST', '/api/customers/people', {
        token,
        data: {
          firstName: 'Ada',
          lastName: 'Lovelace',
          displayName: 'Ada Lovelace',
          primaryEmail: `ada.${Date.now()}@example.com`,
          status: 'active',
          lifecycleStage: 'lead',
          source: 'linkedin',
          companyEntityId: companyId,
        },
      })
      const createdPersonPayload = (await readJsonSafe<JsonRecord>(createPersonResponse)) ?? {}
      expect(createPersonResponse.ok(), `person create should succeed: ${createPersonResponse.status()}`).toBeTruthy()
      personId =
        typeof createdPersonPayload.id === 'string'
          ? createdPersonPayload.id
          : typeof createdPersonPayload.entityId === 'string'
            ? createdPersonPayload.entityId
            : null
      expect(personId).toBeTruthy()

      const companyDetailResponse = await apiRequest(
        request,
        'GET',
        `/api/customers/companies/${encodeURIComponent(companyId)}?include=people`,
        { token },
      )
      const companyDetailPayload = (await readJsonSafe<CompanyPeopleResponse>(companyDetailResponse)) ?? {}
      expect(companyDetailResponse.ok(), `company detail should succeed: ${companyDetailResponse.status()}`).toBeTruthy()
      const people = Array.isArray(companyDetailPayload.people) ? companyDetailPayload.people : []
      const person = people.find((entry) => entry.id === personId)
      expect(person).toBeTruthy()
      expect(person).toMatchObject({
        id: personId,
        source: 'linkedin',
        status: 'active',
        lifecycleStage: 'lead',
      })
      expect(person).toHaveProperty('temperature')
      expect(person).toHaveProperty('linkedAt')
      expect(typeof person?.linkedAt === 'string' && person.linkedAt.length > 0).toBeTruthy()

      const teamMembersResponse = await apiRequest(
        request,
        'GET',
        '/api/staff/team-members?pageSize=1&isActive=true',
        { token },
      )
      const teamMembersPayload = await readJsonSafe(teamMembersResponse) as TeamMemberResponse
      expect(teamMembersResponse.ok(), `team members should load: ${teamMembersResponse.status()}`).toBeTruthy()
      const userId =
        typeof teamMembersPayload.items?.[0]?.userId === 'string'
          ? teamMembersPayload.items[0].userId
          : typeof teamMembersPayload.items?.[0]?.user_id === 'string'
            ? teamMembersPayload.items[0].user_id
            : null
      expect(userId).toBeTruthy()

      const assignRoleResponse = await apiRequest(
        request,
        'POST',
        `/api/customers/companies/${encodeURIComponent(companyId)}/roles`,
        {
          token,
          data: {
            roleType: 'account_manager',
            userId,
          },
        },
      )
      expect(assignRoleResponse.ok(), `role create should succeed: ${assignRoleResponse.status()}`).toBeTruthy()

      const rolesResponse = await apiRequest(
        request,
        'GET',
        `/api/customers/companies/${encodeURIComponent(companyId)}/roles`,
        { token },
      )
      const rolesPayload = (await readJsonSafe<RolesResponse>(rolesResponse)) ?? {}
      expect(rolesResponse.ok(), `roles list should succeed: ${rolesResponse.status()}`).toBeTruthy()
      const roles = Array.isArray(rolesPayload.items) ? rolesPayload.items : []
      expect(roles).toHaveLength(1)
      expect(roles[0]).toHaveProperty('userPhone')
      expect(roles[0].userPhone ?? null).toBeNull()
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })
})
