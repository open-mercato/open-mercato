import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createCompanyFixture, deleteEntityByBody } from '@open-mercato/core/helpers/integration/crmFixtures'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'

export const integrationMeta = {
  dependsOnModules: ['financial', 'sales', 'customers'],
}

/**
 * TC-FINANCIAL-004: receivables aging and the customer statement agree with the
 * posting the sales invoice produced.
 *
 * The aging total must move by exactly the posted receivable movement (so the
 * reconciliation delta does not change), the invoice must land in the current
 * bucket when due today, and the statement must show the invoice as a debit for
 * the same customer. Amounts are measured against a baseline captured before the
 * fixtures so a shared dev database with other open invoices cannot skew them.
 */

const CHART = '/api/financial/chart-of-accounts'
const PERIODS = '/api/financial/periods'
const AGING = '/api/financial/receivables/aging'
const STATEMENTS = '/api/financial/receivables/statements'
const SALES_ORDERS = '/api/sales/orders'
const SALES_INVOICES = '/api/sales/invoices'

let fixtureCounter = 0
function uniqueSuffix(): string {
  fixtureCounter += 1
  return `${Date.now()}-${fixtureCounter}`
}

async function postEntity(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>,
  idKeys: string[],
): Promise<string> {
  const response = await apiRequest(request, 'POST', path, { token, data })
  const text = await response.text()
  expect(response.ok(), `POST ${path} failed with ${response.status()}: ${text.slice(0, 500)}`).toBeTruthy()
  const body = JSON.parse(text) as Record<string, unknown>
  for (const key of idKeys) {
    const value = body[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  throw new Error(`POST ${path} returned no id: ${text.slice(0, 500)}`)
}

async function resolvePeriodForToday(request: APIRequestContext, token: string): Promise<string> {
  const today = new Date()
  const todayIso = today.toISOString().slice(0, 10)
  const year = today.getUTCFullYear()
  const existing = await apiRequest(request, 'GET', `${PERIODS}?fiscalYear=${year}&pageSize=100`, { token })
  const body = await readJsonSafe<{ items?: Array<{ id: string; start_date: string; end_date: string }> }>(existing)
  const covering = (body?.items ?? []).find(
    (period) => period.start_date.slice(0, 10) <= todayIso && period.end_date.slice(0, 10) >= todayIso,
  )
  if (covering) return covering.id
  const month = today.getUTCMonth()
  return postEntity(request, token, PERIODS, {
    fiscalYear: year,
    periodNumber: month + 1,
    periodName: `${year}-${String(month + 1).padStart(2, '0')} ${uniqueSuffix()}`,
    startDate: new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10),
    endDate: new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10),
  }, ['id'])
}

