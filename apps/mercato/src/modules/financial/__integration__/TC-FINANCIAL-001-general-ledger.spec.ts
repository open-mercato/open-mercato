import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

export const integrationMeta = {
  dependsOnModules: ['financial'],
}

/**
 * TC-FINANCIAL-001: the general ledger enforces its accounting invariants end to end.
 *
 * Each rule the Phase-1 spec fixes is exercised through the API rather than asserted at the
 * library boundary again: an unbalanced entry is refused, a posted entry is immutable, a
 * reversal mirrors the original and nets the trial balance to zero, a closed period refuses
 * posting, and a stale `updatedAt` is a 409 rather than a silent overwrite.
 *
 * The fixtures are suffixed per run, so a previous run's posted rows — which the ledger
 * deliberately does not allow deleting — never collide with this one.
 */

const ACCOUNTS = '/api/financial/accounts'
const PERIODS = '/api/financial/periods'
const ENTRIES = '/api/financial/journal-entries'
const TRIAL_BALANCE = '/api/financial/trial-balance'

type TrialBalance = { lines: Array<{ accountId: string; debit: string; credit: string }>; balanced: boolean }

let fixtureCounter = 0
function uniqueSuffix(): string {
  fixtureCounter += 1
  return `${Date.now()}-${fixtureCounter}`
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

async function readTrialBalance(
  request: APIRequestContext,
  token: string,
  periodId: string,
): Promise<TrialBalance> {
  const response = await apiRequest(request, 'GET', `${TRIAL_BALANCE}?periodId=${periodId}`, { token })
  const body = await readJsonSafe<TrialBalance>(response)
  expect(response.ok(), `GET trial-balance failed with ${response.status()}`).toBeTruthy()
  return body as TrialBalance
}

test.describe('TC-FINANCIAL-001: general ledger invariants', () => {
  test('balanced entries post, posted entries are immutable, reversals net out, closed periods refuse', async ({
    request,
  }) => {
    const token = await getAuthToken(request)
    const suffix = uniqueSuffix()
    const today = new Date().toISOString().slice(0, 10)
    const year = new Date().getUTCFullYear()

    const createdAccountIds: string[] = []
    const createdDraftEntryIds: string[] = []

    try {
      const debitAccountId = await createEntity(request, token, ACCOUNTS, {
        code: `1000-${suffix}`,
        name: `Cash ${suffix}`,
        accountClass: 'asset',
        normalBalance: 'debit',
        currencyCode: 'SAR',
      })
      const creditAccountId = await createEntity(request, token, ACCOUNTS, {
        code: `4000-${suffix}`,
        name: `Revenue ${suffix}`,
        accountClass: 'revenue',
        normalBalance: 'credit',
        currencyCode: 'SAR',
      })
      createdAccountIds.push(debitAccountId, creditAccountId)

      const listed = await apiRequest(request, 'GET', `${ACCOUNTS}?search=${encodeURIComponent(suffix)}`, { token })
      const listedBody = await readJsonSafe<{ items?: Array<{ id?: string }> }>(listed)
      expect(listed.ok()).toBeTruthy()
      const listedIds = (listedBody?.items ?? []).map((row) => row.id)
      expect(listedIds).toContain(debitAccountId)
      expect(listedIds).toContain(creditAccountId)

      const duplicate = await apiRequest(request, 'POST', ACCOUNTS, {
        token,
        data: {
          code: `1000-${suffix}`,
          name: `Cash duplicate ${suffix}`,
          accountClass: 'asset',
          normalBalance: 'debit',
          currencyCode: 'SAR',
        },
      })
      expect(duplicate.ok(), 'a duplicate account code must be refused by the unique index').toBeFalsy()

      const periodId = await createEntity(request, token, PERIODS, {
        fiscalYear: year,
        periodNumber: 1,
        periodName: `P1-${suffix}`,
        startDate: `${year}-01-01`,
        endDate: `${year}-12-31`,
      })

      const entryId = await createEntity(request, token, ENTRIES, {
        entryNumber: `JE-${suffix}`,
        entryDate: today,
        postingDate: today,
        periodId,
        description: `Opening entry ${suffix}`,
        currencyCode: 'SAR',
        lines: [
          { accountId: debitAccountId, debitAmount: '100.00' },
          { accountId: creditAccountId, creditAmount: '100.00' },
        ],
      })
      createdDraftEntryIds.push(entryId)

      const unbalanced = await apiRequest(request, 'POST', ENTRIES, {
        token,
        data: {
          entryNumber: `JE-BAD-${suffix}`,
          entryDate: today,
          postingDate: today,
          periodId,
          description: `Unbalanced ${suffix}`,
          currencyCode: 'SAR',
          lines: [
            { accountId: debitAccountId, debitAmount: '100.00' },
            { accountId: creditAccountId, creditAmount: '99.99' },
          ],
        },
      })
      expect(unbalanced.status(), 'an unbalanced entry must be refused at create').toBe(400)

      const posted = await apiRequest(request, 'POST', `${ENTRIES}/post`, { token, data: { id: entryId } })
      const postedBody = await readJsonSafe<{ status?: string }>(posted)
      expect(posted.ok(), `post failed with ${posted.status()}`).toBeTruthy()
      expect(postedBody?.status).toBe('posted')

      const attemptedEdit = await apiRequest(request, 'PUT', ENTRIES, {
        token,
        data: { id: entryId, description: 'edited after posting' },
      })
      expect(attemptedEdit.ok(), 'a posted entry must not be editable').toBeFalsy()

      const balanceAfterPost = await readTrialBalance(request, token, periodId)
      expect(balanceAfterPost.balanced).toBe(true)
      const debitLine = balanceAfterPost.lines.find((line) => line.accountId === debitAccountId)
      expect(debitLine?.debit).toBe('100.0000')

      const reversed = await apiRequest(request, 'POST', `${ENTRIES}/reverse`, { token, data: { id: entryId } })
      const reversedBody = await readJsonSafe<{ id?: string; originalId?: string }>(reversed)
      expect(reversed.ok(), `reverse failed with ${reversed.status()}`).toBeTruthy()
      expect(reversedBody?.originalId).toBe(entryId)

      const balanceAfterReversal = await readTrialBalance(request, token, periodId)
      expect(balanceAfterReversal.balanced).toBe(true)
      const netDebit = balanceAfterReversal.lines.find((line) => line.accountId === debitAccountId)
      expect(netDebit?.debit).toBe(netDebit?.credit)

      const staleDraftId = await createEntity(request, token, ENTRIES, {
        entryNumber: `JE-STALE-${suffix}`,
        entryDate: today,
        postingDate: today,
        periodId,
        description: `Stale ${suffix}`,
        currencyCode: 'SAR',
        lines: [
          { accountId: debitAccountId, debitAmount: '5.00' },
          { accountId: creditAccountId, creditAmount: '5.00' },
        ],
      })
      createdDraftEntryIds.push(staleDraftId)

      const stale = await apiRequest(request, 'POST', `${ENTRIES}/post`, {
        token,
        data: { id: staleDraftId },
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: '2000-01-01T00:00:00.000Z' },
      })
      expect(stale.status(), 'a stale updatedAt must surface as 409').toBe(409)

      const softClose = await apiRequest(request, 'POST', `${PERIODS}/close`, {
        token,
        data: { id: periodId, target: 'soft_closed' },
      })
      expect(softClose.ok(), `soft close failed with ${softClose.status()}`).toBeTruthy()
      const hardClose = await apiRequest(request, 'POST', `${PERIODS}/close`, {
        token,
        data: { id: periodId, target: 'hard_closed' },
      })
      expect(hardClose.ok(), `hard close failed with ${hardClose.status()}`).toBeTruthy()

      const reopen = await apiRequest(request, 'POST', `${PERIODS}/reopen`, { token, data: { id: periodId } })
      expect(reopen.ok(), 'a hard-closed period must not be reopenable').toBeFalsy()

      const closedDraftId = await createEntity(request, token, ENTRIES, {
        entryNumber: `JE-CLOSED-${suffix}`,
        entryDate: today,
        postingDate: today,
        periodId,
        description: `Closed period ${suffix}`,
        currencyCode: 'SAR',
        lines: [
          { accountId: debitAccountId, debitAmount: '1.00' },
          { accountId: creditAccountId, creditAmount: '1.00' },
        ],
      })
      createdDraftEntryIds.push(closedDraftId)

      const postIntoClosed = await apiRequest(request, 'POST', `${ENTRIES}/post`, {
        token,
        data: { id: closedDraftId },
      })
      expect(postIntoClosed.status(), 'posting into a hard-closed period must be refused').toBeGreaterThanOrEqual(400)
    } finally {
      for (const id of createdDraftEntryIds) {
        try {
          await apiRequest(request, 'DELETE', `${ENTRIES}?id=${encodeURIComponent(id)}`, { token })
        } catch {
          // Cleanup must not mask the assertion that failed first.
        }
      }
      for (const id of createdAccountIds) {
        try {
          await apiRequest(request, 'DELETE', `${ACCOUNTS}?id=${encodeURIComponent(id)}`, { token })
        } catch {
          // A posted account keeps its rows, which the ledger allows on purpose.
        }
      }
    }
  })
})

