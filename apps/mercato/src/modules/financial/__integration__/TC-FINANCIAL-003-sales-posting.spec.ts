import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['financial', 'sales'],
}

/**
 * TC-FINANCIAL-003: a sales invoice reaches the ledger automatically.
 *
 * The whole path is exercised through the public API: create the chart, create a
 * period, create a sales order and invoice, then wait for the event-driven posting
 * to appear. The assertions are the accounting invariants — the entry balances, the
 * VAT line carries the jurisdiction tax code, an unchanged update does not double
 * post, and deleting the invoice reverses its entry rather than erasing history.
 */

const CHART = '/api/financial/chart-of-accounts'
const PERIODS = '/api/financial/periods'
const ENTRIES = '/api/financial/journal-entries'
const LINES = '/api/financial/journal-entries/lines'
const SALES_ORDERS = '/api/sales/orders'
const SALES_INVOICES = '/api/sales/invoices'

let fixtureCounter = 0
function uniqueSuffix(): string {
  fixtureCounter += 1
  return `${Date.now()}-${fixtureCounter}`
}

type EntryRow = {
  id: string
  status: string
  entry_type: string
  source_entity_type: string | null
  source_entity_id: string | null
  source_kind: string | null
}

type LineRow = {
  account_code: string
  debit_amount: string
  credit_amount: string
  tax_code: string | null
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
  throw new Error(`POST ${path} returned no id (${idKeys.join(', ')}): ${text.slice(0, 500)}`)
}

async function listEntries(
  request: APIRequestContext,
  token: string,
  invoiceId: string,
): Promise<EntryRow[]> {
  const response = await apiRequest(
    request,
    'GET',
    `${ENTRIES}?sourceEntityType=sales_invoice&sourceEntityId=${invoiceId}&pageSize=100`,
    { token },
  )
  const body = await readJsonSafe<{ items?: EntryRow[] }>(response)
  expect(response.ok(), `GET ${ENTRIES} failed with ${response.status()}`).toBeTruthy()
  return body?.items ?? []
}

async function readLines(
  request: APIRequestContext,
  token: string,
  entryId: string,
): Promise<LineRow[]> {
  const response = await apiRequest(request, 'GET', `${LINES}?id=${entryId}`, { token })
  const body = await readJsonSafe<{ items?: LineRow[] }>(response)
  expect(response.ok(), `GET ${LINES} failed with ${response.status()}`).toBeTruthy()
  return body?.items ?? []
}

async function resolvePeriodForToday(request: APIRequestContext, token: string): Promise<string> {
  const today = new Date()
  const todayIso = today.toISOString().slice(0, 10)
  const year = today.getUTCFullYear()
  const existing = await apiRequest(request, 'GET', `${PERIODS}?fiscalYear=${year}&pageSize=100`, { token })
  const existingBody = await readJsonSafe<{ items?: Array<{ id: string; start_date: string; end_date: string }> }>(existing)
  const covering = (existingBody?.items ?? []).find(
    (period) => period.start_date.slice(0, 10) <= todayIso && period.end_date.slice(0, 10) >= todayIso,
  )
  if (covering) return covering.id

  const month = today.getUTCMonth()
  const start = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10)
  const end = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10)
  return postEntity(request, token, PERIODS, {
    fiscalYear: year,
    periodNumber: month + 1,
    periodName: `${year}-${String(month + 1).padStart(2, '0')} ${uniqueSuffix()}`,
    startDate: start,
    endDate: end,
  }, ['id'])
}

test.describe('TC-FINANCIAL-003: automatic sales posting', () => {
  test('an invoice posts once, balances, and reverses on delete', async ({ request }) => {
    const token = await getAuthToken(request)
    const suffix = uniqueSuffix()
    const todayIso = new Date().toISOString().slice(0, 10)

    await apiRequest(request, 'POST', CHART, { token, data: { countryCode: 'SA' } })
    await resolvePeriodForToday(request, token)

    const line = {
      kind: 'service',
      name: `Posting test ${suffix}`,
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
      lines: [line],
      ...totals,
    }, ['orderId', 'id'])

    const invoiceId = await postEntity(request, token, SALES_INVOICES, {
      orderId: salesOrderId,
      currencyCode: 'SAR',
      issueDate: todayIso,
      lines: [line],
      ...totals,
    }, ['invoiceId', 'id'])

    await expect.poll(async () => (await listEntries(request, token, invoiceId)).length, {
      timeout: 30_000,
      message: 'the invoice posting must reach the ledger',
    }).toBe(1)

    const [entry] = await listEntries(request, token, invoiceId)
    expect(entry.status).toBe('posted')
    expect(entry.source_kind).toBe('invoice')

    const lines = await readLines(request, token, entry.id)
    expect(lines).toHaveLength(3)
    const debit = lines.reduce((total, row) => total + Number(row.debit_amount), 0)
    const credit = lines.reduce((total, row) => total + Number(row.credit_amount), 0)
    expect(debit).toBeCloseTo(credit, 6)
    expect(lines.find((row) => row.account_code === '1100')?.debit_amount).toBe('1150.0000')
    expect(lines.find((row) => row.account_code === '4000')?.credit_amount).toBe('1000.0000')
    const vatLine = lines.find((row) => row.account_code === '2100')
    expect(vatLine?.credit_amount).toBe('150.0000')
    expect(vatLine?.tax_code).toBe('SA-VAT-S')

    const updated = await apiRequest(request, 'PUT', SALES_INVOICES, {
      token,
      data: { id: invoiceId, metadata: { note: `unchanged ${suffix}` } },
    })
    expect(updated.ok(), `PUT ${SALES_INVOICES} failed with ${updated.status()}`).toBeTruthy()
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    expect(await listEntries(request, token, invoiceId), 'an unchanged update must not double post').toHaveLength(1)

    const deleted = await apiRequest(request, 'DELETE', SALES_INVOICES, { token, data: { id: invoiceId } })
    expect(deleted.ok(), `DELETE ${SALES_INVOICES} failed with ${deleted.status()}`).toBeTruthy()
    await expect.poll(async () => {
      const rows = await listEntries(request, token, invoiceId)
      return rows.some((row) => row.status === 'reversed') && rows.some((row) => row.entry_type === 'reversing') ? 'reversed' : 'pending'
    }, {
      timeout: 30_000,
      message: 'deleting the invoice must reverse its posting',
    }).toBe('reversed')
  })
})
