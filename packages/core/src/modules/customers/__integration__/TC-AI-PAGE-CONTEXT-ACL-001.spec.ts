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

const USER_PASSWORD = 'Valid1!Pass'
const EXECUTE = '/api/ai_assistant/tools/execute'
const ALL_CRM_READ = ['ai_assistant.view', 'customers.people.view', 'customers.companies.view', 'customers.deals.view']

type ToolCall = { status: number; text: string }

async function runTool(
  request: APIRequestContext,
  token: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<ToolCall> {
  const response = await apiRequest(request, 'POST', EXECUTE, { token, data: { toolName, args } })
  return { status: response.status(), text: await response.text() }
}

async function createTenant(request: APIRequestContext, token: string, name: string): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/directory/tenants', { token, data: { name } })
  expect(response.status(), 'POST /api/directory/tenants should return 201').toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  if (!body?.id) throw new Error('[internal] tenant create response missing id')
  return body.id
}

/**
 * TC-AI-PAGE-CONTEXT-ACL-001: the customers page-context hydration path
 * (`hydrateCustomersAccountContext`) builds the model context from
 * `customers.get_person` / `customers.get_company` / `customers.get_deal`
 * with `includeRelated: true`. This spec drives those real tool handlers
 * through the in-process API runner with real, isolated callers — no tool
 * pack mocks and no model — and asserts that record data the caller may not
 * read never comes back: a permitted control sees the linked records; a
 * caller without `customers.deals.view` / `customers.people.view` loses the
 * related deals / people and is refused the record tool; callers in an
 * excluded organization, with an empty organization scope or in a foreign
 * tenant receive none of the records.
 */
