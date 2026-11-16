import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  deleteGeneralEntityIfExists,
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setUserAclVisibility,
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
const CRM_READ_FEATURES = ['customers.people.view', 'customers.companies.view', 'customers.deals.view']

async function readDetail(request: APIRequestContext, token: string, path: string): Promise<DetailPayload> {
  const response = await apiRequest(request, 'GET', path, { token })
  expect(response.status(), `GET ${path}`).toBe(200)
  return (await readJsonSafe<DetailPayload>(response)) ?? {}
}

function ids(items: Array<{ id: string }> | undefined): string[] {
  return (items ?? []).map((item) => item.id)
}

async function createTenant(request: APIRequestContext, token: string, name: string): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/directory/tenants', { token, data: { name } })
  expect(response.status(), 'POST /api/directory/tenants should return 201').toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  if (!body?.id) throw new Error('[internal] tenant create response missing id')
  return body.id
}

async function expectRecordHidden(
  request: APIRequestContext,
  token: string,
  path: string,
  hiddenIds: string[],
  label: string,
): Promise<void> {
  const response = await apiRequest(request, 'GET', path, { token })
  expect([403, 404], `${label}: GET ${path} must be refused`).toContain(response.status())
  const body = await response.text()
  for (const hiddenId of hiddenIds) {
    expect(body, `${label}: GET ${path} must not disclose ${hiddenId}`).not.toContain(hiddenId)
  }
}

