import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-CRM-8243: deals KPI summary across several organizations (#8243). Extends TC-CRM-082.
 *
 * Every test builds its own organization tree — a parent and one child — so the summary,
 * read with the parent selected (parent + descendants in scope), only sees this test's deals
 * and its absolute totals are deterministic. Base currencies, exchange rates and deals are
 * created through the API. The database is touched only for what the API cannot express:
 * moving one deal's `created_at` into the previous quarter (inflow delta), moving one deal
 * into a foreign tenant (tenant exclusion), and retiring the base-currency fixtures, which
 * the API refuses to delete.
 *
 * Rates are stored on today's UTC midnight: the summary resolves stored rates by exact day.
 */

const SUMMARY_PATH = '/api/customers/deals/summary'

type Delta = { value: number; direction: 'up' | 'down' | 'unchanged' }

type Summary = {
  baseCurrencyCode: string | null
  convertedAll: boolean
  missingRateCurrencies: string[]
  pipelineValue: { value: number; delta: Delta }
  activeDeals: { value: number }
  wonThisQuarter: { value: number; delta: Delta; dealsClosed: number }
}

type Fixtures = {
  token: string
  tenantId: string
  organizationIds: string[]
  currencyIds: string[]
  rateIds: string[]
  dealIds: string[]
  foreignTenantDealIds: string[]
}

function todayUtcMidnightIso(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()
}

function previousQuarterIso(): string {
  const now = new Date()
  const quarterStart = Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1)
  return new Date(quarterStart - 15 * 24 * 60 * 60 * 1000).toISOString()
}

async function createOrganizationTree(request: APIRequestContext, fixtures: Fixtures, label: string) {
  const stamp = randomUUID().slice(0, 8)
  const parentId = await createOrganizationFixture(request, fixtures.token, {
    name: `TC-CRM-8243 ${label} parent ${stamp}`,
    tenantId: fixtures.tenantId,
  })
  fixtures.organizationIds.push(parentId)
  const childId = await createOrganizationFixture(request, fixtures.token, {
    name: `TC-CRM-8243 ${label} child ${stamp}`,
    tenantId: fixtures.tenantId,
    parentId,
  })
  fixtures.organizationIds.push(childId)
  return { parentId, childId }
}

async function createCurrency(
  request: APIRequestContext,
  fixtures: Fixtures,
  organizationId: string,
  code: string,
  isBase: boolean,
) {
  const response = await apiRequest(request, 'POST', '/api/currencies/currencies', {
    token: fixtures.token,
    data: { organizationId, tenantId: fixtures.tenantId, code, name: `TC-CRM-8243 ${code}`, isBase },
  })
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(response.status(), `create ${code} currency in ${organizationId}`).toBe(201)
  fixtures.currencyIds.push(expectId(body?.id, 'currency id'))
}

async function createRate(
  request: APIRequestContext,
  fixtures: Fixtures,
  organizationId: string,
  rate: string,
) {
  const response = await apiRequest(request, 'POST', '/api/currencies/exchange-rates', {
    token: fixtures.token,
    data: {
      organizationId,
      tenantId: fixtures.tenantId,
      fromCurrencyCode: 'EUR',
      toCurrencyCode: 'USD',
      rate,
      date: todayUtcMidnightIso(),
      source: 'TC-CRM-8243',
    },
  })
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(response.status(), `create EUR/USD rate in ${organizationId}`).toBe(201)
  fixtures.rateIds.push(expectId(body?.id, 'exchange rate id'))
}

async function createDeal(
  request: APIRequestContext,
  fixtures: Fixtures,
  input: { organizationId: string; valueAmount: number; valueCurrency: string; status: 'open' | 'win' },
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/customers/deals', {
    token: fixtures.token,
    data: {
      title: `TC-CRM-8243 ${input.status} ${input.valueAmount} ${input.valueCurrency} ${randomUUID().slice(0, 8)}`,
      organizationId: input.organizationId,
      valueAmount: input.valueAmount,
      valueCurrency: input.valueCurrency,
      status: input.status,
    },
  })
  const body = await readJsonSafe<{ id?: string; dealId?: string }>(response)
  expect(response.status(), 'create deal fixture').toBe(201)
  const id = expectId(body?.id ?? body?.dealId, 'deal id')
  fixtures.dealIds.push(id)
  return id
}

