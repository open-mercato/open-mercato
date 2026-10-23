// Step definitions for `../features/journal_entry_line_currency.feature`.
//
// Exercises the real `ledger.postJournalEntry` / `ledger.reverseJournalEntry`
// commands against the fake persistence layer in `../support/world.ts`.
// Every line stores `currencyId`, `exchangeRate` and `amountCurrency` next to
// the base-currency `debit`/`credit` (see `lib/lineCurrency.ts`); these
// scenarios assert on what ends up in the fake `JournalEntryLine` table and
// on the 422 messages of the line-level rules.
import { Given, When, Then, type DataTable } from '@cucumber/cucumber'
import assert from 'node:assert'
import '../../commands/postJournalEntry'
import '../../commands/reverseJournalEntry'
import { FiscalPeriod, JournalEntryLine, LedgerAccount } from '../../data/entities'
import { Currency } from '@open-mercato/core/modules/currencies/data/entities'
import {
  buildCommandContext,
  captureRejection,
  executeCommand,
  FakeEntityManager,
  newId,
  ORG_ID,
  setActiveEm,
  TENANT_ID,
} from '../support/world'
import type { PostJournalEntryResult } from '../../commands/postJournalEntry'

const OPERATION_DATE = '2026-10-15'

let em: FakeEntityManager
let currencyIds: Record<string, string>
let accountIds: Record<string, string>
let outcome: PostJournalEntryResult | null
let rejection: unknown
let postedEntryId: string

function seedCurrency(target: FakeEntityManager, code: string, isBase: boolean): string {
  const id = newId()
  target.seed(Currency, { id, organizationId: ORG_ID, tenantId: TENANT_ID, code, name: code, isBase, decimalPlaces: 2, deletedAt: null })
  return id
}

function seedAccount(target: FakeEntityManager, number: string, currencyId: string | null): string {
  const id = newId()
  target.seed(LedgerAccount, {
    id,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    number,
    accountTypeId: newId(),
    currencyId,
    deletedAt: null,
  })
  return id
}

Given(
  'a ledger with base currency {string}, foreign currencies {string} and {string}, and an open fiscal period for October 2026',
  function (base: string, foreignA: string, foreignB: string) {
    em = setActiveEm(new FakeEntityManager())
    currencyIds = {
      [base]: seedCurrency(em, base, true),
      [foreignA]: seedCurrency(em, foreignA, false),
      [foreignB]: seedCurrency(em, foreignB, false),
    }
    em.seed(FiscalPeriod, {
      id: newId(),
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      startDate: new Date('2026-10-01'),
      endDate: new Date('2026-10-31'),
      isLocked: false,
      deletedAt: null,
    })
    accountIds = {
      payable: seedAccount(em, 'payable', null),
      receivable: seedAccount(em, 'receivable', null),
      expense: seedAccount(em, 'expense', null),
      fx_gain: seedAccount(em, 'fx_gain', null),
      // A bank account kept in one currency: every line on it must be in USD.
      bank_usd: seedAccount(em, 'bank_usd', currencyIds.USD),
    }
  },
)

function buildInput(headerCurrency: string, headerRate: string | null, table: DataTable) {
  const lines = table.hashes().map((row) => {
    const line: Record<string, unknown> = { accountId: accountIds[row.account] }
    line[row.side] = row.amount
    if (row.currency) line.currencyId = currencyIds[row.currency]
    if (row.rate) line.exchangeRate = row.rate
    if (row.original) line.amountCurrency = row.original
    return line
  })
  const input: Record<string, unknown> = {
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    operationDate: OPERATION_DATE,
    description: 'BDD scenario: currency on the journal entry line',
    currencyId: currencyIds[headerCurrency],
    lines,
  }
  if (headerRate) input.exchangeRate = headerRate
  return input
}

async function post(input: Record<string, unknown>): Promise<void> {
  outcome = null
  rejection = await captureRejection(async () => {
    outcome = await executeCommand<PostJournalEntryResult>('ledger.postJournalEntry', input, buildCommandContext(em))
  })
}

When(
  'I post an entry with header currency {string} and rate {string} and lines:',
  async function (headerCurrency: string, headerRate: string, table: DataTable) {
    await post(buildInput(headerCurrency, headerRate, table))
  },
)

When('I post an entry with header currency {string} and no rate and lines:', async function (headerCurrency: string, table: DataTable) {
  await post(buildInput(headerCurrency, null, table))
})

Given(
  'I have posted an entry with header currency {string} and rate {string} and lines:',
  async function (headerCurrency: string, headerRate: string, table: DataTable) {
    await post(buildInput(headerCurrency, headerRate, table))
    assert.strictEqual(rejection, null, `the fixture entry must post, but it rejected with ${String(rejection)}`)
    postedEntryId = outcome!.journalEntryId
  },
)

When('I reverse that entry with the same operation date', async function () {
  outcome = null
  rejection = await captureRejection(async () => {
    outcome = await executeCommand<PostJournalEntryResult>(
      'ledger.reverseJournalEntry',
      { organizationId: ORG_ID, tenantId: TENANT_ID, journalEntryId: postedEntryId, operationDate: OPERATION_DATE },
      buildCommandContext(em),
    )
  })
})

async function assertStoredLines(entryId: string, table: DataTable): Promise<void> {
  const stored = await em.find(JournalEntryLine, { journalEntryId: entryId })
  const expected = table.hashes()
  assert.strictEqual(stored.length, expected.length, `expected ${expected.length} stored lines, got ${stored.length}`)
  for (const row of expected) {
    const line = stored.find((candidate) => candidate.accountId === accountIds[row.account])
    assert.ok(line, `no stored line for account "${row.account}"`)
    assert.strictEqual(line!.currencyId, currencyIds[row.currency], `account "${row.account}": wrong currency`)
    assert.strictEqual(Number(line!.exchangeRate), Number(row.rate), `account "${row.account}": wrong rate`)
    assert.strictEqual(Number(line!.amountCurrency), Number(row.original), `account "${row.account}": wrong original amount`)
  }
}

Then('the entry is stored with these lines:', async function (table: DataTable) {
  assert.strictEqual(rejection, null, `expected the entry to post, but it rejected with ${String(rejection)}`)
  assert.ok(outcome, 'expected a result from postJournalEntry')
  await assertStoredLines(outcome!.journalEntryId, table)
})

Then('the reversal is stored with these lines:', async function (table: DataTable) {
  assert.strictEqual(rejection, null, `expected the reversal to succeed, but it rejected with ${String(rejection)}`)
  assert.ok(outcome, 'expected a result from reverseJournalEntry')
  assert.notStrictEqual(outcome!.journalEntryId, postedEntryId)
  await assertStoredLines(outcome!.journalEntryId, table)
})

function assertRejected(pattern: RegExp): void {
  assert.ok(rejection, 'expected postJournalEntry to reject, but it succeeded')
  const err = rejection as { status?: number; body?: { error?: string } }
  assert.strictEqual(err.status, 422)
  assert.match(String(err.body?.error), pattern)
}

Then('the post is rejected with status 422 because the line needs an original-currency amount', function () {
  assertRejected(/original-currency amount/i)
})

Then('the post is rejected with status 422 because the line needs an exchange rate', function () {
  assertRejected(/needs an exchange rate/i)
})

Then('the post is rejected with status 422 because the original amount and rate do not match the base amount', function () {
  assertRejected(/does not match the base-currency amount/i)
})

Then('the post is rejected with status 422 because the line currency differs from its account', function () {
  assertRejected(/differs from its account/i)
})
