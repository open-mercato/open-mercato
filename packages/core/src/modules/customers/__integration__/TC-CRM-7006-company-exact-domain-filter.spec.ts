import { expect, test, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'

const COMPANIES_PATH = '/api/customers/companies'
const ALL_ORGANIZATIONS = '__all__'

const readItemIds = async (response: APIResponse) => {
  expect(response.ok(), 'domain filter request should succeed').toBeTruthy()
  const body = await readJsonSafe<{ items?: Array<{ id?: string }> }>(response)
  return (body?.items ?? []).map((item) => item.id).sort()
}

test.describe('TC-CRM-7006: companies list filters by exact normalized domain', () => {
  test('matches the same domain in any spelling right after create and ignores subdomains', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const domain = `qa-exact-${stamp}.example.com`
    const createdIds: string[] = []

    const createCompany = async (displayName: string, domainValue: string) => {
      const response = await apiRequest(request, 'POST', COMPANIES_PATH, {
        token,
        data: { displayName, domain: domainValue },
      })
      expect(response.status(), 'company create should return 201').toBe(201)
      const id = expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'company id')
      createdIds.push(id)
      return id
    }

    const findIdsByDomain = async (value: string) =>
      readItemIds(
        await apiRequest(request, 'GET', `${COMPANIES_PATH}?domain=${encodeURIComponent(value)}&pageSize=10`, { token }),
      )

    try {
      const exactId = await createCompany(`QA Exact Domain ${stamp}`, `https://www.${domain.toUpperCase()}/`)
      await createCompany(`QA Subdomain ${stamp}`, `shop.${domain}`)

      expect(await findIdsByDomain(domain)).toEqual([exactId])
      expect(await findIdsByDomain(`@WWW.${domain.toUpperCase()}`)).toEqual([exactId])
      expect(await findIdsByDomain(`other-${domain}`)).toEqual([])
      for (const value of ['', 'https://', `https://${domain}/`, `${domain}\\other.com`, `jane@${domain}`]) {
        const invalid = await apiRequest(request, 'GET', `${COMPANIES_PATH}?domain=${encodeURIComponent(value)}`, { token })
        expect(invalid.status(), `"${value}" is not a domain and should be rejected`).toBe(400)
        expect((await readJsonSafe<{ code?: string }>(invalid))?.code).toBe('invalid_domain')
      }
    } finally {
      for (const id of createdIds) {
        await deleteGeneralEntityIfExists(request, token, COMPANIES_PATH, id)
      }
    }
  })

  test('does not return a company from an organization the caller cannot access', async ({ request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const scope = getTokenScope(adminToken)
    const stamp = Date.now()
    const domain = `qa-org-scope-${stamp}.example.com`
    let otherOrgId: string | null = null
    let homeCompanyId: string | null = null
    let otherCompanyId: string | null = null
    let roleId: string | null = null
    let restrictedUserId: string | null = null

    const createCompanyIn = async (organizationId: string, displayName: string) => {
      const response = await apiRequestWithSelectedOrg(request, 'POST', COMPANIES_PATH, {
        token: adminToken,
        selectedOrgId: organizationId,
        data: { displayName, domain },
      })
      expect(response.status(), 'company create should return 201').toBe(201)
      return expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'company id')
    }

    const findIdsByDomainAs = async (token: string, selectedOrgId: string) =>
      readItemIds(
        await apiRequestWithSelectedOrg(request, 'GET', `${COMPANIES_PATH}?domain=${encodeURIComponent(domain)}&pageSize=10`, {
          token,
          selectedOrgId,
        }),
      )

    try {
      otherOrgId = await createOrganizationFixture(request, adminToken, { name: `QA Domain Scope ${stamp}`, tenantId: scope.tenantId })
      homeCompanyId = await createCompanyIn(scope.organizationId, `QA Home Org ${stamp}`)
      otherCompanyId = await createCompanyIn(otherOrgId, `QA Other Org ${stamp}`)

      expect(await findIdsByDomainAs(adminToken, otherOrgId!)).toEqual([otherCompanyId])

      const roleName = `qa_domain_scope_${stamp}`
      roleId = await createRoleFixture(request, adminToken, { name: roleName, tenantId: scope.tenantId })
      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: ['customers.companies.view'],
        organizations: [scope.organizationId],
      })
      const restrictedEmail = `qa-domain-scope-${stamp}@acme.com`
      const restrictedPassword = 'Valid1!Pass'
      restrictedUserId = await createUserFixture(request, adminToken, {
        email: restrictedEmail,
        password: restrictedPassword,
        organizationId: scope.organizationId,
        roles: [roleName],
        name: 'QA Domain Scope Restricted',
      })
      const restrictedToken = await getAuthToken(request, restrictedEmail, restrictedPassword)

      expect(await findIdsByDomainAs(restrictedToken, ALL_ORGANIZATIONS)).toEqual([homeCompanyId])
    } finally {
      await deleteUserIfExists(request, adminToken, restrictedUserId)
      await deleteRoleIfExists(request, adminToken, roleId)
      await deleteGeneralEntityIfExists(request, adminToken, COMPANIES_PATH, homeCompanyId)
      if (otherOrgId && otherCompanyId) {
        await apiRequestWithSelectedOrg(request, 'DELETE', COMPANIES_PATH, {
          token: adminToken,
          selectedOrgId: otherOrgId,
          data: { id: otherCompanyId },
        }).catch(() => undefined)
      }
      await deleteOrganizationIfExists(request, adminToken, otherOrgId)
    }
  })

  test('finds a company stored in a child organization of the selected one', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const scope = getTokenScope(token)
    const stamp = Date.now()
    const domain = `qa-child-org-${stamp}.example.com`
    let childOrgId: string | null = null
    let childCompanyId: string | null = null

    try {
      childOrgId = await createOrganizationFixture(request, token, {
        name: `QA Domain Child ${stamp}`,
        tenantId: scope.tenantId,
        parentId: scope.organizationId,
      })
      const created = await apiRequestWithSelectedOrg(request, 'POST', COMPANIES_PATH, {
        token,
        selectedOrgId: childOrgId,
        data: { displayName: `QA Child Org ${stamp}`, domain },
      })
      expect(created.status(), 'company create should return 201').toBe(201)
      childCompanyId = expectId((await readJsonSafe<{ id?: string }>(created))?.id, 'company id')

      const fromParent = await apiRequestWithSelectedOrg(
        request,
        'GET',
        `${COMPANIES_PATH}?domain=${encodeURIComponent(domain)}&pageSize=10`,
        { token, selectedOrgId: scope.organizationId },
      )
      expect(await readItemIds(fromParent)).toEqual([childCompanyId])
    } finally {
      if (childOrgId && childCompanyId) {
        await apiRequestWithSelectedOrg(request, 'DELETE', COMPANIES_PATH, {
          token,
          selectedOrgId: childOrgId,
          data: { id: childCompanyId },
        }).catch(() => undefined)
      }
      await deleteOrganizationIfExists(request, token, childOrgId)
    }
  })
})