test.describe('TC-FINANCIAL-004: receivables aging', () => {
  let cleanupCompanyId: string | null = null
  let cleanupOrderId: string | null = null
  let cleanupInvoiceId: string | null = null

  test.afterEach(async ({ request }) => {
    try {
      const token = await getAuthToken(request)
      await deleteSalesEntityIfExists(request, token, SALES_INVOICES, cleanupInvoiceId)
      await deleteSalesEntityIfExists(request, token, SALES_ORDERS, cleanupOrderId)
      await deleteEntityByBody(request, token, '/api/customers/companies', cleanupCompanyId)
    } finally {
      cleanupCompanyId = null
      cleanupOrderId = null
      cleanupInvoiceId = null
    }
  })

  test('the open invoice reconciles to the ledger and appears on the statement', async ({ request }) => {
    const token = await getAuthToken(request)
    const suffix = uniqueSuffix()
    const todayIso = new Date().toISOString().slice(0, 10)
    const company = await createCompanyFixture(request, token, `Receivables TC ${suffix}`)
    cleanupCompanyId = company

    await apiRequest(request, 'POST', CHART, { token, data: { countryCode: 'SA' } })
    await resolvePeriodForToday(request, token)

    const baselineResponse = await apiRequest(request, 'GET', `${AGING}?asOf=${todayIso}`, { token })
    const baseline = await readJsonSafe<{
      totalOutstanding: string
      ledgerBalance: string
      reconciliationDelta: string
    }>(baselineResponse)
    expect(baselineResponse.ok()).toBeTruthy()
    const baselineOutstanding = Number(baseline?.totalOutstanding ?? '0')
    const baselineLedger = Number(baseline?.ledgerBalance ?? '0')

    const line = {
      kind: 'service',
      name: `Receivables test ${suffix}`,
      quantity: 1,
      currencyCode: 'SAR',
      unitPriceNet: 1000,
      unitPriceGross: 1150,
      taxRate: 15,
      taxAmount: 150,
      totalNetAmount: 1000,
      totalGrossAmount: 1150,
    }
    const totals = {
      subtotalNetAmount: 1000,
      subtotalGrossAmount: 1150,
      taxTotalAmount: 150,
      grandTotalNetAmount: 1000,
      grandTotalGrossAmount: 1150,
      outstandingAmount: 1150,
    }
    const salesOrderId = await postEntity(request, token, SALES_ORDERS, {
      currencyCode: 'SAR',
      customerEntityId: company,
      customerSnapshot: { id: company, kind: 'company', displayName: `Receivables TC ${suffix}` },
      lines: [line],
      ...totals,
    }, ['orderId', 'id'])
    cleanupOrderId = salesOrderId
    const invoiceId = await postEntity(request, token, SALES_INVOICES, {
      orderId: salesOrderId,
      currencyCode: 'SAR',
      issueDate: todayIso,
      dueDate: todayIso,
      lines: [line],
      ...totals,
    }, ['invoiceId', 'id'])
    cleanupInvoiceId = invoiceId

    await expect.poll(async () => {
      const response = await apiRequest(request, 'GET', `${AGING}?asOf=${todayIso}`, { token })
      const body = await readJsonSafe<{ ledgerBalance?: string; invoices?: Array<{ id: string }> }>(response)
      const hasInvoice = (body?.invoices ?? []).some((invoice) => invoice.id === invoiceId)
      const ledgerMovement = Number(body?.ledgerBalance ?? '0') - baselineLedger
      return response.ok() && hasInvoice && Math.abs(ledgerMovement - 1150) < 0.005
    }, {
      timeout: 30_000,
      message: 'the invoice must reach the ledger before aging can reconcile',
    }).toBe(true)

    const agingResponse = await apiRequest(request, 'GET', `${AGING}?asOf=${todayIso}`, { token })
    const aging = await readJsonSafe<{
      buckets: Record<string, { count: number; amount: string }>
      totalOutstanding: string
      ledgerBalance: string
      reconciliationDelta: string
      invoices: Array<{ id: string; bucket: string; outstandingAmount: string }>
    }>(agingResponse)
    expect(agingResponse.ok()).toBeTruthy()
    expect(aging?.reconciliationDelta).toBe(baseline?.reconciliationDelta)
    expect(Math.abs(Number(aging?.totalOutstanding ?? '0') - baselineOutstanding - 1150)).toBeLessThan(0.005)
    expect(Math.abs(Number(aging?.ledgerBalance ?? '0') - baselineLedger - 1150)).toBeLessThan(0.005)
    const invoice = aging?.invoices.find((row) => row.id === invoiceId)
    expect(invoice?.bucket).toBe('current')
    expect(invoice?.outstandingAmount).toBe('1150.00')

    const statementResponse = await apiRequest(
      request,
      'GET',
      `${STATEMENTS}?customerId=${company}`,
      { token },
    )
    const statement = await readJsonSafe<{
      totalDebits: string
      totalCredits: string
      closingBalance: string
      lines: Array<{ kind: string; reference: string | null; debit: string }>
    }>(statementResponse)
    expect(statementResponse.ok()).toBeTruthy()
    expect(statement?.totalDebits).toBe('1150.00')
    expect(statement?.totalCredits).toBe('0.00')
    expect(statement?.closingBalance).toBe('1150.00')
    expect(statement?.lines.some((entry) => entry.kind === 'invoice' && Number(entry.debit) === 1150)).toBe(true)
  })
})