/**
 * TC-CRM-DETAIL-INCLUDE-ACL-001: person/company detail `include` tokens honor
 * the feature that guards the included entity. A caller who can read people or
 * companies but not deals must not receive linked deals via `?include=deals`,
 * and a company reader without `customers.people.view` must not receive linked
 * people via `?include=people` or the company people list endpoint.
 * Include features are evaluated in the record's organization, and callers
 * outside the record's organization or tenant (excluded organization, empty
 * organization scope, foreign tenant) receive no record data.
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
      const linkedPeoplePath = `/api/customers/companies/${companyId}/people`
      const linkedPeople = await apiRequest(request, 'GET', linkedPeoplePath, { token: noDealsToken })
      expect(linkedPeople.status(), 'company people list allowed with customers.people.view').toBe(200)
      const linkedPeopleBody = await readJsonSafe<{ items?: Array<{ id: string }> }>(linkedPeople)
      expect(ids(linkedPeopleBody?.items), 'company people list returns the linked person').toContain(personId)

      const noPeopleToken = await createRestrictedUser('nopeople', ['customers.companies.view', 'customers.deals.view'])
      const companyOnly = await readDetail(request, noPeopleToken, companyPath)
      expect(ids(companyOnly.people), 'people hidden without customers.people.view').not.toContain(personId)
      expect(ids(companyOnly.deals), 'deals still visible with customers.deals.view').toContain(dealId)
      const deniedPeople = await apiRequest(request, 'GET', linkedPeoplePath, { token: noPeopleToken })
      expect(deniedPeople.status(), 'company people list refused without customers.people.view').toBe(403)
    } finally {
      await deleteEntityIfExists(request, adminToken, '/api/customers/deals', dealId)
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId)
      await deleteEntityIfExists(request, adminToken, '/api/customers/companies', companyId)
      for (const userId of userIds) await deleteUserIfExists(request, adminToken, userId)
      for (const roleId of roleIds) await deleteRoleIfExists(request, adminToken, roleId)
    }
  })

  test('keeps includes for the record organization and hides records outside the caller scope', async ({ request }) => {
    const stamp = Date.now()
    let adminToken: string | null = null
    let superadminToken: string | null = null
    const roleIds: string[] = []
    const userIds: string[] = []
    const organizationIds: string[] = []
    let foreignTenantId: string | null = null
    let companyId: string | null = null
    let personId: string | null = null
    let dealId: string | null = null

    const createScopedUser = async (input: {
      suffix: string
      token: string
      tenantId: string
      homeOrganizationId: string
      visibleOrganizations?: string[]
    }): Promise<string> => {
      const roleName = `qa_crm_detail_scope_${input.suffix}_${stamp}`
      const roleId = await createRoleFixture(request, input.token, { name: roleName, tenantId: input.tenantId })
      roleIds.push(roleId)
      const aclResponse = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
        token: input.token,
        data: { roleId, features: CRM_READ_FEATURES },
      })
      expect(aclResponse.ok(), 'PUT role ACL should succeed').toBeTruthy()
      const email = `qa-crm-detail-scope-${input.suffix}-${stamp}@acme.com`
      const userId = await createUserFixture(request, input.token, {
        email,
        password: USER_PASSWORD,
        organizationId: input.homeOrganizationId,
        roles: [roleName],
        name: `QA detail scope ${input.suffix}`,
      })
      userIds.push(userId)
      if (input.visibleOrganizations) {
        await setUserAclVisibility(request, input.token, {
          userId,
          organizations: input.visibleOrganizations,
          features: CRM_READ_FEATURES,
        })
      }
      return getAuthToken(request, email, USER_PASSWORD)
    }

    try {
      adminToken = await getAuthToken(request, 'admin')
      superadminToken = await getAuthToken(request, 'superadmin')
      const scope = getTokenScope(adminToken)
      companyId = await createCompanyFixture(request, adminToken, `QA Scope Co ${stamp}`)
      personId = await createPersonFixture(request, adminToken, {
        firstName: 'Scope',
        lastName: `Acl${stamp}`,
        displayName: `Scope Acl ${stamp}`,
        companyEntityId: companyId,
      })
      dealId = await createDealFixture(request, adminToken, {
        title: `QA Scope Deal ${stamp}`,
        personIds: [personId],
        companyIds: [companyId],
      })
      const recordIds = [companyId, personId, dealId]
      const personPath = `/api/customers/people/${personId}?include=deals`
      const companyPath = `/api/customers/companies/${companyId}?include=deals,people`
      const linkedPeoplePath = `/api/customers/companies/${companyId}/people`

      const otherOrganizationId = await createOrganizationFixture(request, adminToken, {
        name: `QA Scope Other Org ${stamp}`,
        tenantId: scope.tenantId,
      })
      organizationIds.push(otherOrganizationId)

      const recordOrgToken = await createScopedUser({
        suffix: 'recordorg',
        token: adminToken,
        tenantId: scope.tenantId,
        homeOrganizationId: otherOrganizationId,
        visibleOrganizations: [scope.organizationId],
      })
      const recordOrgPerson = await readDetail(request, recordOrgToken, personPath)
      expect(ids(recordOrgPerson.deals), 'record-org reader keeps deals on the person').toContain(dealId)
      const recordOrgCompany = await readDetail(request, recordOrgToken, companyPath)
      expect(ids(recordOrgCompany.deals), 'record-org reader keeps deals on the company').toContain(dealId)
      expect(ids(recordOrgCompany.people), 'record-org reader keeps people on the company').toContain(personId)

      const excludedOrgToken = await createScopedUser({
        suffix: 'excludedorg',
        token: adminToken,
        tenantId: scope.tenantId,
        homeOrganizationId: otherOrganizationId,
        visibleOrganizations: [otherOrganizationId],
      })
      const emptyScopeToken = await createScopedUser({
        suffix: 'emptyscope',
        token: adminToken,
        tenantId: scope.tenantId,
        homeOrganizationId: scope.organizationId,
        visibleOrganizations: [],
      })

      foreignTenantId = await createTenant(request, superadminToken, `QA Scope Tenant ${stamp}`)
      const foreignOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA Scope Foreign Org ${stamp}`,
        tenantId: foreignTenantId,
      })
      organizationIds.push(foreignOrganizationId)
      const foreignTenantToken = await createScopedUser({
        suffix: 'foreigntenant',
        token: superadminToken,
        tenantId: foreignTenantId,
        homeOrganizationId: foreignOrganizationId,
      })

      const deniedActors: Array<[string, string]> = [
        ['excluded organization', excludedOrgToken],
        ['empty organization scope', emptyScopeToken],
        ['foreign tenant', foreignTenantToken],
      ]
      for (const [label, token] of deniedActors) {
        await expectRecordHidden(request, token, personPath, recordIds, label)
        await expectRecordHidden(request, token, companyPath, recordIds, label)
        await expectRecordHidden(request, token, linkedPeoplePath, recordIds, label)
      }
    } finally {
      await deleteEntityIfExists(request, adminToken, '/api/customers/deals', dealId)
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId)
      await deleteEntityIfExists(request, adminToken, '/api/customers/companies', companyId)
      for (const userId of userIds) await deleteUserIfExists(request, superadminToken, userId)
      for (const roleId of roleIds) await deleteRoleIfExists(request, superadminToken, roleId)
      for (const organizationId of organizationIds) {
        await deleteOrganizationIfExists(request, superadminToken, organizationId)
      }
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', foreignTenantId)
    }
  })
})