test.describe('TC-AI-PAGE-CONTEXT-ACL-001: customers page-context tools honor caller ACL and scope', () => {
  test('returns only the records the caller may read', async ({ request }) => {
    test.slow()
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

    const createActor = async (input: {
      suffix: string
      token: string
      tenantId: string
      homeOrganizationId: string
      features: string[]
      visibleOrganizations?: string[]
    }): Promise<string> => {
      const roleName = `qa_ai_page_ctx_${input.suffix}_${stamp}`
      const roleId = await createRoleFixture(request, input.token, { name: roleName, tenantId: input.tenantId })
      roleIds.push(roleId)
      const aclResponse = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
        token: input.token,
        data: { roleId, features: input.features },
      })
      expect(aclResponse.ok(), 'PUT role ACL should succeed').toBeTruthy()
      const email = `qa-ai-page-ctx-${input.suffix}-${stamp}@acme.com`
      const userId = await createUserFixture(request, input.token, {
        email,
        password: USER_PASSWORD,
        organizationId: input.homeOrganizationId,
        roles: [roleName],
        name: `QA page context ${input.suffix}`,
      })
      userIds.push(userId)
      if (input.visibleOrganizations) {
        await setUserAclVisibility(request, input.token, {
          userId,
          organizations: input.visibleOrganizations,
          features: input.features,
        })
      }
      return getAuthToken(request, email, USER_PASSWORD)
    }

    try {
      adminToken = await getAuthToken(request, 'admin')
      superadminToken = await getAuthToken(request, 'superadmin')
      const scope = getTokenScope(adminToken)
      companyId = await createCompanyFixture(request, adminToken, `QA Page Ctx Co ${stamp}`)
      personId = await createPersonFixture(request, adminToken, {
        firstName: 'PageCtx',
        lastName: `Acl${stamp}`,
        displayName: `PageCtx Acl ${stamp}`,
        companyEntityId: companyId,
      })
      dealId = await createDealFixture(request, adminToken, {
        title: `QA Page Ctx Deal ${stamp}`,
        personIds: [personId],
        companyIds: [companyId],
      })
      const recordNames = [`QA Page Ctx Co ${stamp}`, `PageCtx Acl ${stamp}`, `QA Page Ctx Deal ${stamp}`]
      const getPerson = { personId, includeRelated: true }
      const getCompany = { companyId, includeRelated: true }
      const getDeal = { dealId, includeRelated: true }

      const permittedToken = await createActor({
        suffix: 'permitted',
        token: adminToken,
        tenantId: scope.tenantId,
        homeOrganizationId: scope.organizationId,
        features: ALL_CRM_READ,
      })
      const permittedCompany = await runTool(request, permittedToken, 'customers.get_company', getCompany)
      expect(permittedCompany.status, 'permitted get_company succeeds').toBe(200)
      expect(permittedCompany.text, 'permitted control sees the linked person').toContain(personId)
      expect(permittedCompany.text, 'permitted control sees the linked deal').toContain(dealId)
      const permittedPerson = await runTool(request, permittedToken, 'customers.get_person', getPerson)
      expect(permittedPerson.status, 'permitted get_person succeeds').toBe(200)
      expect(permittedPerson.text, 'permitted control sees the person deal').toContain(dealId)
      const permittedDeal = await runTool(request, permittedToken, 'customers.get_deal', getDeal)
      expect(permittedDeal.status, 'permitted get_deal succeeds').toBe(200)
      expect(permittedDeal.text, 'permitted control sees the deal').toContain(dealId)

      const noDealsToken = await createActor({
        suffix: 'nodeals',
        token: adminToken,
        tenantId: scope.tenantId,
        homeOrganizationId: scope.organizationId,
        features: ['ai_assistant.view', 'customers.people.view', 'customers.companies.view'],
      })
      const noDealsCompany = await runTool(request, noDealsToken, 'customers.get_company', getCompany)
      expect(noDealsCompany.status).toBe(200)
      expect(noDealsCompany.text, 'company context keeps permitted people').toContain(personId)
      expect(noDealsCompany.text, 'company context drops deals without customers.deals.view').not.toContain(dealId)
      const noDealsPerson = await runTool(request, noDealsToken, 'customers.get_person', getPerson)
      expect(noDealsPerson.status).toBe(200)
      expect(noDealsPerson.text, 'person context drops deals without customers.deals.view').not.toContain(dealId)
      const noDealsDeal = await runTool(request, noDealsToken, 'customers.get_deal', getDeal)
      expect(noDealsDeal.status, 'get_deal refused without customers.deals.view').not.toBe(200)
      expect(noDealsDeal.text).not.toContain(dealId)

      const noPeopleToken = await createActor({
        suffix: 'nopeople',
        token: adminToken,
        tenantId: scope.tenantId,
        homeOrganizationId: scope.organizationId,
        features: ['ai_assistant.view', 'customers.companies.view', 'customers.deals.view'],
      })
      const noPeopleCompany = await runTool(request, noPeopleToken, 'customers.get_company', getCompany)
      expect(noPeopleCompany.status).toBe(200)
      expect(noPeopleCompany.text, 'company context drops people without customers.people.view').not.toContain(personId)
      expect(noPeopleCompany.text, 'company context keeps permitted deals').toContain(dealId)
      const noPeoplePerson = await runTool(request, noPeopleToken, 'customers.get_person', getPerson)
      expect(noPeoplePerson.status, 'get_person refused without customers.people.view').not.toBe(200)
      expect(noPeoplePerson.text).not.toContain(personId)

      const otherOrganizationId = await createOrganizationFixture(request, adminToken, {
        name: `QA Page Ctx Other Org ${stamp}`,
        tenantId: scope.tenantId,
      })
      organizationIds.push(otherOrganizationId)
      const excludedOrgToken = await createActor({
        suffix: 'excludedorg',
        token: adminToken,
        tenantId: scope.tenantId,
        homeOrganizationId: otherOrganizationId,
        features: ALL_CRM_READ,
        visibleOrganizations: [otherOrganizationId],
      })

      const emptyScopeToken = await createActor({
        suffix: 'emptyscope',
        token: adminToken,
        tenantId: scope.tenantId,
        homeOrganizationId: scope.organizationId,
        features: ALL_CRM_READ,
        visibleOrganizations: [],
      })

      foreignTenantId = await createTenant(request, superadminToken, `QA Page Ctx Tenant ${stamp}`)
      const foreignOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA Page Ctx Foreign Org ${stamp}`,
        tenantId: foreignTenantId,
      })
      organizationIds.push(foreignOrganizationId)
      const foreignTenantToken = await createActor({
        suffix: 'foreigntenant',
        token: superadminToken,
        tenantId: foreignTenantId,
        homeOrganizationId: foreignOrganizationId,
        features: ALL_CRM_READ,
      })

      const outOfScope: Array<[string, string]> = [
        ['excluded organization', excludedOrgToken],
        ['empty organization scope', emptyScopeToken],
        ['foreign tenant', foreignTenantToken],
      ]
      for (const [label, token] of outOfScope) {
        for (const [toolName, args] of [
          ['customers.get_person', getPerson],
          ['customers.get_company', getCompany],
          ['customers.get_deal', getDeal],
        ] as const) {
          const call = await runTool(request, token, toolName, args)
          if (call.status === 200) {
            const body = JSON.parse(call.text) as { result?: { found?: boolean } }
            expect(body.result?.found, `${label}: ${toolName} must report found=false`).toBe(false)
          }
          for (const recordName of recordNames) {
            expect(call.text, `${label}: ${toolName} must not disclose "${recordName}"`).not.toContain(recordName)
          }
        }
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
