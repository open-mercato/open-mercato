import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'

type Resource = 'orders' | 'quotes'
type Scope = { tenantId: string; organizationId: string }
type DocumentFixture = { resource: Resource; id: string; number: string; scope: Scope }
type DocumentRow = {
  id: string
  organizationId: string
  recurrence: { periodCount: number; locked: boolean } | null
  canManageRecurrence?: boolean
}

const resources = ['orders', 'quotes'] as const
const viewFeatures = resources.map((resource) => `sales.${resource}.view`)
const manageFeatures = [...viewFeatures, ...resources.map((resource) => `sales.${resource}.manage`)]

function scopeHeaders(scope: Scope) {
  return { Cookie: `om_selected_tenant=${scope.tenantId}; om_selected_org=${scope.organizationId}` }
}

function documentPath(resource: Resource) {
  return `/api/sales/${resource}`
}

function readPaths(document: DocumentFixture) {
  const path = documentPath(document.resource)
  return [`${path}?search=${encodeURIComponent(document.number)}`, `${path}?id=${document.id}`]
}

async function expectVisible(
  request: APIRequestContext,
  token: string,
  scope: Scope,
  document: DocumentFixture,
  recurrence: { periodCount: number; locked?: boolean },
  canManageRecurrence?: boolean,
) {
  for (const path of readPaths(document)) {
    const response = await apiRequest(request, 'GET', path, { token, headers: scopeHeaders(scope) })
    expect(response.status(), path).toBe(200)
    const body = await readJsonSafe<{ items: DocumentRow[] }>(response)
    expect(body?.items, path).toEqual([
      expect.objectContaining({
        id: document.id,
        organizationId: document.scope.organizationId,
        recurrence: expect.objectContaining(recurrence),
      }),
    ])
    if (canManageRecurrence !== undefined) {
      expect(body?.items[0]?.canManageRecurrence, path).toBe(
        path.includes('?id=') ? canManageRecurrence : undefined,
      )
    }
  }
}

async function expectHidden(
  request: APIRequestContext,
  token: string,
  scope: Scope,
  document: DocumentFixture,
) {
  for (const path of readPaths(document)) {
    const response = await apiRequest(request, 'GET', path, { token, headers: scopeHeaders(scope) })
    expect([200, 403, 404], path).toContain(response.status())
    const body = await readJsonSafe<{ items?: DocumentRow[]; recurrence?: unknown }>(response)
    if (response.ok()) expect(body?.items, path).toEqual([])
    else expect(body?.items ?? [], path).toEqual([])
    expect(body?.recurrence, path).toBeUndefined()
  }
}

