import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

type Resource = {
  path: string
  build: (label: string) => Record<string, unknown>
}

const RESOURCES: Record<'deals' | 'companies' | 'people', Resource> = {
  deals: { path: '/api/customers/deals', build: (label) => ({ title: label }) },
  companies: { path: '/api/customers/companies', build: (label) => ({ displayName: label }) },
  people: {
    path: '/api/customers/people',
    build: (label) => ({ firstName: label.split(' ')[0], lastName: label.split(' ')[1], displayName: label }),
  },
}

type CleanupFailure = { resource: string; id: string; status: string }

async function attemptCleanup(
  failures: CleanupFailure[],
  resource: string,
  id: string,
  remove: () => Promise<APIResponse>,
): Promise<void> {
  try {
    const response = await remove()
    if (!response.ok() && response.status() !== 404) {
      failures.push({ resource, id, status: `HTTP ${response.status()}` })
    }
  } catch (error) {
    failures.push({ resource, id, status: error instanceof Error ? error.message : String(error) })
  }
}

function deleteOrganization(request: APIRequestContext, token: string, organizationId: string): Promise<APIResponse> {
  return apiRequest(request, 'DELETE', '/api/directory/organizations', { token, data: { id: organizationId } })
}

function scopeHeaders(tenantId: string, organizationId: string | null): Record<string, string> {
  const organizationCookie = organizationId ? `om_selected_org=${organizationId}` : 'om_selected_org=__all__'
  return { Cookie: `om_selected_tenant=${tenantId}; ${organizationCookie}` }
}

async function createRecord(
  request: APIRequestContext,
  token: string,
  tenantId: string,
  organizationId: string,
  resource: Resource,
  label: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', resource.path, {
    token,
    headers: scopeHeaders(tenantId, organizationId),
    data: resource.build(label),
  })
  expect(response.status(), `POST ${resource.path} should create the fixture`).toBe(201)
  const body = await readJsonSafe<{ id?: string; entityId?: string; dealId?: string }>(response)
  return expectId(body?.id ?? body?.entityId ?? body?.dealId, `${resource.path} create response should include an id`)
}

async function searchIds(
  request: APIRequestContext,
  token: string,
  headers: Record<string, string> | undefined,
  resource: Resource,
  term: string,
): Promise<string[]> {
  const response = await apiRequest(
    request,
    'GET',
    `${resource.path}?search=${encodeURIComponent(term)}&page=1&pageSize=50`,
    { token, headers },
  )
  expect(response.status(), `GET ${resource.path}?search should return 200`).toBe(200)
  const body = await readJsonSafe<{ items?: Array<{ id?: string }> }>(response)
  return (body?.items ?? []).map((item) => item.id ?? '').filter((id) => id.length > 0).sort()
}

