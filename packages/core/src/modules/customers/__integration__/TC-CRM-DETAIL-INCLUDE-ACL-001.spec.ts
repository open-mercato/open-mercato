import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  createCompanyFixture,
  createDealFixture,
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'

type DetailPayload = {
  deals?: Array<{ id: string }>
  people?: Array<{ id: string }>
}

const USER_PASSWORD = 'Valid1!Pass'

async function readDetail(request: APIRequestContext, token: string, path: string): Promise<DetailPayload> {
  const response = await apiRequest(request, 'GET', path, { token })
  expect(response.status(), `GET ${path}`).toBe(200)
  return (await readJsonSafe<DetailPayload>(response)) ?? {}
}

function ids(items: Array<{ id: string }> | undefined): string[] {
  return (items ?? []).map((item) => item.id)
}

/**
 * TC-CRM-DETAIL-INCLUDE-ACL-001: person/company detail `include` tokens honor
 * the feature that guards the included entity. A caller who can read people or
 * companies but not deals must not receive linked deals via `?include=deals`,
 * and a company reader without `customers.people.view` must not receive linked
 * people via `?include=people`.
 */
test.describe('TC-CRM-DETAIL-INCLUDE-ACL-001: detail includes require the included entity feature', () => {
  test('drops deals and people the caller is not allowed to view', async ({ request }) => {
    const stamp = Date.now()
    let adminToken: string | null = null
    const roleIds: string[] = []
    const userIds: string[] = []
    let companyId: string | null = null
    let personId: string | null = null
    let dealId: string | null = null

    const createRestrictedUser = async (suffix: string, features: string[]): Promise<string> => {
      if (!adminToken) throw new Error('[internal] admin token missing')
      const scope = getTokenScope(adminToken)
      const roleName = `qa_crm_detail_include_${suffix}_${stamp}`
      const roleId = await createRoleFixture(request, adminToken, { name: roleName, tenantId: scope.tenantId })
      roleIds.push(roleId)
      const aclResponse = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
        token: adminToken,
        data: { roleId, features },
      })
      expect(aclResponse.ok(), 'PUT role ACL should succeed').toBeTruthy()
      const email = `qa-crm-detail-include-${suffix}-${stamp}@acme.com`
      userIds.push(await createUserFixture(request, adminToken, {
        email,
        password: USER_PASSWORD,
        organizationId: scope.organizationId,
        roles: [roleName],
        name: `QA detail include ${suffix}`,
      }))
      return getAuthToken(request, email, USER_PASSWORD)
    }

    try {
      adminToken = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, adminToken, `QA Include Co ${stamp}`)
      personId = await createPersonFixture(request, adminToken, {
        firstName: 'Include',
        lastName: `Acl${stamp}`,
        displayName: `Include Acl ${stamp}`,
        companyEntityId: companyId,
      })
      dealId = await createDealFixture(request, adminToken, {
        title: `QA Include Deal ${stamp}`,
        personIds: [personId],
        companyIds: [companyId],
      })

      const personPath = `/api/customers/people/${personId}?include=deals`
      const companyPath = `/api/customers/companies/${companyId}?include=deals,people`

      const adminPerson = await readDetail(request, adminToken, personPath)
      expect(ids(adminPerson.deals), 'admin sees the linked deal on the person').toContain(dealId)
      const adminCompany = await readDetail(request, adminToken, companyPath)
      expect(ids(adminCompany.deals), 'admin sees the linked deal on the company').toContain(dealId)
      expect(ids(adminCompany.people), 'admin sees the linked person on the company').toContain(personId)

      const noDealsToken = await createRestrictedUser('nodeals', ['customers.people.view', 'customers.companies.view'])
      const restrictedPerson = await readDetail(request, noDealsToken, personPath)
      expect(ids(restrictedPerson.deals), 'deals hidden without customers.deals.view').not.toContain(dealId)
      const restrictedCompany = await readDetail(request, noDealsToken, companyPath)
      expect(ids(restrictedCompany.deals), 'company deals hidden without customers.deals.view').not.toContain(dealId)
      expect(ids(restrictedCompany.people), 'people still visible with customers.people.view').toContain(personId)

      const noPeopleToken = await createRestrictedUser('nopeople', ['customers.companies.view', 'customers.deals.view'])
      const companyOnly = await readDetail(request, noPeopleToken, companyPath)
      expect(ids(companyOnly.people), 'people hidden without customers.people.view').not.toContain(personId)
      expect(ids(companyOnly.deals), 'deals still visible with customers.deals.view').toContain(dealId)
    } finally {
      await deleteEntityIfExists(request, adminToken, '/api/customers/deals', dealId)
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId)
      await deleteEntityIfExists(request, adminToken, '/api/customers/companies', companyId)
      for (const userId of userIds) await deleteUserIfExists(request, adminToken, userId)
      for (const roleId of roleIds) await deleteRoleIfExists(request, adminToken, roleId)
    }
  })
})
