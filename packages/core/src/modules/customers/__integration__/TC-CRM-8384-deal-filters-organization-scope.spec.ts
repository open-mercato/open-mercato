import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  createCompanyFixture,
  createDealFixture,
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

test('TC-CRM-8384 applies deal list filters with or without an organization cookie', async ({ request, playwright, baseURL }) => {
  const adminToken = await getAuthToken(request, 'admin')
  const superadminToken = await getAuthToken(request, 'superadmin')
  const { tenantId, organizationId } = getTokenContext(adminToken)
  expect(tenantId).toBeTruthy()
  expect(organizationId).toBeTruthy()

  const marker = randomUUID()
  const bearerRequest = await playwright.request.newContext({ baseURL })
  let otherOrganizationId: string | null = null
  let restrictedUserId: string | null = null
  let linkedCompanyId: string | null = null
  let otherCompanyId: string | null = null
  let personId: string | null = null
  let overdueDealId: string | null = null
  let otherDealId: string | null = null

  try {
    otherOrganizationId = await createOrganizationFixture(request, superadminToken, {
      name: `TC-CRM-8384 other organization ${marker}`,
      tenantId,
    })
    linkedCompanyId = await createCompanyFixture(request, adminToken, `TC-CRM-8384 linked ${marker}`)
    otherCompanyId = await createCompanyFixture(request, adminToken, `TC-CRM-8384 other ${marker}`)
    personId = await createPersonFixture(request, adminToken, {
      firstName: 'Deal', lastName: marker, displayName: `TC-CRM-8384 ${marker}`,
    })
    overdueDealId = await createDealFixture(request, adminToken, {
      title: `TC-CRM-8384 overdue ${marker}`,
      status: 'open',
      expectedCloseAt: '2000-01-01T00:00:00.000Z',
      companyIds: [linkedCompanyId],
      personIds: [personId],
    })
    otherDealId = await createDealFixture(request, adminToken, {
      title: `TC-CRM-8384 other ${marker}`,
      status: 'open',
      companyIds: [otherCompanyId],
    })
    await withClient(async (client) => {
      const scopeParams = [overdueDealId, tenantId, organizationId]
      const updated = await client.query(
        `UPDATE customer_deals SET created_at = CURRENT_TIMESTAMP - INTERVAL '366 days'
         WHERE id = $1 AND tenant_id = $2 AND organization_id = $3`,
        scopeParams,
      )
      expect(updated.rowCount, 'only the overdue fixture deal was backdated').toBe(1)
      await client.query(
        `UPDATE customer_deal_stage_transitions SET transitioned_at = CURRENT_TIMESTAMP - INTERVAL '366 days'
         WHERE deal_id = $1 AND tenant_id = $2 AND organization_id = $3`,
        scopeParams,
      )
    })

    const dealIds = [overdueDealId, otherDealId].join(',')
    const tenantCookie = `om_selected_tenant=${tenantId}`
    const deniedQuery = new URLSearchParams({ ids: dealIds, needsAttention: 'true' })
    const filteredPath = `/api/customers/deals?${deniedQuery}`
    const anonymous = await bearerRequest.get(filteredPath)
    expect(anonymous.status(), 'unauthenticated deal filter request').toBe(401)

    const restrictedEmail = `crm-8384-${marker}@example.com`
    const restrictedPassword = `Aa1!${marker}`
    restrictedUserId = await createUserFixture(request, adminToken, {
      email: restrictedEmail, password: restrictedPassword, organizationId, roles: [],
    })
    await setUserAclVisibility(request, adminToken, {
      userId: restrictedUserId, organizations: [organizationId], features: ['customers.people.view'],
    })
    const restrictedToken = await getAuthToken(request, restrictedEmail, restrictedPassword)
    const allowed = await apiRequest(bearerRequest, 'GET', `/api/customers/people?id=${personId}`, { token: restrictedToken })
    expect(allowed.status(), 'restricted token retains people access').toBe(200)
    const denied = await apiRequest(bearerRequest, 'GET', filteredPath, { token: restrictedToken })
    expect(denied.status(), 'deal filter request without customers.deals.view').toBe(403)

    const scopes = [
      { name: 'without an organization cookie', cookie: tenantCookie, includesFixtures: true },
      {
        name: 'in the fixture organization',
        cookie: `${tenantCookie}; om_selected_org=${organizationId}`,
        includesFixtures: true,
      },
      {
        name: 'in a different organization',
        cookie: `${tenantCookie}; om_selected_org=${otherOrganizationId}`,
        includesFixtures: false,
      },
    ]
    const cases: Array<{ name: string; filters: Record<string, string>; expectedIds: string[] }> = [
      { name: 'unfiltered', filters: {}, expectedIds: [overdueDealId, otherDealId] },
      { name: 'stuck', filters: { isStuck: 'true' }, expectedIds: [overdueDealId] },
      { name: 'needs attention', filters: { needsAttention: 'true' }, expectedIds: [overdueDealId] },
      { name: 'person', filters: { personId }, expectedIds: [overdueDealId] },
      { name: 'company', filters: { companyId: linkedCompanyId }, expectedIds: [overdueDealId] },
    ]

    for (const { name, filters, expectedIds } of cases) {
      for (const scope of scopes) {
        const query = new URLSearchParams({ ids: dealIds, ...filters })
        const response = await apiRequest(bearerRequest, 'GET', `/api/customers/deals?${query}`, {
          token: superadminToken,
          headers: { Cookie: scope.cookie },
        })
        const description = `${name} deals ${scope.name}`
        const scopedIds = scope.includesFixtures ? expectedIds : []
        expect(response.status(), description).toBe(200)
        const body = await readJsonSafe<{ items: { id: string }[]; total: number }>(response)
        expect.soft(body?.items.map(({ id }) => id).sort(), description).toEqual([...scopedIds].sort())
        expect.soft(body?.total, description).toBe(scopedIds.length)
      }
    }
  } finally {
    await bearerRequest.dispose()
    await deleteEntityIfExists(request, adminToken, '/api/customers/deals', otherDealId)
    await deleteEntityIfExists(request, adminToken, '/api/customers/deals', overdueDealId)
    await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId)
    await deleteEntityIfExists(request, adminToken, '/api/customers/companies', otherCompanyId)
    await deleteEntityIfExists(request, adminToken, '/api/customers/companies', linkedCompanyId)
    await deleteUserIfExists(request, adminToken, restrictedUserId)
    await deleteOrganizationIfExists(request, superadminToken, otherOrganizationId)
  }
})
