// Step definitions for `../features/fiscal_period_locking.feature`.
//
// Exercises the REAL `ledger.postJournalEntry` command (not a
// reimplementation of its logic) against the fake persistence layer in
// `../support/world.ts`. Importing `../../commands/postJournalEntry`
// triggers that module's own top-level `registerCommand(...)` call exactly
// once, the same way requiring it from a real route handler would.
import { Given, When, Then } from '@cucumber/cucumber'
import assert from 'node:assert'
import '../../commands/postJournalEntry'
import { FiscalPeriod } from '../../data/entities'
import { buildCommandContext, executeCommand, FakeEntityManager, newId, ORG_ID, TENANT_ID, captureRejection } from '../support/world'
import type { PostJournalEntryResult } from '../../commands/postJournalEntry'

const CASH_ACCOUNT_ID = newId()
const REVENUE_ACCOUNT_ID = newId()
const CURRENCY_ID = newId()

let em: FakeEntityManager
let outcome: PostJournalEntryResult | null
let rejection: unknown

function balancedInput(operationDate: string) {
  return {
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    operationDate,
    description: 'BDD scenario: fiscal period locking',
    currencyId: CURRENCY_ID,
    lines: [
      { accountId: CASH_ACCOUNT_ID, debit: '100.0000' },
      { accountId: REVENUE_ACCOUNT_ID, credit: '100.0000' },
    ],
  }
}

Given('a fiscal period from {string} to {string} that is locked', function (start: string, end: string) {
  em = new FakeEntityManager()
  em.seed(FiscalPeriod, {
    id: newId(),
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    startDate: new Date(start),
    endDate: new Date(end),
    isLocked: true,
    deletedAt: null,
  })
})

Given('a fiscal period from {string} to {string} that is open', function (start: string, end: string) {
  em = new FakeEntityManager()
  em.seed(FiscalPeriod, {
    id: newId(),
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    startDate: new Date(start),
    endDate: new Date(end),
    isLocked: false,
    deletedAt: null,
  })
})

Given('no fiscal period exists for {string}', function (_operationDate: string) {
  em = new FakeEntityManager()
})

When('I post a balanced journal entry dated {string}', async function (operationDate: string) {
  outcome = null
  rejection = null
  const ctx = buildCommandContext(em)
  const input = balancedInput(operationDate)
  const err = await captureRejection(async () => {
    outcome = await executeCommand<PostJournalEntryResult>('ledger.postJournalEntry', input, ctx)
  })
  rejection = err
})

Then('the post is rejected because the fiscal period is locked', function () {
  assert.ok(rejection, 'expected postJournalEntry to reject, but it succeeded')
  const err = rejection as { status?: number; body?: { error?: string } }
  assert.strictEqual(err.status, 422)
  assert.match(String(err.body?.error), /locked/i)
})

Then('the post is rejected because no fiscal period covers the date', function () {
  assert.ok(rejection, 'expected postJournalEntry to reject, but it succeeded')
  const err = rejection as { status?: number; body?: { error?: string } }
  assert.strictEqual(err.status, 422)
  assert.match(String(err.body?.error), /no fiscal period/i)
})

Then('the post succeeds and a journal entry is recorded with sequence number {int}', function (expectedSequence: number) {
  assert.strictEqual(rejection, null, `expected postJournalEntry to succeed, but it rejected with ${String(rejection)}`)
  assert.ok(outcome, 'expected a result from postJournalEntry')
  assert.strictEqual(outcome!.sequenceNumber, expectedSequence)
  assert.ok(outcome!.journalEntryId)
})
