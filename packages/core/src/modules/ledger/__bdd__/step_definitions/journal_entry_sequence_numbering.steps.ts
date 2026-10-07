// Step definitions for `../features/journal_entry_sequence_numbering.feature`.
//
// Exercises the REAL `ledger.postJournalEntry` command against the fake
// persistence layer, the same way `fiscal_period_locking.steps.ts` does.
// `FakeEntityManager.seedSequenceCounter`/`getConnection().execute()`
// already model `claimNextSequenceNumber`'s atomic
// `(organization_id, tenant_id)`-keyed allocation faithfully enough to
// exercise both invariants under test here: no gaps within one
// organization, and no mixing between two organizations under the same
// tenant.
import { Given, When, Then } from '@cucumber/cucumber'
import assert from 'node:assert'
import '../../commands/postJournalEntry'
import { FiscalPeriod, LedgerAccount } from '../../data/entities'
import { Currency } from '@open-mercato/core/modules/currencies/data/entities'
import type { PostJournalEntryResult } from '../../commands/postJournalEntry'
import { buildCommandContext, executeCommand, FakeEntityManager, newId, TENANT_ID, captureRejection } from '../support/world'

const CURRENCY_ID = newId()
const CASH_ACCOUNT_ID = newId()
const REVENUE_ACCOUNT_ID = newId()

function seedBaseline(em: FakeEntityManager, organizationId: string): void {
  em.seed(FiscalPeriod, {
    id: newId(),
    organizationId,
    tenantId: TENANT_ID,
    startDate: new Date('2026-06-01'),
    endDate: new Date('2026-06-30'),
    isLocked: false,
    deletedAt: null,
  })
  em.seed(Currency, { id: CURRENCY_ID, organizationId, tenantId: TENANT_ID, code: 'PLN', name: 'Polish Zloty', deletedAt: null })
  em.seed(LedgerAccount, { id: CASH_ACCOUNT_ID, organizationId, tenantId: TENANT_ID, slug: 'cash', accountTypeId: newId(), deletedAt: null })
  em.seed(LedgerAccount, { id: REVENUE_ACCOUNT_ID, organizationId, tenantId: TENANT_ID, slug: 'revenue', accountTypeId: newId(), deletedAt: null })
}

function balancedInput(organizationId: string) {
  return {
    organizationId,
    tenantId: TENANT_ID,
    operationDate: '2026-06-15',
    description: 'BDD scenario: journal entry sequence numbering',
    currencyId: CURRENCY_ID,
    lines: [
      { accountId: CASH_ACCOUNT_ID, debit: '10.00' },
      { accountId: REVENUE_ACCOUNT_ID, credit: '10.00' },
    ],
  }
}

function unbalancedInput(organizationId: string) {
  return {
    organizationId,
    tenantId: TENANT_ID,
    operationDate: '2026-06-15',
    description: 'BDD scenario: rejected posting attempt',
    currencyId: CURRENCY_ID,
    lines: [
      { accountId: CASH_ACCOUNT_ID, debit: '10.00' },
      { accountId: REVENUE_ACCOUNT_ID, credit: '5.00' },
    ],
  }
}

let em: FakeEntityManager
let orgId: string
let orgAId: string
let orgBId: string
let lastOutcome: PostJournalEntryResult | null
let lastRejection: unknown
let orgAOutcome: PostJournalEntryResult | null
let orgBOutcome: PostJournalEntryResult | null

Given('an organization has posted one balanced journal entry, numbered 1', async function () {
  em = new FakeEntityManager()
  orgId = newId()
  seedBaseline(em, orgId)
  const first = await executeCommand<PostJournalEntryResult>('ledger.postJournalEntry', balancedInput(orgId), buildCommandContext(em))
  assert.strictEqual(first.sequenceNumber, 1, 'fixture setup: the first entry in a fresh organization must be numbered 1')
})

When('I post another balanced journal entry for that organization', async function () {
  lastOutcome = await executeCommand<PostJournalEntryResult>('ledger.postJournalEntry', balancedInput(orgId), buildCommandContext(em))
})

Then('the new entry is recorded with sequence number {int}', function (expected: number) {
  assert.ok(lastOutcome, 'expected a result from postJournalEntry')
  assert.strictEqual(lastOutcome!.sequenceNumber, expected)
})

When('I attempt to post an unbalanced entry for that organization, and then post a balanced one', async function () {
  lastRejection = await captureRejection(async () => {
    await executeCommand('ledger.postJournalEntry', unbalancedInput(orgId), buildCommandContext(em))
  })
  lastOutcome = await executeCommand<PostJournalEntryResult>('ledger.postJournalEntry', balancedInput(orgId), buildCommandContext(em))
})

Then('the balanced entry is recorded with sequence number {int}, not {int}', function (expected: number, notExpected: number) {
  assert.ok(lastRejection, 'expected the unbalanced attempt to be rejected before the balanced one was posted')
  assert.ok(lastOutcome, 'expected a result from the balanced post')
  assert.strictEqual(lastOutcome!.sequenceNumber, expected)
  assert.notStrictEqual(lastOutcome!.sequenceNumber, notExpected)
})

Given('organization A and organization B belong to the same tenant, and neither has posted any entries yet', function () {
  em = new FakeEntityManager()
  orgAId = newId()
  orgBId = newId()
  seedBaseline(em, orgAId)
  seedBaseline(em, orgBId)
})

When('I post a balanced journal entry for organization A', async function () {
  orgAOutcome = await executeCommand<PostJournalEntryResult>('ledger.postJournalEntry', balancedInput(orgAId), buildCommandContext(em))
})

When('I post a balanced journal entry for organization B', async function () {
  orgBOutcome = await executeCommand<PostJournalEntryResult>('ledger.postJournalEntry', balancedInput(orgBId), buildCommandContext(em))
})

Then('organization A\'s entry is recorded with sequence number {int}', function (expected: number) {
  assert.ok(orgAOutcome, 'expected a result from posting for organization A')
  assert.strictEqual(orgAOutcome!.sequenceNumber, expected)
})

Then('organization B\'s entry is recorded with sequence number {int}, independently of organization A\'s', function (expected: number) {
  assert.ok(orgBOutcome, 'expected a result from posting for organization B')
  assert.strictEqual(orgBOutcome!.sequenceNumber, expected)
})
