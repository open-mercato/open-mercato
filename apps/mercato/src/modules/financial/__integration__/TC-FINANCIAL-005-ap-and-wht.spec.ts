import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['financial', 'saudi_localization'],
}

/**
 * TC-FINANCIAL-005: a vendor invoice posts, a payment withholds and settles it,
 * and the AP aging reconciles at every step.
 *
 * The amounts are chosen so the three legs of each entry are distinct:
 * invoice 1000 net + 150 VAT = 1150 gross; payment 1150 with 5% withholding =
 * 57.50 held and 1092.50 paid. The invoice must flip to `paid` only when the
 * allocation covers it, and voiding the payment must restore it to `posted`.
 */

const CHART = '/api/financial/chart-of-accounts'
const ACCOUNTS = '/api/financial/accounts'
const PERIODS = '/api/financial/periods'
const VENDORS = '/api/financial/ap/vendors'
const INVOICES = '/api/financial/ap/invoices'
const POST_INVOICE = '/api/financial/ap/invoices/post'
const PAYMENTS = '/api/financial/ap/payments/post'
const AGING = '/api/financial/ap/aging'
const LINES = '/api/financial/journal-entries/lines'

let fixtureCounter = 0
function uniqueSuffix(): string {
  fixtureCounter += 1
  return `${Date.now()}-${fixtureCounter}`
}

type EntryRow = { id: string; status: string; entry_type: string }
type LineRow = { account_code: string; debit_amount: string; credit_amount: string }

async function postEntity(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>,
  idKeys: string[],
): Promise<Record<string, unknown>> {
  const response = await apiRequest(request, 'POST', path, { token, data })
  const text = await response.text()
  expect(response.ok(), `POST ${path} failed with ${response.status()}: ${text.slice(0, 500)}`).toBeTruthy()
  const body = JSON.parse(text) as Record<string, unknown>
  for (const key of idKeys) {
    if (typeof body[key] === 'string' && String(body[key]).length > 0) return body
  }
  throw new Error(`POST ${path} returned no id: ${text.slice(0, 500)}`)
}

async function findAccountId(request: APIRequestContext, token: string, code: string): Promise<string> {
  const response = await apiRequest(request, 'GET', `${ACCOUNTS}?pageSize=100`, { token })
  const body = await readJsonSafe<{ items?: Array<{ id: string; code: string }> }>(response)
  expect(response.ok()).toBeTruthy()
  const account = (body?.items ?? []).find((row) => row.code === code)
  expect(account, `account ${code} must exist`).toBeTruthy()
  return account?.id as string
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
  const created = await postEntity(request, token, PERIODS, {
    fiscalYear: year,
    periodNumber: month + 1,
    periodName: `${year}-${String(month + 1).padStart(2, '0')} ${uniqueSuffix()}`,
    startDate: new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10),
    endDate: new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10),
  }, ['id'])
  return String(created.id)
}

async function readEntryLines(request: APIRequestContext, token: string, entryId: string): Promise<LineRow[]> {
  const response = await apiRequest(request, 'GET', `${LINES}?id=${entryId}`, { token })
  const body = await readJsonSafe<{ items?: LineRow[] }>(response)
  expect(response.ok()).toBeTruthy()
  return body?.items ?? []
}

test.describe('TC-FINANCIAL-005: accounts payable and withholding', () => {
  test('invoice posts, payment withholds, aging reconciles, void restores', async ({ request }) => {
    const token = await getAuthToken(request)
    const suffix = uniqueSuffix()
    const todayIso = new Date().toISOString().slice(0, 10)

    await apiRequest(request, 'POST', CHART, { token, data: { countryCode: 'SA' } })
    await resolvePeriodForToday(request, token)
    const baselineResponse = await apiRequest(request, 'GET', `${AGING}?asOf=${todayIso}`, { token })
    const baseline = await readJsonSafe<{
      totalOutstanding: string
      ledgerBalance: string
      reconciliationDelta: string
    }>(baselineResponse)
    expect(baselineResponse.ok()).toBeTruthy()
    const expenseAccountId = await findAccountId(request, token, '5200')

    const vendor = await postEntity(request, token, VENDORS, {
      code: `V-${suffix}`,
      name: `Vendor ${suffix}`,
      countryCode: 'SA',
    }, ['id'])
    const vendorId = String(vendor.id)

    const invoice = await postEntity(request, token, INVOICES, {
      vendorId,
      vendorInvoiceNumber: `VINV-${suffix}`,
      issueDate: todayIso,
      dueDate: todayIso,
      currencyCode: 'SAR',
      lines: [{
        description: `Rent ${suffix}`,
        expenseAccountId,
        quantity: '1',
        unitPriceNet: '1000',
        taxRate: '15',
      }],
    }, ['id'])
    const invoiceId = String(invoice.id)

    const posted = await apiRequest(request, 'POST', POST_INVOICE, { token, data: { id: invoiceId } })
    const postedBody = await readJsonSafe<{ entryId?: string }>(posted)
    expect(posted.ok(), `POST ${POST_INVOICE} failed with ${posted.status()}: ${JSON.stringify(postedBody)}`).toBeTruthy()
    const invoiceEntryId = String(postedBody?.entryId)
    const invoiceLines = await readEntryLines(request, token, invoiceEntryId)
    expect(invoiceLines.find((line) => line.account_code === '5200')?.debit_amount).toBe('1000.0000')
    expect(invoiceLines.find((line) => line.account_code === '1150')?.debit_amount).toBe('150.0000')
    expect(invoiceLines.find((line) => line.account_code === '2000')?.credit_amount).toBe('1150.0000')

    const payment = await apiRequest(request, 'POST', PAYMENTS, {
      token,
      data: {
        vendorId,
        paymentDate: todayIso,
        currencyCode: 'SAR',
        grossAmount: '1150',
        withholdingCode: 'SA-WHT-SERVICES',
        method: 'bank_transfer',
        reference: `TRX-${suffix}`,
        allocations: [{ invoiceId, amount: '1150' }],
      },
    })
    const paymentBody = await readJsonSafe<{ entryId?: string }>(payment)
    expect(payment.ok(), `POST ${PAYMENTS} failed with ${payment.status()}: ${JSON.stringify(paymentBody)}`).toBeTruthy()
    const paymentLines = await readEntryLines(request, token, String(paymentBody?.entryId))
    expect(paymentLines.find((line) => line.account_code === '2000')?.debit_amount).toBe('1150.0000')
    expect(paymentLines.find((line) => line.account_code === '2110')?.credit_amount).toBe('57.5000')
    expect(paymentLines.find((line) => line.account_code === '1010')?.credit_amount).toBe('1092.5000')

    const invoiceAfter = await apiRequest(request, 'GET', `${INVOICES}?ids=${invoiceId}&pageSize=1`, { token })
    const invoiceAfterBody = await readJsonSafe<{ items?: Array<{ status: string }> }>(invoiceAfter)
    expect(invoiceAfterBody?.items?.[0]?.status).toBe('paid')

    const aging = await apiRequest(request, 'GET', `${AGING}?asOf=${todayIso}`, { token })
    const agingBody = await readJsonSafe<{ totalOutstanding: string; ledgerBalance: string; reconciliationDelta: string }>(aging)
    expect(agingBody?.totalOutstanding).toBe(baseline?.totalOutstanding)
    expect(agingBody?.ledgerBalance).toBe(baseline?.ledgerBalance)
    expect(agingBody?.reconciliationDelta).toBe(baseline?.reconciliationDelta)
  })
})
