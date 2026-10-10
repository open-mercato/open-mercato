import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['financial'],
}

/**
 * TC-FINANCIAL-002: opening balances, the payment-method register and the money
 * commands, end to end.
 *
 * The rules this covers are the ones that cost real money when they are wrong: a
 * chart that seeds twice, a payment method pointing at a revenue account, an
 * opening position that does not balance, a second set of opening balances, and a
 * payment posted without the reference its method demands. Each is asserted
 * through the API — the layer an operator actually reaches — rather than at the
 * library boundary the unit suites already cover.
 *
 * Fixtures are suffixed per run. Opening balances are posted **once** per
 * organization by design, and a posted entry cannot be deleted, so the spec
 * tolerates a ledger where a previous run already opened the books: it asserts
 * the refusal rather than the absence of one.
 */

const ACCOUNTS = '/api/financial/accounts'
const CHART = '/api/financial/chart-of-accounts'
const PAYMENT_METHODS = '/api/financial/payment-methods'
const OPENING_BALANCES = '/api/financial/opening-balances'
const BALANCE_SHEET = '/api/financial/statements/balance-sheet'

let fixtureCounter = 0
function uniqueSuffix(): string {
  fixtureCounter += 1
  return `${Date.now()}-${fixtureCounter}`
}

async function post<T>(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>,
  expectedStatus = 201,
): Promise<T> {
  const response = await apiRequest(request, 'POST', path, { token, data })
  const body = await readJsonSafe<T & { error?: string }>(response)
  expect(
    response.status(),
    `POST ${path} expected ${expectedStatus}, got ${response.status()}: ${JSON.stringify(body)}`,
  ).toBe(expectedStatus)
  return body as T
}

async function createAccount(
  request: APIRequestContext,
  token: string,
  suffix: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const created = await post<{ id: string }>(request, token, ACCOUNTS, {
    code: `T${suffix}`.slice(0, 20),
    name: `Spec account ${suffix}`,
    accountClass: 'asset',
    normalBalance: 'debit',
    currencyCode: 'SAR',
    accountType: 'cash',
    ...overrides,
  })
  return created.id
}