async function readSummary(request: APIRequestContext, token: string, selectedOrgId: string): Promise<Summary> {
  const response = await apiRequestWithSelectedOrg(request, 'GET', SUMMARY_PATH, { token, selectedOrgId })
  expect(response.status(), `GET ${SUMMARY_PATH} for ${selectedOrgId}`).toBe(200)
  return (await readJsonSafe<Summary>(response)) as Summary
}

async function cleanup(request: APIRequestContext, fixtures: Fixtures) {
  if (fixtures.foreignTenantDealIds.length > 0) {
    await withClient((client) => client.query(
      'UPDATE customer_deals SET tenant_id = $1 WHERE id = ANY($2::uuid[])',
      [fixtures.tenantId, fixtures.foreignTenantDealIds],
    )).catch(() => undefined)
  }
  for (const id of fixtures.dealIds) {
    await deleteEntityIfExists(request, fixtures.token, '/api/customers/deals', id)
  }
  for (const id of fixtures.rateIds) {
    await apiRequest(request, 'DELETE', `/api/currencies/exchange-rates?id=${encodeURIComponent(id)}`, {
      token: fixtures.token,
    }).catch(() => undefined)
  }
  if (fixtures.currencyIds.length > 0) {
    await withClient((client) => client.query(
      'UPDATE currencies SET is_base = false, deleted_at = now() WHERE id = ANY($1::uuid[])',
      [fixtures.currencyIds],
    )).catch(() => undefined)
  }
  for (const id of [...fixtures.organizationIds].reverse()) {
    await deleteOrganizationIfExists(request, fixtures.token, id)
  }
}

async function withFixtures(request: APIRequestContext, run: (fixtures: Fixtures) => Promise<void>) {
  const token = await getAuthToken(request, 'superadmin')
  const fixtures: Fixtures = {
    token,
    tenantId: getTokenContext(token).tenantId,
    organizationIds: [],
    currencyIds: [],
    rateIds: [],
    dealIds: [],
    foreignTenantDealIds: [],
  }
  expect(fixtures.tenantId, 'superadmin token carries a tenant').toBeTruthy()
  try {
    await run(fixtures)
  } finally {
    await cleanup(request, fixtures)
  }
}

