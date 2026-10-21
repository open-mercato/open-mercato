import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['financial', 'saudi_localization', 'sales'],
}

/**
 * TC-SL-FIN-001: the Saudi financial plugin is wired to the ledger and its return.
 *
 * Two paths that only exist when the plugin and the ledger agree:
 *
 * 1. Seeding the Saudi chart of accounts is idempotent by account code, so the VAT
 *    and receivables accounts the tax catalogue names exist exactly once.
 * 2. A posted taxable sale — a receivable, a revenue base line and an output-VAT
 *    line, all carrying `SA-VAT-S` — is classified by the return's line roles into
 *    the standard-rated bucket, and the reconciliation delta is zero.
 *
 * The posted entry is written through the public API, and the period is a far-future
 * one. Postings are append-only, so the return is asserted as a movement from a
 * baseline captured before the fixture rather than as an absolute total.
 */

const CHART = '/api/financial/chart-of-accounts'
const ACCOUNTS = '/api/financial/accounts'
const PERIODS = '/api/financial/periods'
const ENTRIES = '/api/financial/journal-entries'
const POST = '/api/financial/journal-entries/post'
const VAT_RETURN = '/api/saudi_localization/vat-return'
const VAT_SETTINGS = '/api/saudi_localization/vat-settings'
const ZATCA_ISSUE = '/api/saudi_localization/zatca/issue'
const SALES_ORDERS = '/api/sales/orders'

const FISCAL_YEAR = 2099
const PERIOD_NUMBER = 4

let fixtureCounter = 0
function uniqueSuffix(): string {
  fixtureCounter += 1
  return `${Date.now()}-${fixtureCounter}`
}

type AccountRow = { id: string; code: string }
type ChartPreview = { missingCodes: string[] }
type ChartSeedResult = { created: string[]; skipped: string[] }
type VatReturn = {
  standardRated: { net: string; tax: string }
  outputVat: string
  reconciliationDelta: string
}

async function createEntity(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', path, { token, data })
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(response.ok(), `POST ${path} failed with ${response.status()}: ${JSON.stringify(body)}`).toBeTruthy()
  expect(typeof body?.id === 'string' && body.id.length > 0, `POST ${path} returned no id`).toBe(true)
  return body?.id as string
}

async function listAccounts(request: APIRequestContext, token: string): Promise<AccountRow[]> {
  const response = await apiRequest(request, 'GET', `${ACCOUNTS}?pageSize=100`, { token })
  const body = await readJsonSafe<{ items?: AccountRow[] }>(response)
  expect(response.ok(), `GET ${ACCOUNTS} failed with ${response.status()}`).toBeTruthy()
  return body?.items ?? []
}

async function findAccountId(
  request: APIRequestContext,
  token: string,
  code: string,
): Promise<string> {
  const accounts = await listAccounts(request, token)
  const account = accounts.find((row) => row.code === code)
  expect(account, `account ${code} must exist after seeding the Saudi chart`).toBeTruthy()
  return account?.id as string
}

async function resolveFarFuturePeriod(request: APIRequestContext, token: string): Promise<string> {
  const existing = await apiRequest(request, 'GET', `${PERIODS}?fiscalYear=${FISCAL_YEAR}&pageSize=100`, { token })
  const body = await readJsonSafe<{ items?: Array<{ id: string; period_number: number }> }>(existing)
  expect(existing.ok(), `GET ${PERIODS} failed with ${existing.status()}`).toBeTruthy()
  const period = (body?.items ?? []).find((row) => row.period_number === PERIOD_NUMBER)
  if (period) return period.id
  return createEntity(request, token, PERIODS, {
    fiscalYear: FISCAL_YEAR,
    periodNumber: PERIOD_NUMBER,
    periodName: `Q4 ${FISCAL_YEAR} ${uniqueSuffix()}`,
    startDate: `${FISCAL_YEAR}-10-01`,
    endDate: `${FISCAL_YEAR}-12-31`,
  })
}