async function aggregateSearchCount(
  request: APIRequestContext,
  token: string,
  headers: Record<string, string>,
  term: string,
): Promise<number> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/customers/deals/aggregate?search=${encodeURIComponent(term)}`,
    { token, headers },
  )
  expect(response.status(), 'GET /api/customers/deals/aggregate?search should return 200').toBe(200)
  const body = await readJsonSafe<{ perStage?: Array<{ count?: number }> }>(response)
  return (body?.perStage ?? []).reduce((sum, stage) => sum + (stage.count ?? 0), 0)
}

/**
 * Issue #9007: with a parent organization selected, list search on deals, companies and
 * people must match records of the selected organization AND its descendants (the same
 * scope the unfiltered list shows), without widening beyond the caller's allowed organizations.
 */
test.describe('TC-CRM-9007: customer list search covers descendant organizations', () => {
  test('search matches parent and child organization records, and never widens the scope', async ({ request }) => {
    test.setTimeout(120_000)
    const superadminToken = await getAuthToken(request, 'superadmin')
    const tenantId = expectId(getTokenScope(await getAuthToken(request, 'admin')).tenantId, 'fixture tenant')
    const stamp = randomUUID().replace(/-/g, '').slice(0, 10)
    const term = `zeta${stamp}`
    const password = `Aa1!${randomUUID()}`
    const organizations: string[] = []
    const records: Array<{ path: string; id: string; organizationId: string }> = []
    let roleId: string | null = null
    let userId: string | null = null
    const cleanupFailures: CleanupFailure[] = []

    try {
      const parentId = await createOrganizationFixture(request, superadminToken, { name: `QA 9007 parent ${stamp}`, tenantId })
      organizations.push(parentId)
      const childId = await createOrganizationFixture(request, superadminToken, {
        name: `QA 9007 child ${stamp}`,
        tenantId,
        parentId,
      })
      organizations.push(childId)

      const expected: Record<string, { parent: string; child: string }> = {}
      for (const [key, resource] of Object.entries(RESOURCES)) {
        const parentRecordId = await createRecord(request, superadminToken, tenantId, parentId, resource, `${term} parent`)
        records.push({ path: resource.path, id: parentRecordId, organizationId: parentId })
        const childRecordId = await createRecord(request, superadminToken, tenantId, childId, resource, `${term} child`)
        records.push({ path: resource.path, id: childRecordId, organizationId: childId })
        expected[key] = { parent: parentRecordId, child: childRecordId }
      }

      for (const [key, resource] of Object.entries(RESOURCES)) {
        const both = [expected[key].parent, expected[key].child].sort()
        await expect
          .poll(() => searchIds(request, superadminToken, scopeHeaders(tenantId, parentId), resource, term), {
            message: `${key}: parent selection must find parent and child matches`,
            timeout: 30_000,
          })
          .toEqual(both)
        expect(await searchIds(request, superadminToken, scopeHeaders(tenantId, childId), resource, term)).toEqual([
          expected[key].child,
        ])
        expect(await searchIds(request, superadminToken, scopeHeaders(tenantId, null), resource, term)).toEqual(both)
      }

      roleId = await createRoleFixture(request, superadminToken, { name: `qa-9007-${stamp}`, tenantId })
      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        features: ['customers.people.view', 'customers.companies.view', 'customers.deals.view'],
        organizations: [childId],
      })
      const email = `qa-9007-${stamp}@example.test`
      userId = await createUserFixture(request, superadminToken, {
        email,
        password,
        organizationId: childId,
        roles: [roleId],
      })
      const childOnlyToken = await getAuthToken(request, email, password)

      for (const [key, resource] of Object.entries(RESOURCES)) {
        expect(await searchIds(request, childOnlyToken, undefined, resource, term), `${key}: child-only user`).toEqual([
          expected[key].child,
        ])
        const parentAttempt = await searchIds(
          request,
          childOnlyToken,
          { Cookie: `om_selected_org=${parentId}` },
          resource,
          term,
        )
        expect(parentAttempt, `${key}: child-only user selecting the parent`).not.toContain(expected[key].parent)
      }
    } finally {
      if (userId) {
        const id = userId
        await attemptCleanup(cleanupFailures, '/api/auth/users', id, () =>
          apiRequest(request, 'DELETE', `/api/auth/users?id=${encodeURIComponent(id)}`, { token: superadminToken }),
        )
      }
      if (roleId) {
        const id = roleId
        await attemptCleanup(cleanupFailures, '/api/auth/roles', id, () =>
          apiRequest(request, 'DELETE', `/api/auth/roles?id=${encodeURIComponent(id)}`, { token: superadminToken }),
        )
      }
      for (const record of records.reverse()) {
        await attemptCleanup(cleanupFailures, record.path, record.id, () =>
          apiRequest(request, 'DELETE', `${record.path}?id=${encodeURIComponent(record.id)}`, {
            token: superadminToken,
            headers: scopeHeaders(tenantId, record.organizationId),
          }),
        )
      }
      for (const organizationId of organizations.reverse()) {
        await attemptCleanup(cleanupFailures, '/api/directory/organizations', organizationId, () =>
          deleteOrganization(request, superadminToken, organizationId),
        )
      }
      expect.soft(cleanupFailures, 'fixture cleanup must delete every created record').toEqual([])
    }
  })

  test('deals aggregate search counts deals of the selected organization and its descendants', async ({ request }) => {
    test.setTimeout(120_000)
    const superadminToken = await getAuthToken(request, 'superadmin')
    const tenantId = expectId(getTokenScope(await getAuthToken(request, 'admin')).tenantId, 'fixture tenant')
    const stamp = randomUUID().replace(/-/g, '').slice(0, 10)
    const term = `kappa${stamp}`
    const organizations: string[] = []
    const deals: Array<{ id: string; organizationId: string }> = []
    const cleanupFailures: CleanupFailure[] = []

    try {
      const parentId = await createOrganizationFixture(request, superadminToken, { name: `QA 9007 agg parent ${stamp}`, tenantId })
      organizations.push(parentId)
      const childId = await createOrganizationFixture(request, superadminToken, {
        name: `QA 9007 agg child ${stamp}`,
        tenantId,
        parentId,
      })
      organizations.push(childId)
      for (const [organizationId, suffix] of [[parentId, 'parent'], [childId, 'child']] as const) {
        const id = await createRecord(request, superadminToken, tenantId, organizationId, RESOURCES.deals, `${term} ${suffix}`)
        deals.push({ id, organizationId })
      }

      await expect
        .poll(() => aggregateSearchCount(request, superadminToken, scopeHeaders(tenantId, parentId), term), {
          message: 'deals aggregate: parent selection must count parent and child matches',
          timeout: 30_000,
        })
        .toBe(2)
      expect(await aggregateSearchCount(request, superadminToken, scopeHeaders(tenantId, childId), term)).toBe(1)
      expect(await aggregateSearchCount(request, superadminToken, scopeHeaders(tenantId, null), term)).toBe(2)
    } finally {
      for (const deal of deals.reverse()) {
        await attemptCleanup(cleanupFailures, RESOURCES.deals.path, deal.id, () =>
          apiRequest(request, 'DELETE', `${RESOURCES.deals.path}?id=${encodeURIComponent(deal.id)}`, {
            token: superadminToken,
            headers: scopeHeaders(tenantId, deal.organizationId),
          }),
        )
      }
      for (const organizationId of organizations.reverse()) {
        await attemptCleanup(cleanupFailures, '/api/directory/organizations', organizationId, () =>
          deleteOrganization(request, superadminToken, organizationId),
        )
      }
      expect.soft(cleanupFailures, 'fixture cleanup must delete every created record').toEqual([])
    }
  })
})
