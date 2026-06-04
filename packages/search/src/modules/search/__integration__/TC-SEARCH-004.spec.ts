import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  apiRequestWithSelectedOrg,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'

type SearchResultItem = { entityId?: string; presenter?: { title?: string } | null }
type SearchResponse = { results?: SearchResultItem[] }

const COMPANY_ENTITY = 'customers:customer_company_profile'
const VALID_PASSWORD = 'Valid1!Pass'

function titleOf(item: SearchResultItem): string {
  const presenter = item?.presenter
  const title = presenter && typeof presenter === 'object' ? (presenter as { title?: unknown }).title : undefined
  return typeof title === 'string' ? title : ''
}

async function searchTitles(request: APIRequestContext, token: string, query: string): Promise<string[]> {
  const params = new URLSearchParams({ q: query, limit: '20', entityTypes: COMPANY_ENTITY })
  const res = await apiRequest(request, 'GET', `/api/search/search?${params.toString()}`, { token })
  if (!res.ok()) return []
  const body = (await readJsonSafe<SearchResponse>(res)) ?? {}
  return (Array.isArray(body.results) ? body.results : []).map(titleOf)
}

/**
 * TC-SEARCH-004: search results are organization-scoped.
 * Source: issue #2483 (P0 — cross-tenant/org isolation).
 *
 * A company created in the admin's home org (orgA) must be invisible to a user
 * confined to a second organization (orgB) in the same tenant, while that user
 * still sees a company that lives in their own org. This exercises the
 * organization scope filter the search route applies. orgB, its scoped user, and
 * orgB's company are provisioned via API as superadmin; the test skips if a
 * second organization cannot be provisioned in this environment.
 */
test.describe('TC-SEARCH-004: search results are organization-scoped', () => {
  test('a restricted org-B user cannot see org-A companies via search', async ({ request }) => {
    test.slow()

    const stamp = Date.now()
    const unique = `QASRCH004${stamp}`
    let adminToken: string | null = null
    let superToken: string | null = null
    let orgBId: string | null = null
    let roleId: string | null = null
    let userBId: string | null = null
    let companyAId: string | null = null
    let companyBId: string | null = null
    const roleName = `qa-search-004-${stamp}`
    const userBEmail = `qa-search-004-${stamp}@acme.com`

    try {
      adminToken = await getAuthToken(request, 'admin')
      superToken = await getAuthToken(request, 'superadmin')
      const adminScope = getTokenScope(adminToken)

      // Provision a second organization in the admin's tenant (superadmin bypasses
      // the directory create command's tenant-selection enforcement).
      const orgResp = await apiRequest(request, 'POST', '/api/directory/organizations', {
        token: superToken,
        data: { name: `QA Search 004 OrgB ${stamp}`, tenantId: adminScope.tenantId },
      })
      if (orgResp.status() !== 201) {
        test.skip(true, `cannot provision a second organization in this environment (status ${orgResp.status()})`)
        return
      }
      orgBId = expectId((await readJsonSafe<{ id?: string }>(orgResp))?.id, 'organization create returns an id')

      // Company A in the admin's home org (orgA).
      companyAId = await createCompanyFixture(request, adminToken, `${unique} A`)

      // Company B placed into orgB via the selected-org cookie (superadmin).
      const companyBResp = await apiRequestWithSelectedOrg(request, 'POST', '/api/customers/companies', {
        token: superToken,
        selectedOrgId: orgBId,
        data: { displayName: `${unique} B` },
      })
      expect(companyBResp.status(), 'create company in orgB should return 201').toBe(201)
      companyBId = expectId((await readJsonSafe<{ id?: string }>(companyBResp))?.id, 'company B returns an id')

      // A user confined to orgB with search + customers read access.
      roleId = await createRoleFixture(request, adminToken, { name: roleName, tenantId: adminScope.tenantId })
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['search.view', 'customers.*'] })
      userBId = await createUserFixture(request, superToken, {
        email: userBEmail,
        password: VALID_PASSWORD,
        organizationId: orgBId,
        roles: [roleName],
        name: 'QA Search 004 OrgB User',
      })
      await setUserAclVisibility(request, superToken, {
        userId: userBId,
        organizations: [orgBId],
        features: ['search.view', 'customers.*'],
      })
      const userBToken = await getAuthToken(request, userBEmail, VALID_PASSWORD)
      expect(getTokenScope(userBToken).organizationId, 'org-B user is scoped to orgB').toBe(orgBId)

      // Admin (orgA) can find company A — confirms it is indexed and searchable.
      await expect
        .poll(async () => (await searchTitles(request, adminToken!, unique)).includes(`${unique} A`), {
          timeout: 15_000,
        })
        .toBe(true)

      // Org-B user can find company B (their own org) — confirms their search works.
      await expect
        .poll(async () => (await searchTitles(request, userBToken, unique)).includes(`${unique} B`), {
          timeout: 15_000,
        })
        .toBe(true)

      // Org-B user must NOT see company A (cross-org isolation — the P0 assertion).
      const orgBTitles = await searchTitles(request, userBToken, unique)
      expect(orgBTitles, 'org-B user must not see the org-A company').not.toContain(`${unique} A`)
    } finally {
      await deleteEntityIfExists(request, superToken, '/api/customers/companies', companyAId)
      await deleteEntityIfExists(request, superToken, '/api/customers/companies', companyBId)
      await deleteUserIfExists(request, superToken, userBId)
      await deleteRoleIfExists(request, adminToken, roleId)
      await deleteOrganizationIfExists(request, superToken, orgBId)
    }
  })
})
