import { expect, test, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  createRoleFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { createOrderLineFixture, createSalesOrderFixture, deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

type TestActor = {
  roleId: string | null
  userId: string | null
  token: string
}

type InsightMetric = {
  key: 'revenue' | 'orders' | 'aov' | 'new_customers'
  label: string
  value: number
  previousValue: number | null
  deltaPct: number | null
}

type InsightsResponse = {
  metrics?: InsightMetric[]
  digest?: { bullets?: string[]; generatedAt?: string } | null
  aiAvailable?: boolean
  cached?: boolean
}

const API = {
  insights: '/api/dashboards/insights',
}

const PASSWORD = 'Str0ng!Pass'

const SALES_ORDER_SOURCE_FEATURE = 'sales.orders.view'

const SALES_ORDER_FEATURES = [
  SALES_ORDER_SOURCE_FEATURE,
  'sales.orders.manage',
  'sales.channels.view',
  'sales.settings.view',
  'customers.people.view',
  'catalog.products.view',
  'currencies.view',
  'dictionaries.view',
]

const CUSTOMER_FEATURES = [
  'customers.view',
  'customers.companies.view',
  'customers.companies.manage',
]

const INSIGHTS_FEATURES = [
  'dashboards.view',
  'dashboards.insights.view',
  'analytics.view',
]

const FULL_ANALYTICS_FEATURES = [
  ...INSIGHTS_FEATURES,
  ...SALES_ORDER_FEATURES,
  ...CUSTOMER_FEATURES,
]

function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 6)}`
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function todayUtc(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function buildSevenDayRanges() {
  const currentTo = todayUtc()
  const currentFrom = addDays(currentTo, -6)
  const previousTo = addDays(currentFrom, -1)
  const previousFrom = addDays(previousTo, -6)

  return {
    current: { from: isoDate(currentFrom), to: isoDate(currentTo) },
    previous: { from: isoDate(previousFrom), to: isoDate(previousTo) },
  }
}

function insightsPath(range: { from: string; to: string }, compare = 'previous_period'): string {
  const params = new URLSearchParams({ from: range.from, to: range.to, compare })
  return `${API.insights}?${params.toString()}`
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

async function createOrderForDate(
  request: APIRequestContext,
  token: string,
  input: { placedAt: string; gross: number; label: string },
): Promise<string> {
  const orderId = await createSalesOrderFixture(request, token, 'USD')
  await createOrderLineFixture(request, token, orderId, {
    name: input.label,
    quantity: 1,
    unitPriceNet: input.gross,
    unitPriceGross: input.gross,
    currencyCode: 'USD',
  })

  const updateResponse = await apiRequest(request, 'PUT', '/api/sales/orders', {
    token,
    data: { id: orderId, placedAt: input.placedAt },
  })
  expect(updateResponse.status(), 'PUT /api/sales/orders should update placedAt').toBe(200)
  return orderId
}

function metricMap(body: InsightsResponse): Map<InsightMetric['key'], InsightMetric> {
  expect(Array.isArray(body.metrics), 'insights response should include metrics').toBe(true)
  return new Map((body.metrics ?? []).map((metric) => [metric.key, metric]))
}

function expectMetric(
  metrics: Map<InsightMetric['key'], InsightMetric>,
  key: InsightMetric['key'],
  expected: { value: number; previousValue: number | null; deltaPct: number | null },
): void {
  const metric = metrics.get(key)
  expect(metric, `metric ${key} should be present`).toBeTruthy()
  expect(metric?.value).toBeCloseTo(expected.value, 5)
  if (expected.previousValue === null) {
    expect(metric?.previousValue).toBeNull()
  } else {
    expect(metric?.previousValue).toBeCloseTo(expected.previousValue, 5)
  }
  if (expected.deltaPct === null) {
    expect(metric?.deltaPct).toBeNull()
  } else {
    expect(metric?.deltaPct).toBeCloseTo(expected.deltaPct, 5)
  }
}

test.describe('TC-DB2-001: insights API', () => {
  test('computes deterministic KPI insights, enforces RBAC, validates ranges, and caches identical calls', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const { tenantId } = getTokenScope(adminToken)
    const organizationName = `QA DB2 insights ${Date.now()}`
    let organizationId: string | null = null
    let analyticsActor: TestActor | null = null
    let noInsightsActor: TestActor | null = null
    let noSalesActor: TestActor | null = null
    const orderIds: string[] = []
    let companyId: string | null = null

    try {
      organizationId = await createOrganizationFixture(request, superadminToken, {
        name: organizationName,
        tenantId,
      })

      analyticsActor = await createActorWithFeatures(request, {
        superadminToken,
        tenantId,
        organizationId,
        prefix: 'tc-db2-001-full',
        features: FULL_ANALYTICS_FEATURES,
      })
      noInsightsActor = await createActorWithFeatures(request, {
        superadminToken,
        tenantId,
        organizationId,
        prefix: 'tc-db2-001-no-insights',
        features: FULL_ANALYTICS_FEATURES.filter((feature) => feature !== 'dashboards.insights.view'),
      })
      noSalesActor = await createActorWithFeatures(request, {
        superadminToken,
        tenantId,
        organizationId,
        prefix: 'tc-db2-001-no-sales',
        features: [...INSIGHTS_FEATURES, ...CUSTOMER_FEATURES],
      })

      const ranges = buildSevenDayRanges()
      orderIds.push(
        await createOrderForDate(request, analyticsActor.token, {
          placedAt: ranges.current.from,
          gross: 120,
          label: `QA DB2 current A ${Date.now()}`,
        }),
      )
      orderIds.push(
        await createOrderForDate(request, analyticsActor.token, {
          placedAt: ranges.current.to,
          gross: 180,
          label: `QA DB2 current B ${Date.now()}`,
        }),
      )
      orderIds.push(
        await createOrderForDate(request, analyticsActor.token, {
          placedAt: ranges.previous.from,
          gross: 100,
          label: `QA DB2 previous ${Date.now()}`,
        }),
      )
      companyId = await createCompanyFixture(request, analyticsActor.token, `QA DB2 Customer ${Date.now()}`)

      const firstResponse = await apiRequest(request, 'GET', insightsPath(ranges.current), {
        token: analyticsActor.token,
      })
      const firstBody = await readJsonSafe<InsightsResponse>(firstResponse)
      expect(firstResponse.status(), 'GET /api/dashboards/insights should return 200').toBe(200)
      expect(firstBody?.aiAvailable).toBe(false)
      expect(firstBody?.digest).toBeNull()
      expect(firstBody?.cached).toBe(false)

      const metrics = metricMap(firstBody ?? {})
      expectMetric(metrics, 'revenue', { value: 300, previousValue: 100, deltaPct: 2 })
      expectMetric(metrics, 'orders', { value: 2, previousValue: 1, deltaPct: 1 })
      expectMetric(metrics, 'aov', { value: 150, previousValue: 100, deltaPct: 0.5 })
      expectMetric(metrics, 'new_customers', { value: 1, previousValue: 0, deltaPct: null })

      const secondResponse = await apiRequest(request, 'GET', insightsPath(ranges.current), {
        token: analyticsActor.token,
      })
      const secondBody = await readJsonSafe<InsightsResponse>(secondResponse)
      expect(secondResponse.status()).toBe(200)
      expect(secondBody?.cached).toBe(true)
      expect(secondBody?.aiAvailable).toBe(false)
      expect(secondBody?.digest).toBeNull()

      const forbiddenResponse = await apiRequest(request, 'GET', insightsPath(ranges.current), {
        token: noInsightsActor.token,
      })
      expect(forbiddenResponse.status(), 'missing dashboards.insights.view should be forbidden').toBe(403)

      const noSalesResponse = await apiRequest(request, 'GET', insightsPath(ranges.current), {
        token: noSalesActor.token,
      })
      const noSalesBody = await readJsonSafe<InsightsResponse>(noSalesResponse)
      expect(noSalesResponse.status()).toBe(200)
      const noSalesMetricKeys = new Set((noSalesBody?.metrics ?? []).map((metric) => metric.key))
      expect(noSalesMetricKeys.has('revenue')).toBe(false)
      expect(noSalesMetricKeys.has('orders')).toBe(false)
      expect(noSalesMetricKeys.has('aov')).toBe(false)
      expect(noSalesMetricKeys.has('new_customers')).toBe(true)

      const invertedRangeResponse = await apiRequest(
        request,
        'GET',
        insightsPath({ from: ranges.current.to, to: ranges.current.from }),
        { token: analyticsActor.token },
      )
      expect(invertedRangeResponse.status(), 'from > to should return 400').toBe(400)

      const tooLongFrom = isoDate(addDays(todayUtc(), -366))
      const tooLongTo = isoDate(todayUtc())
      const tooLongResponse = await apiRequest(
        request,
        'GET',
        insightsPath({ from: tooLongFrom, to: tooLongTo }),
        { token: analyticsActor.token },
      )
      expect(tooLongResponse.status(), 'ranges over 366 days should return 400').toBe(400)
    } finally {
      for (const orderId of orderIds) {
        await deleteSalesEntityIfExists(request, analyticsActor?.token ?? null, '/api/sales/orders', orderId)
      }
      await deleteEntityIfExists(request, analyticsActor?.token ?? null, '/api/customers/companies', companyId)
      await cleanupActor(request, superadminToken, noSalesActor)
      await cleanupActor(request, superadminToken, noInsightsActor)
      await cleanupActor(request, superadminToken, analyticsActor)
      await deleteOrganizationIfExists(request, superadminToken, organizationId)
    }
  })
})
