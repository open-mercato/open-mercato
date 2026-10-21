import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['financial'],
}

/**
 * TC-FINANCIAL-006: a bank CSV imports and matches a posted cash movement.
 *
 * The ledger entry is the only candidate with the same amount, direction and
 * date, so a successful match proves the parser, the account resolution and the
 * candidate filter agree. A second run of the matcher must find nothing new.
 */

const CHART = '/api/financial/chart-of-accounts'
const ACCOUNTS = '/api/financial/accounts'
const PERIODS = '/api/financial/periods'
const ENTRIES = '/api/financial/journal-entries'
const POST = '/api/financial/journal-entries/post'
const IMPORT = '/api/financial/bank-statements/import'
const MATCH = '/api/financial/bank-statements/match'
const LINES = '/api/financial/bank-statements/lines'

let fixtureCounter = 0
function uniqueSuffix(): string {
  fixtureCounter += 1
  return `${Date.now()}-${fixtureCounter}`
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
  const response = await apiRequest(request, 'POST', PERIODS, {
    token,
    data: {
      fiscalYear: year,
      periodNumber: month + 1,
      periodName: `${year}-${String(month + 1).padStart(2, '0')} ${uniqueSuffix()}`,
      startDate: new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10),
      endDate: new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10),
    },
  })
  const created = await readJsonSafe<{ id?: string }>(response)
  expect(response.ok()).toBeTruthy()
  return String(created?.id)
}

test.describe('TC-FINANCIAL-006: bank reconciliation', () => {
  test('a CSV line matches the posted cash movement', async ({ request }) => {
    const token = await getAuthToken(request)
    const suffix = uniqueSuffix()
    const todayIso = new Date().toISOString().slice(0, 10)

    await apiRequest(request, 'POST', CHART, { token, data: { countryCode: 'SA' } })
    const periodId = await resolvePeriodForToday(request, token)
    const cashAccountId = await findAccountId(request, token, '1000')
    const revenueAccountId = await findAccountId(request, token, '4000')

    const entryResponse = await apiRequest(request, 'POST', ENTRIES, {
      token,
      data: {
        entryNumber: `BANK-${suffix}`,
        entryDate: todayIso,
        postingDate: todayIso,
        periodId,
        description: `Bank reconciliation ${suffix}`,
        currencyCode: 'SAR',
        lines: [
          { accountId: cashAccountId, debitAmount: '1000.00', creditAmount: '0' },
          { accountId: revenueAccountId, debitAmount: '0', creditAmount: '1000.00' },
        ],
      },
    })
    const entry = await readJsonSafe<{ id?: string }>(entryResponse)
    expect(entryResponse.ok(), `POST ${ENTRIES} failed with ${entryResponse.status()}`).toBeTruthy()
    const posted = await apiRequest(request, 'POST', POST, { token, data: { id: entry?.id } })
    expect(posted.ok()).toBeTruthy()

    const cashAccounts = await apiRequest(request, 'GET', '/api/financial/cash-accounts?pageSize=100', { token })
    const cashBody = await readJsonSafe<{ items?: Array<{ id: string; account_id: string }> }>(cashAccounts)
    const cashRegister = (cashBody?.items ?? []).find((row) => row.account_id === cashAccountId)
      ?? (cashBody?.items ?? [])[0]
    expect(cashRegister, 'a cash register must exist for the imported account').toBeTruthy()

    const csv = [
      'date,description,reference,amount',
      `${todayIso},Transfer in,${suffix},1000.00`,
    ].join('\n')
    const imported = await request.post(IMPORT, {
      headers: { Authorization: `Bearer ${token}` },
      multipart: {
        cashAccountId: cashRegister?.id as string,
        file: { name: `statement-${suffix}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv) },
      },
    })
    const importedBody = await readJsonSafe<{ id?: string; lineCount?: number }>(imported)
    expect(imported.ok(), `POST ${IMPORT} failed with ${imported.status()}: ${JSON.stringify(importedBody)}`).toBeTruthy()
    const statementId = String(importedBody?.id)
    expect(importedBody?.lineCount).toBe(1)

    const matched = await apiRequest(request, 'POST', MATCH, { token, data: { id: statementId } })
    const matchedBody = await readJsonSafe<{ matched?: number; unmatched?: number }>(matched)
    expect(matched.ok(), `POST ${MATCH} failed with ${matched.status()}: ${JSON.stringify(matchedBody)}`).toBeTruthy()
    expect(matchedBody?.matched).toBe(1)
    expect(matchedBody?.unmatched).toBe(0)

    const lines = await apiRequest(request, 'GET', `${LINES}?id=${statementId}`, { token })
    const linesBody = await readJsonSafe<{ items?: Array<{ status: string }> }>(lines)
    expect(linesBody?.items?.[0]?.status).toBe('matched')

    const again = await apiRequest(request, 'POST', MATCH, { token, data: { id: statementId } })
    const againBody = await readJsonSafe<{ matched?: number }>(again)
    expect(againBody?.matched).toBe(0)
  })
})