test('TC-SALES-055: recurrence and period projections respect tenant, organization and feature access', async ({ request }) => {
  const superadmin = await getAuthToken(request, 'superadmin')
  const admin = await getAuthToken(request, 'admin')
  const home = getTokenContext(admin)
  const stamp = randomUUID()
  const startsOn = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const recurrence = { frequency: 'monthly', startsOn, periodCount: 4 }
  const initialProjection = { ...recurrence, locked: false }
  const line = { name: 'QA recurring service', currencyCode: 'USD', quantity: 1, unitPriceNet: 100, unitPriceGross: 100, taxRate: 0 }
  const documents: DocumentFixture[] = []
  const periodOrderIds: string[] = []
  let siblingOrganizationId: string | null = null
  let foreignTenantId: string | null = null
  let foreignOrganizationId: string | null = null
  let homeRoleId: string | null = null
  let siblingRoleId: string | null = null
  let userId: string | null = null

  try {
    siblingOrganizationId = await createOrganizationFixture(request, superadmin, {
      name: `QA Sales Recurrence Organization ${stamp}`,
      tenantId: home.tenantId,
    })
    const tenantResponse = await apiRequest(request, 'POST', '/api/directory/tenants', {
      token: superadmin,
      data: { name: `QA Sales Recurrence Tenant ${stamp}` },
    })
    expect(tenantResponse.status()).toBe(201)
    foreignTenantId = expectId((await readJsonSafe<{ id: string }>(tenantResponse))?.id, 'Foreign tenant ID')
    expect(foreignTenantId).not.toBe(home.tenantId)
    foreignOrganizationId = await createOrganizationFixture(request, superadmin, {
      name: `QA Sales Recurrence Foreign Organization ${stamp}`,
      tenantId: foreignTenantId,
    })
    const sibling = { tenantId: home.tenantId, organizationId: siblingOrganizationId }
    const foreign = { tenantId: foreignTenantId, organizationId: foreignOrganizationId }

    homeRoleId = await createRoleFixture(request, superadmin, {
      name: `qa-sales-recurrence-manage-${stamp}`,
      tenantId: home.tenantId,
    })
    await setRoleAclFeatures(request, superadmin, {
      roleId: homeRoleId, organizations: [home.organizationId], features: manageFeatures,
    })
    siblingRoleId = await createRoleFixture(request, superadmin, {
      name: `qa-sales-recurrence-view-${stamp}`,
      tenantId: home.tenantId,
    })
    await setRoleAclFeatures(request, superadmin, {
      roleId: siblingRoleId, organizations: [home.organizationId], features: viewFeatures,
    })
    const email = `qa-sales-recurrence-${stamp}@example.test`
    const password = `Qa1!${stamp}`
    userId = await createUserFixture(request, superadmin, {
      email, password, organizationId: home.organizationId, roles: [homeRoleId, siblingRoleId],
    })
    const actor = await getAuthToken(request, email, password)

    for (const scope of [home, sibling, foreign]) {
      for (const resource of resources) {
        const number = `QA-RECURRENCE-${randomUUID()}`
        const numberField = resource === 'orders' ? 'orderNumber' : 'quoteNumber'
        const response = await apiRequest(request, 'POST', documentPath(resource), {
          token: superadmin,
          headers: scopeHeaders(scope),
          data: {
            [numberField]: number,
            currencyCode: 'USD',
            recurrence,
            lines: [line],
          },
        })
        expect(response.status(), `Create recurring ${resource} in ${scope.organizationId}`).toBe(201)
        const id = expectId((await readJsonSafe<{ id: string }>(response))?.id, 'Recurring document ID')
        documents.push({ resource, id, number, scope })
      }
    }

    for (const document of documents) {
      if (document.scope === home) {
        await expectVisible(request, actor, home, document, initialProjection, true)
        const updated = await apiRequest(request, 'PUT', documentPath(document.resource), {
          token: actor,
          headers: scopeHeaders(home),
          data: { id: document.id, recurrence: { ...recurrence, periodCount: 6 } },
        })
        expect(updated.status(), 'Same-organization manager can update recurrence').toBe(200)
        await expectVisible(request, actor, home, document, { periodCount: 6 }, true)
        continue
      }
      await expectVisible(request, superadmin, document.scope, document, initialProjection)
      await expectHidden(request, actor, home, document)
      const denied = await apiRequest(request, 'PUT', documentPath(document.resource), {
        token: actor,
        headers: scopeHeaders(home),
        data: { id: document.id, recurrence: null },
      })
      expect([403, 404], 'Out-of-scope recurrence removal is denied').toContain(denied.status())
      await expectVisible(request, superadmin, document.scope, document, initialProjection)
    }

    await setRoleAclFeatures(request, superadmin, {
      roleId: siblingRoleId, organizations: [sibling.organizationId], features: viewFeatures,
    })
    const allHomeOrganizations = { tenantId: home.tenantId, organizationId: '__all__' }
    for (const document of documents.filter(({ scope }) => scope === sibling)) {
      await expectVisible(request, actor, sibling, document, initialProjection, false)
      for (const selection of [sibling, allHomeOrganizations]) {
        const deniedCreate = await apiRequest(request, 'POST', documentPath(document.resource), {
          token: actor,
          headers: scopeHeaders(selection),
          data: { organizationId: sibling.organizationId, currencyCode: 'USD', lines: [line], recurrence },
        })
        const created = await readJsonSafe<{ id?: string }>(deniedCreate)
        if (created?.id) {
          await apiRequest(request, 'DELETE', `${documentPath(document.resource)}?id=${created.id}`, {
            token: superadmin, headers: scopeHeaders(sibling),
          })
        }
        expect(deniedCreate.status(), 'A sibling viewer cannot create a recurring document there').toBe(403)
        expect(created?.id).toBeUndefined()

        const denied = await apiRequest(request, 'PUT', documentPath(document.resource), {
          token: actor,
          headers: scopeHeaders(selection),
          data: { id: document.id, organizationId: sibling.organizationId, recurrence: null },
        })
        expect([403, 404], 'View grant in the record organization does not inherit the home manage grant').toContain(denied.status())
      }
      await expectVisible(request, actor, sibling, document, initialProjection, false)
    }

    for (const document of documents.filter(({ resource, scope }) => resource === 'orders' && scope !== home)) {
      periodOrderIds.push(document.id)
      await withClient(async (client) => {
        const result = await client.query(
          `insert into sales_recurring_periods
             (organization_id, tenant_id, order_id, period_index, period_start, period_end, created_at, updated_at)
           values ($1, $2, $3, 0, $4::date, ($4::date + interval '1 month' - interval '1 day')::date, now(), now())`,
          [document.scope.organizationId, document.scope.tenantId, document.id, startsOn],
        )
        expect(result.rowCount).toBe(1)
      })
      if (document.scope === sibling) await expectVisible(request, actor, sibling, document, { periodCount: 4, locked: true })
      await expectVisible(request, superadmin, document.scope, document, { periodCount: 4, locked: true })
      await expectHidden(request, actor, home, document)
    }
  } finally {
    if (periodOrderIds.length) {
      await withClient((client) => client.query('delete from sales_recurring_periods where order_id = any($1::uuid[])', [periodOrderIds]))
    }
    for (const document of documents) {
      await apiRequest(request, 'DELETE', `${documentPath(document.resource)}?id=${document.id}`, {
        token: superadmin, headers: scopeHeaders(document.scope),
      })
    }
    await deleteUserIfExists(request, superadmin, userId)
    await deleteRoleIfExists(request, superadmin, siblingRoleId)
    await deleteRoleIfExists(request, superadmin, homeRoleId)
    await deleteOrganizationIfExists(request, superadmin, foreignOrganizationId)
    await deleteGeneralEntityIfExists(request, superadmin, '/api/directory/tenants', foreignTenantId)
    await deleteOrganizationIfExists(request, superadmin, siblingOrganizationId)
  }
})