test.describe('TC-CRM-8243: deals summary across organizations with their own currencies and rates', () => {
  test('reports no base currency when the organizations in scope have conflicting base currencies', async ({ request }) => {
    test.slow()
    await withFixtures(request, async (fixtures) => {
      const { parentId, childId } = await createOrganizationTree(request, fixtures, 'conflict')
      await createCurrency(request, fixtures, parentId, 'USD', true)
      await createCurrency(request, fixtures, childId, 'EUR', true)
      await createCurrency(request, fixtures, childId, 'USD', false)
      await createRate(request, fixtures, childId, '1.10000000')
      await createDeal(request, fixtures, { organizationId: parentId, valueAmount: 1000, valueCurrency: 'USD', status: 'open' })
      await createDeal(request, fixtures, { organizationId: childId, valueAmount: 1500, valueCurrency: 'EUR', status: 'open' })

      const tree = await readSummary(request, fixtures.token, parentId)
      expect(tree.baseCurrencyCode).toBeNull()
      expect(tree.convertedAll).toBe(false)
      expect([...tree.missingRateCurrencies].sort()).toEqual(['EUR', 'USD'])
      expect(tree.pipelineValue.value, 'degraded path shows the dominant raw currency total').toBe(1500)
      expect(tree.activeDeals.value).toBe(2)

      const childOnly = await readSummary(request, fixtures.token, childId)
      expect(childOnly.baseCurrencyCode).toBe('EUR')
      expect(childOnly.convertedAll).toBe(true)
      expect(childOnly.missingRateCurrencies).toEqual([])
      expect(childOnly.pipelineValue.value).toBe(1500)
      expect(childOnly.activeDeals.value).toBe(1)
    })
  })

  test('converts each organization with its own rates and excludes other organizations and tenants', async ({ request }) => {
    test.slow()
    await withFixtures(request, async (fixtures) => {
      const { parentId, childId } = await createOrganizationTree(request, fixtures, 'common-base')
      for (const organizationId of [parentId, childId]) {
        await createCurrency(request, fixtures, organizationId, 'USD', true)
        await createCurrency(request, fixtures, organizationId, 'EUR', false)
      }
      await createRate(request, fixtures, parentId, '1.10000000')
      await createRate(request, fixtures, childId, '1.20000000')

      await createDeal(request, fixtures, { organizationId: parentId, valueAmount: 100, valueCurrency: 'EUR', status: 'open' })
      await createDeal(request, fixtures, { organizationId: childId, valueAmount: 100, valueCurrency: 'EUR', status: 'open' })
      const previousQuarterDealId = await createDeal(request, fixtures, {
        organizationId: childId, valueAmount: 50, valueCurrency: 'EUR', status: 'open',
      })
      await createDeal(request, fixtures, { organizationId: parentId, valueAmount: 200, valueCurrency: 'EUR', status: 'win' })
      await createDeal(request, fixtures, { organizationId: childId, valueAmount: 200, valueCurrency: 'EUR', status: 'win' })
      const foreignTenantDealId = await createDeal(request, fixtures, {
        organizationId: parentId, valueAmount: 999_777, valueCurrency: 'USD', status: 'open',
      })
      await withClient(async (client) => {
        await client.query('UPDATE customer_deals SET created_at = $1 WHERE id = $2', [previousQuarterIso(), previousQuarterDealId])
        await client.query('UPDATE customer_deals SET tenant_id = $1 WHERE id = $2', [randomUUID(), foreignTenantDealId])
      })
      fixtures.foreignTenantDealIds.push(foreignTenantDealId)

      const tree = await readSummary(request, fixtures.token, parentId)
      expect(tree.baseCurrencyCode).toBe('USD')
      expect(tree.convertedAll).toBe(true)
      expect(tree.missingRateCurrencies).toEqual([])
      expect(tree.activeDeals.value, 'the foreign-tenant deal stays out').toBe(3)
      expect(tree.pipelineValue.value, '100×1.10 + 100×1.20 + 50×1.20').toBe(290)
      expect(tree.pipelineValue.delta, 'inflow 230 this quarter vs 60 last quarter').toEqual({ value: 283, direction: 'up' })
      expect(tree.wonThisQuarter.value, '200×1.10 + 200×1.20').toBe(460)
      expect(tree.wonThisQuarter.dealsClosed).toBe(2)

      const childOnly = await readSummary(request, fixtures.token, childId)
      expect(childOnly.baseCurrencyCode).toBe('USD')
      expect(childOnly.convertedAll).toBe(true)
      expect(childOnly.activeDeals.value, 'the parent organization stays out').toBe(2)
      expect(childOnly.pipelineValue.value, '100×1.20 + 50×1.20').toBe(180)
      expect(childOnly.pipelineValue.delta, 'inflow 120 this quarter vs 60 last quarter').toEqual({ value: 100, direction: 'up' })
      expect(childOnly.wonThisQuarter.value).toBe(240)
    })
  })

  test('discloses a currency as missing when only another organization has a rate for it', async ({ request }) => {
    test.slow()
    await withFixtures(request, async (fixtures) => {
      const { parentId, childId } = await createOrganizationTree(request, fixtures, 'missing-rate')
      for (const organizationId of [parentId, childId]) {
        await createCurrency(request, fixtures, organizationId, 'USD', true)
        await createCurrency(request, fixtures, organizationId, 'EUR', false)
      }
      await createRate(request, fixtures, parentId, '1.10000000')

      await createDeal(request, fixtures, { organizationId: parentId, valueAmount: 500, valueCurrency: 'USD', status: 'open' })
      await createDeal(request, fixtures, { organizationId: childId, valueAmount: 1000, valueCurrency: 'EUR', status: 'open' })
      await createDeal(request, fixtures, { organizationId: childId, valueAmount: 400, valueCurrency: 'EUR', status: 'win' })

      const tree = await readSummary(request, fixtures.token, parentId)
      expect(tree.baseCurrencyCode).toBe('USD')
      expect(tree.convertedAll).toBe(false)
      expect(tree.missingRateCurrencies).toEqual(['EUR'])
      expect(tree.pipelineValue.value, 'the child EUR deal is not converted with the parent rate').toBe(500)
      expect(tree.wonThisQuarter.value).toBe(0)
      expect(tree.wonThisQuarter.dealsClosed).toBe(1)
      expect(tree.activeDeals.value).toBe(2)
    })
  })
})
