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

type AiConfig = {
  entityType: string
  metricField: string | null
  aggregate: string
  groupByField: string | null
  granularity: string | null
  limit: number
  visualization: string
  title: string
}

type AiResponse = {
  config?: AiConfig | null
  aiAvailable?: boolean
}

const API = {
  ai: '/api/dashboards/analytics/custom-metric/ai',
}

const PASSWORD = 'Str0ng!Pass'

const CATALOG_FEATURES = [
  'dashboards.view',
  'dashboards.catalog.view',
  'analytics.view',
  'sales.orders.view',
  'customers.view',
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
  input: { superadminToken: string; tenantId: string; organizationId: string; prefix: string; features: string[] },
): Promise<TestActor> {
  const id = uniqueId(input.prefix)
  const roleName = `qa_db2_${id.replace(/-/g, '_')}`
  const email = `${id}@dashboards.example.com`

  const roleId = await createRoleFixture(request, input.superadminToken, { name: roleName, tenantId: input.tenantId })
  await setRoleAclFeatures(request, input.superadminToken, { roleId, features: input.features, organizations: null })

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

test.describe('TC-DB2-008: custom metric AI config API', () => {
  test('gates by feature, validates input, and degrades to config:null without an AI provider', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    let catalogActor: TestActor | null = null
    let noCatalogActor: TestActor | null = null

    try {
      catalogActor = await createActorWithFeatures(request, {
        superadminToken,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        prefix: 'tc-db2-008-catalog',
        features: CATALOG_FEATURES,
      })
      noCatalogActor = await createActorWithFeatures(request, {
        superadminToken,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        prefix: 'tc-db2-008-no-catalog',
        features: CATALOG_FEATURES.filter((feature) => feature !== 'dashboards.catalog.view'),
      })

      const unauthResponse = await request.post(API.ai, { data: { prompt: 'Orders per day' } })
      expect(unauthResponse.status(), 'POST without auth should be rejected').toBe(401)

      const forbiddenResponse = await apiRequest(request, 'POST', API.ai, {
        token: noCatalogActor.token,
        data: { prompt: 'Orders per day' },
      })
      expect(forbiddenResponse.status(), 'POST without dashboards.catalog.view should be 403').toBe(403)

      const invalidResponse = await apiRequest(request, 'POST', API.ai, {
        token: catalogActor.token,
        data: { prompt: '' },
      })
      expect(invalidResponse.status(), 'empty prompt should be rejected').toBe(400)

      const okResponse = await apiRequest(request, 'POST', API.ai, {
        token: catalogActor.token,
        data: { prompt: 'Number of orders per day over the last month as a line chart' },
      })
      const body = await readJsonSafe<AiResponse>(okResponse)
      expect(okResponse.status(), 'authorized request should return 200').toBe(200)
      expect(typeof body?.aiAvailable).toBe('boolean')
      // CI has no AI provider configured, so the endpoint degrades deterministically.
      expect(body?.aiAvailable).toBe(false)
      expect(body?.config ?? null).toBeNull()
    } finally {
      await cleanupActor(request, superadminToken, catalogActor)
      await cleanupActor(request, superadminToken, noCatalogActor)
    }
  })
})