test.describe('TC-SL-FIN-001: Saudi financial plugin', () => {
  test('seeding the Saudi chart is idempotent by account code', async ({ request }) => {
    const token = await getAuthToken(request)

    const first = await apiRequest(request, 'POST', CHART, { token, data: { countryCode: 'SA' } })
    const firstBody = await readJsonSafe<ChartSeedResult>(first)
    expect(first.ok(), `POST ${CHART} failed with ${first.status()}: ${JSON.stringify(firstBody)}`).toBeTruthy()
    expect(firstBody?.created, 'the first seed must report the accounts it created').toBeTruthy()

    const preview = await apiRequest(request, 'GET', `${CHART}?countryCode=SA`, { token })
    const previewBody = await readJsonSafe<ChartPreview>(preview)
    expect(preview.ok()).toBeTruthy()
    expect(previewBody?.missingCodes, 'no Saudi account may be missing after a seed').toEqual([])

    const second = await apiRequest(request, 'POST', CHART, { token, data: { countryCode: 'SA' } })
    const secondBody = await readJsonSafe<ChartSeedResult>(second)
    expect(second.ok()).toBeTruthy()
    expect(secondBody?.created, 'a second seed must create nothing').toEqual([])
  })

  test('a taxable posting reconciles to the VAT return', async ({ request }) => {
    const token = await getAuthToken(request)
    const suffix = uniqueSuffix()
    const postingDate = `${FISCAL_YEAR}-11-15`

    await apiRequest(request, 'POST', CHART, { token, data: { countryCode: 'SA' } })

    const receivableId = await findAccountId(request, token, '1100')
    const revenueId = await findAccountId(request, token, '4000')
    const outputVatId = await findAccountId(request, token, '2100')

    const periodId = await resolveFarFuturePeriod(request, token)
    const baselineVat = await apiRequest(
      request,
      'GET',
      `${VAT_RETURN}?fiscalYear=${FISCAL_YEAR}&frequency=quarterly&periodNumber=${PERIOD_NUMBER}`,
      { token },
    )
    const baselineVatBody = await readJsonSafe<VatReturn>(baselineVat)
    expect(baselineVat.ok(), `GET ${VAT_RETURN} failed with ${baselineVat.status()}: ${JSON.stringify(baselineVatBody)}`).toBeTruthy()

    const entryId = await createEntity(request, token, ENTRIES, {
      entryNumber: `SL-FIN-${suffix}`,
      entryDate: postingDate,
      postingDate,
      periodId,
      description: `Saudi VAT posting ${suffix}`,
      currencyCode: 'SAR',
      lines: [
        {
          accountId: receivableId,
          debitAmount: '1150.00',
          creditAmount: '0',
          taxCode: 'SA-VAT-S',
        },
        {
          accountId: revenueId,
          debitAmount: '0',
          creditAmount: '1000.00',
          taxCode: 'SA-VAT-S',
        },
        {
          accountId: outputVatId,
          debitAmount: '0',
          creditAmount: '150.00',
          taxCode: 'SA-VAT-S',
        },
      ],
    })

    const posted = await apiRequest(request, 'POST', POST, { token, data: { id: entryId } })
    expect(posted.ok(), `POST ${POST} failed with ${posted.status()}`).toBeTruthy()

    const vat = await apiRequest(
      request,
      'GET',
      `${VAT_RETURN}?fiscalYear=${FISCAL_YEAR}&frequency=quarterly&periodNumber=${PERIOD_NUMBER}`,
      { token },
    )
    const vatBody = await readJsonSafe<VatReturn>(vat)
    expect(vat.ok(), `GET ${VAT_RETURN} failed with ${vat.status()}: ${JSON.stringify(vatBody)}`).toBeTruthy()
    expect(Number(vatBody?.standardRated.net) - Number(baselineVatBody?.standardRated.net)).toBeCloseTo(1000, 2)
    expect(Number(vatBody?.standardRated.tax) - Number(baselineVatBody?.standardRated.tax)).toBeCloseTo(150, 2)
    expect(Number(vatBody?.outputVat) - Number(baselineVatBody?.outputVat)).toBeCloseTo(150, 2)
    expect(vatBody?.reconciliationDelta, 'the posted VAT must equal what the rate implies').toBe('0.00')
  })

  test('issuance persists the document and is idempotent per order', async ({ request }) => {
    const token = await getAuthToken(request)
    const suffix = uniqueSuffix()

    const settings = await apiRequest(request, 'PUT', VAT_SETTINGS, {
      token,
      data: {
        sellerName: `Seller ${suffix}`,
        vatRegistrationNumber: '300000000000003',
        commercialRegistrationNumber: null,
        vatRate: 0.15,
        invoiceQrEnabled: true,
        filingFrequency: 'quarterly',
      },
    })
    expect(settings.ok(), `PUT ${VAT_SETTINGS} failed with ${settings.status()}`).toBeTruthy()

    const orderResponse = await apiRequest(request, 'POST', SALES_ORDERS, {
      token,
      data: {
        currencyCode: 'SAR',
        customerSnapshot: {
          id: '00000000-0000-0000-0000-000000000000',
          kind: 'company',
          displayName: `Buyer ${suffix}`,
          vatNumber: '300000000000003',
        },
        lines: [{
          kind: 'service',
          name: `ZATCA issuance ${suffix}`,
          quantity: 1,
          currencyCode: 'SAR',
          unitPriceNet: 100,
          unitPriceGross: 115,
          taxRate: 15,
          taxAmount: 15,
          totalNetAmount: 100,
          totalGrossAmount: 115,
        }],
        subtotalNetAmount: 100,
        taxTotalAmount: 15,
        grandTotalNetAmount: 100,
        grandTotalGrossAmount: 115,
      },
    })
    const orderBody = await readJsonSafe<{ orderId?: string; id?: string }>(orderResponse)
    expect(orderResponse.ok(), `POST ${SALES_ORDERS} failed with ${orderResponse.status()}: ${JSON.stringify(orderBody)}`).toBeTruthy()
    const orderId = String(orderBody?.orderId ?? orderBody?.id)

    const first = await apiRequest(request, 'POST', ZATCA_ISSUE, { token, data: { orderId } })
    const firstBody = await readJsonSafe<{
      id: string
      status: string
      icv: number
      invoiceHash: string
      xml: string
      signed: boolean
      submittedToZatca: boolean
      reused: boolean
    }>(first)
    expect(first.ok(), `POST ${ZATCA_ISSUE} failed with ${first.status()}: ${JSON.stringify(firstBody)}`).toBeTruthy()
    expect(firstBody?.status).toBe('pending')
    expect(firstBody?.reused).toBe(false)
    expect(typeof firstBody?.icv).toBe('number')
    expect(firstBody?.icv).toBeGreaterThan(0)
    expect(firstBody?.invoiceHash.length).toBeGreaterThan(10)
    expect(firstBody?.xml).toContain('<Invoice')
    expect(firstBody?.signed, 'no issuance path may claim a signature before CSID onboarding').toBe(false)
    expect(firstBody?.submittedToZatca, 'no issuance path may claim ZATCA submission').toBe(false)

    const second = await apiRequest(request, 'POST', ZATCA_ISSUE, { token, data: { orderId } })
    const secondBody = await readJsonSafe<{ id: string; icv: number; reused: boolean }>(second)
    expect(second.ok()).toBeTruthy()
    expect(secondBody?.reused).toBe(true)
    expect(secondBody?.id).toBe(firstBody?.id)
    expect(secondBody?.icv).toBe(firstBody?.icv)
  })
})
