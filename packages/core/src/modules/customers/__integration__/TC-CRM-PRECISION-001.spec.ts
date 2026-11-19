import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'

/**
 * TC-CRM-PRECISION-001: deal values and company revenue keep every digit beyond
 * the old numeric(14,2) / numeric(16,2) columns and float precision; deal stats
 * expose the exact value as `dealValueExact`; the deals KPI summary exposes canonical
 * `*Exact` decimal strings next to its rounded numbers.
 * Source: .ai/specs/2026-10-08-arbitrary-precision-money-and-fx.md
 */

type JsonRecord = Record<string, unknown>

const COMPANY_REVENUE = '123456789012345.123456789'
const COMPANY_REVENUE_UPDATED = '9876543210987654321.000000001'
const DEAL_VALUE = '98765432109876.987654321'
const DEAL_VALUE_WON = '12345678901234.123456789012'
const CANONICAL_DECIMAL = /^-?(0|[1-9]\d*)(\.\d*[1-9])?$/

async function readJson(response: APIResponse): Promise<JsonRecord> {
  const raw = await response.text()
  if (!raw) return {}
  try {
    return JSON.parse(raw) as JsonRecord
  } catch {
    return {}
  }
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {}
}

async function readListItem(
  request: APIRequestContext,
  token: string,
  path: string,
  id: string,
): Promise<JsonRecord> {
  const response = await apiRequest(request, 'GET', `${path}?id=${encodeURIComponent(id)}`, { token })
  expect(response.status(), `GET ${path}?id should be 200`).toBe(200)
  const body = await readJson(response)
  const items = Array.isArray(body.items) ? (body.items as JsonRecord[]) : []
  return items.find((item) => item.id === id) ?? {}
}

async function readCompanyRevenue(request: APIRequestContext, token: string, companyId: string): Promise<unknown> {
  const response = await apiRequest(request, 'GET', `/api/customers/companies/${companyId}`, { token })
  expect(response.status(), 'GET /api/customers/companies/:id should be 200').toBe(200)
  return asRecord((await readJson(response)).profile).annualRevenue
}

async function readDealValue(request: APIRequestContext, token: string, dealId: string): Promise<unknown> {
  const response = await apiRequest(request, 'GET', `/api/customers/deals/${dealId}`, { token })
  expect(response.status(), 'GET /api/customers/deals/:id should be 200').toBe(200)
  return asRecord((await readJson(response)).deal).valueAmount
}

function expectExactSibling(record: JsonRecord, field: string, label: string): void {
  const value = record[field]
  const exact = record[`${field}Exact`]
  expect(typeof value, `${label}.${field} should stay a number`).toBe('number')
  expect(typeof exact, `${label}.${field}Exact should be a string`).toBe('string')
  expect(exact as string, `${label}.${field}Exact should be a canonical decimal`).toMatch(CANONICAL_DECIMAL)
  const numeric = value as number
  expect(Math.abs(Number(exact) - numeric), `${label}.${field} should be ${field}Exact rounded for display`)
    .toBeLessThanOrEqual(0.5 + Math.abs(numeric) * 1e-15)
}

async function expectSummaryExactFields(request: APIRequestContext, token: string): Promise<void> {
  const response = await apiRequest(request, 'GET', '/api/customers/deals/summary', { token })
  expect(response.status(), 'GET /api/customers/deals/summary should be 200').toBe(200)
  const summary = await readJson(response)
  const pipelineValue = asRecord(summary.pipelineValue)
  expectExactSibling(pipelineValue, 'value', 'pipelineValue')
  const stages = Array.isArray(pipelineValue.stages) ? (pipelineValue.stages as JsonRecord[]) : []
  for (const stage of stages) expectExactSibling(stage, 'value', 'pipelineValue.stages[]')
  const wonThisQuarter = asRecord(summary.wonThisQuarter)
  expectExactSibling(wonThisQuarter, 'value', 'wonThisQuarter')
  expect(wonThisQuarter.avgDealExact as string, 'wonThisQuarter.avgDealExact should be a canonical decimal')
    .toMatch(CANONICAL_DECIMAL)
}

test.describe('TC-CRM-PRECISION-001: exact deal values and company revenue', () => {
  test('deal value and company revenue round-trip beyond float precision; deal stats expose dealValueExact', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let companyId: string | null = null
    let dealId: string | null = null

    try {
      const companyResponse = await apiRequest(request, 'POST', '/api/customers/companies', {
        token,
        data: { displayName: `QA Precision Co ${stamp}`, annualRevenue: COMPANY_REVENUE },
      })
      expect(companyResponse.status(), 'POST /api/customers/companies should be 201').toBe(201)
      const companyBody = await readJson(companyResponse)
      companyId = (companyBody.id ?? companyBody.entityId) as string
      expect(companyId, 'company create should return id').toBeTruthy()

      expect(await readCompanyRevenue(request, token, companyId)).toBe(COMPANY_REVENUE)
      const companyListItem = await readListItem(request, token, '/api/customers/companies', companyId)
      expect(companyListItem.annual_revenue).toBe(COMPANY_REVENUE)

      const companyUpdate = await apiRequest(request, 'PUT', '/api/customers/companies', {
        token,
        data: { id: companyId, annualRevenue: COMPANY_REVENUE_UPDATED },
      })
      expect(companyUpdate.status(), 'PUT /api/customers/companies should be 200').toBe(200)
      expect(await readCompanyRevenue(request, token, companyId)).toBe(COMPANY_REVENUE_UPDATED)

      const dealResponse = await apiRequest(request, 'POST', '/api/customers/deals', {
        token,
        data: {
          title: `QA Precision Deal ${stamp}`,
          valueAmount: DEAL_VALUE,
          valueCurrency: 'USD',
          companyIds: [companyId],
        },
      })
      expect(dealResponse.status(), 'POST /api/customers/deals should be 201').toBe(201)
      const dealBody = await readJson(dealResponse)
      dealId = (dealBody.id ?? dealBody.dealId) as string
      expect(dealId, 'deal create should return id').toBeTruthy()

      expect(await readDealValue(request, token, dealId)).toBe(DEAL_VALUE)
      const dealListItem = await readListItem(request, token, '/api/customers/deals', dealId)
      expect(dealListItem.value_amount).toBe(DEAL_VALUE)

      await expectSummaryExactFields(request, token)

      const openStats = await apiRequest(request, 'GET', `/api/customers/deals/${dealId}/stats`, { token })
      expect(openStats.status(), 'stats for an open deal should be 400').toBe(400)

      const closeResponse = await apiRequest(request, 'PUT', '/api/customers/deals', {
        token,
        data: { id: dealId, valueAmount: DEAL_VALUE_WON, closureOutcome: 'won' },
      })
      expect(closeResponse.status(), 'PUT /api/customers/deals should be 200').toBe(200)
      expect(await readDealValue(request, token, dealId)).toBe(DEAL_VALUE_WON)

      const statsResponse = await apiRequest(request, 'GET', `/api/customers/deals/${dealId}/stats`, { token })
      expect(statsResponse.status(), 'GET /api/customers/deals/:id/stats should be 200').toBe(200)
      const stats = await readJson(statsResponse)
      expect(stats.closureOutcome).toBe('won')
      expect(stats.dealCurrency).toBe('USD')
      expect(stats.dealValueExact).toBe(DEAL_VALUE_WON)
      expect(stats.dealValue).toBe(Number(DEAL_VALUE_WON))
      expect(String(stats.dealValue)).not.toBe(DEAL_VALUE_WON)

      await expectSummaryExactFields(request, token)
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })
})
