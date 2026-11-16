import { expect, test, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

type TestActor = {
  roleId: string | null
  userId: string | null
  token: string
}

type CatalogField = {
  field: string
  label: string
  kind: 'numeric' | 'text' | 'uuid' | 'timestamp' | 'jsonb'
  aggregates: Array<'sum' | 'avg' | 'count' | 'min' | 'max'>
  groupable: boolean
}

type CatalogEntity = {
  entityType: string
  label: string
  dateField: string | null
  fields: CatalogField[]
}

type CatalogResponse = {
  entities?: CatalogEntity[]
}

const API = {
  catalog: '/api/dashboards/analytics/catalog',
}

const PASSWORD = 'Str0ng!Pass'
const SALES_ORDER_SOURCE_FEATURE = 'sales.orders.view'

const CATALOG_FEATURES = [
  'dashboards.view',
  'dashboards.catalog.view',
  'analytics.view',
  SALES_ORDER_SOURCE_FEATURE,
  'customers.view',
  'customers.people.view',
  'customers.deals.view',
  'catalog.view',
  'catalog.products.view',
  'currencies.view',
  'dictionaries.view',
]

function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 6)}`
}

async function createConfirmedUser(
  request: APIRequestContext,
  token: string,
  input: { email: string; password: string; organizationId: string; roleName: string; name: string },
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/auth/users', {
    token,
    data: {
      email: input.email,
      password: input.password,
      organizationId: input.organizationId,
      roles: [input.roleName],
      isConfirmed: true,
      name: input.name,
    },
  })
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(response.status(), 'POST /api/auth/users should return 201').toBe(201)
  return expectId(body?.id, 'User creation response should include id')
}

async function createActorWithFeatures(
  request: APIRequestContext,
  input: {
    superadminToken: string
    tenantId: string
    organizationId: string
    prefix: string
    features: string[]
  },
): Promise<TestActor> {
  const id = uniqueId(input.prefix)
  const roleName = `qa_db2_${id.replace(/-/g, '_')}`
  const email = `${id}@dashboards.example.com`

  const roleId = await createRoleFixture(request, input.superadminToken, {
    name: roleName,
    tenantId: input.tenantId,
  })
  await setRoleAclFeatures(request, input.superadminToken, {
    roleId,
    features: input.features,
    organizations: null,
  })

  const userId = await createConfirmedUser(request, input.superadminToken, {
    email,
    password: PASSWORD,
    organizationId: input.organizationId,
    roleName,
    name: `QA DB2 ${input.prefix}`,
  })

  const token = await getAuthToken(request, email, PASSWORD)
  return { roleId, userId, token }
}

async function cleanupActor(request: APIRequestContext, superadminToken: string | null, actor: TestActor | null): Promise<void> {
  if (!actor) return
  await deleteUserIfExists(request, superadminToken, actor.userId)
  await deleteRoleIfExists(request, superadminToken, actor.roleId)
}

function fieldMap(entity: CatalogEntity): Map<string, CatalogField> {
  return new Map(entity.fields.map((field) => [field.field, field]))
}

test.describe('TC-DB2-002: analytics catalog API', () => {
  test('lists authorized analytics entities and filters by catalog/source-entity features', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    let catalogActor: TestActor | null = null
    let noCatalogActor: TestActor | null = null
    let noSalesActor: TestActor | null = null

    try {
      catalogActor = await createActorWithFeatures(request, {
        superadminToken,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        prefix: 'tc-db2-002-catalog',
        features: CATALOG_FEATURES,
      })
      noCatalogActor = await createActorWithFeatures(request, {
        superadminToken,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        prefix: 'tc-db2-002-no-catalog',
        features: CATALOG_FEATURES.filter((feature) => feature !== 'dashboards.catalog.view'),
      })
      noSalesActor = await createActorWithFeatures(request, {
        superadminToken,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        prefix: 'tc-db2-002-no-sales',
        features: CATALOG_FEATURES.filter((feature) => feature !== SALES_ORDER_SOURCE_FEATURE),
      })

      const response = await apiRequest(request, 'GET', API.catalog, { token: catalogActor.token })
      const body = await readJsonSafe<CatalogResponse>(response)
      expect(response.status()).toBe(200)
      expect(Array.isArray(body?.entities), 'catalog should return entities').toBe(true)

      const entities = body?.entities ?? []
      const salesOrders = entities.find((entity) => entity.entityType === 'sales:orders')
      expect(salesOrders, 'sales:orders should be in the catalog for callers with sales.orders.view').toBeTruthy()
      expect(salesOrders?.dateField, 'sales:orders should expose its canonical date field').toBe('placedAt')
      expect(salesOrders?.fields.length).toBeGreaterThan(0)
      for (const field of salesOrders?.fields ?? []) {
        expect(typeof field.field).toBe('string')
        expect(typeof field.label).toBe('string')
        expect(['numeric', 'text', 'uuid', 'timestamp', 'jsonb']).toContain(field.kind)
        expect(field.aggregates.length).toBeGreaterThan(0)
        expect(typeof field.groupable).toBe('boolean')
      }

      const fields = fieldMap(salesOrders as CatalogEntity)
      expect(fields.get('grandTotalGrossAmount')).toEqual(
        expect.objectContaining({
          kind: 'numeric',
          groupable: false,
          aggregates: expect.arrayContaining(['sum', 'avg', 'count', 'min', 'max']),
        }),
      )
      expect(fields.get('status')).toEqual(
        expect.objectContaining({
          kind: 'text',
          groupable: true,
          aggregates: ['count'],
        }),
      )
      expect(fields.get('placedAt')).toEqual(
        expect.objectContaining({
          kind: 'timestamp',
          groupable: true,
          aggregates: ['count'],
        }),
      )

      const forbiddenResponse = await apiRequest(request, 'GET', API.catalog, {
        token: noCatalogActor.token,
      })
      expect(forbiddenResponse.status(), 'missing dashboards.catalog.view should be forbidden').toBe(403)

      const filteredResponse = await apiRequest(request, 'GET', API.catalog, {
        token: noSalesActor.token,
      })
      const filteredBody = await readJsonSafe<CatalogResponse>(filteredResponse)
      expect(filteredResponse.status()).toBe(200)
      expect((filteredBody?.entities ?? []).some((entity) => entity.entityType === 'sales:orders')).toBe(false)
    } finally {
      await cleanupActor(request, superadminToken, noSalesActor)
      await cleanupActor(request, superadminToken, noCatalogActor)
      await cleanupActor(request, superadminToken, catalogActor)
    }
  })
})