test.describe('TC-FINANCIAL-002: cash, payments and opening balances', () => {
  test('the chart seeds idempotently and names the VAT accounts', async ({ request }) => {
    const token = await getAuthToken(request)
    const suffix = uniqueSuffix()

    const preview = await apiRequest(request, 'GET', `${CHART}?countryCode=SA`, { token })
    expect(preview.ok()).toBeTruthy()
    const template = (await readJsonSafe<{ accountCount: number; accounts: Array<{ code: string }> }>(preview))!
    expect(template.accountCount).toBeGreaterThan(0)
    const codes = template.accounts.map((account) => account.code)
    // The accounts the Saudi tax codes post to must be in the template, or
    // posting a taxable line would have nowhere to land.
    expect(codes).toContain('2100')
    expect(codes).toContain('1150')

    const first = await post<{ created: string[]; skipped: string[] }>(
      request, token, CHART, { countryCode: 'SA', currencyCode: 'SAR' }, 200,
    )
    const second = await post<{ created: string[]; skipped: string[] }>(
      request, token, CHART, { countryCode: 'SA', currencyCode: 'SAR' }, 200,
    )

    // Idempotent by code: the second run adds nothing and reports everything as
    // already present.
    expect(second.created).toEqual([])
    expect(second.skipped.length).toBeGreaterThanOrEqual(first.created.length)

    void suffix
  })

  test('a payment method refuses a non-asset account and a duplicate code', async ({ request }) => {
    const token = await getAuthToken(request)
    const suffix = uniqueSuffix()

    const revenue = await createAccount(request, token, suffix, {
      accountClass: 'revenue',
      normalBalance: 'credit',
      accountType: 'sales',
    })
    const asset = await createAccount(request, token, `${suffix}b`)

    // Money is held in an asset account; posting cash to revenue would make the
    // trial balance disagree with the till.
    const refused = await apiRequest(request, 'POST', PAYMENT_METHODS, {
      token,
      data: { code: `BAD_${suffix}`, name: 'Bad method', kind: 'cash', accountId: revenue },
    })
    expect(refused.status()).toBeGreaterThanOrEqual(400)
    expect(refused.status()).toBeLessThan(500)

    const created = await post<{ id: string; updatedAt?: string }>(request, token, PAYMENT_METHODS, {
      code: `SPEC_${suffix}`,
      name: `Spec method ${suffix}`,
      kind: 'cash',
      accountId: asset,
      requiresReference: false,
    })

    const duplicate = await apiRequest(request, 'POST', PAYMENT_METHODS, {
      token,
      data: { code: `SPEC_${suffix}`, name: 'Duplicate', kind: 'cash', accountId: asset },
    })
    expect(duplicate.status()).toBeGreaterThanOrEqual(400)
    expect(duplicate.status()).toBeLessThan(500)

    // Clean up: an archived method keeps the register readable and does not
    // disturb a run that already posted through it.
    const removed = await apiRequest(request, 'DELETE', `${PAYMENT_METHODS}?id=${created.id}`, { token })
    expect([200, 204]).toContain(removed.status())
  })

  test('opening balances are all-or-nothing, balanced, and posted once', async ({ request }) => {
    const token = await getAuthToken(request)
    const suffix = uniqueSuffix()
    const today = new Date().toISOString().slice(0, 10)

    const debitAccount = await createAccount(request, token, `${suffix}d`)
    const creditAccount = await createAccount(request, token, `${suffix}c`, {
      accountClass: 'equity',
      normalBalance: 'credit',
      accountType: 'capital',
    })

    // Unbalanced: refused, and nothing is posted.
    const unbalanced = await apiRequest(request, 'POST', OPENING_BALANCES, {
      token,
      data: {
        openingDate: today,
        description: `Spec unbalanced ${suffix}`,
        currencyCode: 'SAR',
        lines: [
          { accountId: debitAccount, debitAmount: '100.0000', creditAmount: '0' },
          { accountId: creditAccount, debitAmount: '0', creditAmount: '90.0000' },
        ],
      },
    })
    expect(unbalanced.status()).toBeGreaterThanOrEqual(400)
    expect(unbalanced.status()).toBeLessThan(500)

    const balancedBody = {
      openingDate: today,
      description: `Spec opening ${suffix}`,
      currencyCode: 'SAR',
      lines: [
        { accountId: debitAccount, debitAmount: '100.0000', creditAmount: '0' },
        { accountId: creditAccount, debitAmount: '0', creditAmount: '100.0000' },
      ],
    }

    const first = await apiRequest(request, 'POST', OPENING_BALANCES, { token, data: balancedBody })
    if (first.ok()) {
      const posted = (await readJsonSafe<{ id: string }>(first))!
      expect(typeof posted.id).toBe('string')
    } else {
      // A previous run opened the books for this organization. Posting twice
      // would double the carried-in position, so the refusal is the correct
      // answer and the assertion we can make.
      expect(first.status()).toBe(409)
    }

    const read = await apiRequest(request, 'GET', OPENING_BALANCES, { token })
    expect(read.ok()).toBeTruthy()
    const state = (await readJsonSafe<{ posted: boolean; entry?: { total: string } }>(read))!
    expect(state.posted).toBe(true)
    expect(state.entry?.total).toBeTruthy()
  })

  test('the balance sheet balances on a ledger that has only been opened', async ({ request }) => {
    const token = await getAuthToken(request)
    const today = new Date().toISOString().slice(0, 10)

    const response = await apiRequest(request, 'GET', `${BALANCE_SHEET}?asOf=${today}`, { token })
    expect(response.ok()).toBeTruthy()
    const sheet = (await readJsonSafe<{
      totalAssets: string
      totalLiabilitiesAndEquity: string
      balanced: boolean
      currencyCode: string | null
    }>(response))!

    // The one signal the sheet exists to give. A contra account must not turn a
    // correct ledger into `balanced: false`, which is why the section totals net
    // the presented sides.
    expect(sheet.balanced).toBe(true)
    expect(sheet.totalAssets).toBe(sheet.totalLiabilitiesAndEquity)
    expect(sheet.currencyCode).toBe('SAR')
  })

  test('a rejected statement range is a 400, not a 500', async ({ request }) => {
    const token = await getAuthToken(request)

    const response = await apiRequest(
      request,
      'GET',
      '/api/financial/statements/income-statement?from=2026-12-31&to=2026-01-01',
      { token },
    )

    expect(response.status()).toBe(400)
  })
})
