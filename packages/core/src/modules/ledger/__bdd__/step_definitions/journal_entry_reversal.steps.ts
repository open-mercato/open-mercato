// Step definitions for `../features/journal_entry_reversal.feature`.
//
// Exercises the REAL `ledger.reverseJournalEntry` command, which itself
// calls the real `runPostJournalEntry` shared core (see
// `commands/postJournalEntry.ts`) to post the reversal — so this scenario
// transitively exercises the fiscal-period-lock check a second time, now
// asserting it is checked against the REVERSAL's own operation date, not
// the original entry's (per the spec's "Design decisions" section this
// feature file quotes).
//
// Seeds a `Currency` and both `LedgerAccount`s used by the original entry:
// `requireValidPostingReferences` (PR #6340 review M5) checks both exist
// before any post/reversal reaches persistence, so without these every
// scenario here — including the original, already-approved one — would
// fail on "currency not found"/"account not found" rather than exercising
// the reversal logic at all. Found while wiring the two new
// double-reversal scenarios below; fixed here rather than left broken.
import { Given, When, Then } from '@cucumber/cucumber'
import assert from 'node:assert'
import '../../commands/postJournalEntry'
import '../../commands/reverseJournalEntry'
import { FiscalPeriod, JournalEntry, JournalEntryLine, LedgerAccount } from '../../data/entities'
import { Currency } from '@open-mercato/core/modules/currencies/data/entities'
import type { PostJournalEntryResult } from '../../commands/postJournalEntry'
import { buildCommandContext, executeCommand, FakeEntityManager, newId, ORG_ID, TENANT_ID, captureRejection, setActiveEm } from '../support/world'

const CASH_ACCOUNT_ID = newId()
const REVENUE_ACCOUNT_ID = newId()
const CURRENCY_ID = newId()

let em: FakeEntityManager
let originalEntryId: string
let reversalEntryId: string
let outcome: PostJournalEntryResult | null
let rejection: unknown

Given(
  'a journal entry was posted for {string} from {string} to {string}, now in a locked period',
  function (amount: string, debitAccountLabel: string, creditAccountLabel: string) {
    void debitAccountLabel
    void creditAccountLabel
    em = setActiveEm(new FakeEntityManager())
    originalEntryId = newId()

    em.seed(Currency, { id: CURRENCY_ID, organizationId: ORG_ID, tenantId: TENANT_ID, code: 'PLN', name: 'Polish Zloty', deletedAt: null })
    em.seed(LedgerAccount, { id: CASH_ACCOUNT_ID, organizationId: ORG_ID, tenantId: TENANT_ID, slug: 'cash', accountTypeId: newId(), deletedAt: null })
    em.seed(LedgerAccount, { id: REVENUE_ACCOUNT_ID, organizationId: ORG_ID, tenantId: TENANT_ID, slug: 'revenue', accountTypeId: newId(), deletedAt: null })

    // The original's own period: seeded as *locked* only after the fact —
    // it was open when the original was posted, and has since been closed,
    // which is exactly the situation that makes a reversal (not a plain
    // edit) the only way to correct it.
    em.seed(FiscalPeriod, {
      id: newId(),
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-01-31'),
      isLocked: true,
      deletedAt: null,
    })

    em.seed(JournalEntry, {
      id: originalEntryId,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      sequenceNumber: 1,
      postedAt: new Date('2026-01-15T00:00:00Z'),
      operationDate: new Date('2026-01-15'),
      documentType: null,
      documentNumber: null,
      documentDate: null,
      description: 'Original entry (BDD fixture)',
      type: 'NORMAL',
      currencyId: CURRENCY_ID,
      exchangeRate: null,
      referenceType: null,
      referenceId: null,
    })
    em.seed(JournalEntryLine, {
      id: newId(),
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      journalEntryId: originalEntryId,
      accountId: CASH_ACCOUNT_ID,
      debit: amount,
      credit: '0',
      amountCurrency: amount,
      contractorSnapshot: null,
    })
    em.seed(JournalEntryLine, {
      id: newId(),
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      journalEntryId: originalEntryId,
      accountId: REVENUE_ACCOUNT_ID,
      debit: '0',
      credit: amount,
      amountCurrency: amount,
      contractorSnapshot: null,
    })
    // The original already claimed sequence number 1 — pre-set the fake
    // sequence counter so the reversal's own post allocates 2, the same
    // way it would after a real prior post.
    em.seedSequenceCounter({ organizationId: ORG_ID, tenantId: TENANT_ID }, 2)
  },
)

// "Given a fiscal period from {string} to {string} that is open" is
// deliberately NOT defined here — it already exists, globally, in
// `fiscal_period_locking.steps.ts`. Cucumber matches step text across
// every step-definition file; this file used to redefine it verbatim,
// which is an ambiguous-step error the moment both files load together
// (found while wiring the new double-reversal scenarios below).

Given('that entry has already been reversed, dated {string}', async function (operationDate: string) {
  const ctx = buildCommandContext(em)
  const first = await executeCommand<PostJournalEntryResult>(
    'ledger.reverseJournalEntry',
    { organizationId: ORG_ID, tenantId: TENANT_ID, journalEntryId: originalEntryId, operationDate },
    ctx,
  )
  reversalEntryId = first.journalEntryId
})

When('I reverse that entry with operation date {string}', async function (operationDate: string) {
  outcome = null
  rejection = null
  const ctx = buildCommandContext(em)
  const input = { organizationId: ORG_ID, tenantId: TENANT_ID, journalEntryId: originalEntryId, operationDate }
  rejection = await captureRejection(async () => {
    outcome = await executeCommand<PostJournalEntryResult>('ledger.reverseJournalEntry', input, ctx)
  })
})

When('I try to reverse that reversal entry', async function () {
  outcome = null
  rejection = null
  const ctx = buildCommandContext(em)
  const input = { organizationId: ORG_ID, tenantId: TENANT_ID, journalEntryId: reversalEntryId, operationDate: '2026-05-20' }
  rejection = await captureRejection(async () => {
    outcome = await executeCommand<PostJournalEntryResult>('ledger.reverseJournalEntry', input, ctx)
  })
})

When('I try to reverse the original entry again', async function () {
  outcome = null
  rejection = null
  const ctx = buildCommandContext(em)
  const input = { organizationId: ORG_ID, tenantId: TENANT_ID, journalEntryId: originalEntryId, operationDate: '2026-05-20' }
  rejection = await captureRejection(async () => {
    outcome = await executeCommand<PostJournalEntryResult>('ledger.reverseJournalEntry', input, ctx)
  })
})

Then('the reversal succeeds as a new REVERSAL entry with inverted lines referencing the original', async function () {
  assert.strictEqual(rejection, null, `expected reverseJournalEntry to succeed, but it rejected with ${String(rejection)}`)
  assert.ok(outcome, 'expected a result from reverseJournalEntry')
  assert.strictEqual(outcome!.sequenceNumber, 2, 'the reversal must claim the next sequence number after the original')
  assert.notStrictEqual(outcome!.journalEntryId, originalEntryId)

  const reversalEntry = await em.findOne(JournalEntry, { id: outcome!.journalEntryId })
  assert.ok(reversalEntry, 'the reversal entry must exist in the fake store')
  assert.strictEqual(reversalEntry!.type, 'REVERSAL')
  assert.strictEqual(reversalEntry!.referenceType, 'journal_entry')
  assert.strictEqual(reversalEntry!.referenceId, originalEntryId)

  const reversalLines = await em.find(JournalEntryLine, { journalEntryId: outcome!.journalEntryId })
  assert.strictEqual(reversalLines.length, 2)
  const cashLine = reversalLines.find((line) => line.accountId === CASH_ACCOUNT_ID)
  const revenueLine = reversalLines.find((line) => line.accountId === REVENUE_ACCOUNT_ID)
  assert.ok(cashLine && revenueLine)
  // Inverted relative to the original: cash was debited, now it is credited.
  assert.strictEqual(cashLine!.debit, '0')
  assert.strictEqual(cashLine!.credit, '100.00')
  assert.strictEqual(revenueLine!.debit, '100.00')
  assert.strictEqual(revenueLine!.credit, '0')
})

Then('the attempt is rejected because a reversal cannot itself be reversed', function () {
  assert.ok(rejection, 'expected reverseJournalEntry to reject, but it succeeded')
  const err = rejection as { status?: number; body?: { error?: string } }
  assert.strictEqual(err.status, 409)
  assert.match(String(err.body?.error), /itself a reversal/i)
})

Then('the attempt is rejected because the entry has already been reversed', function () {
  assert.ok(rejection, 'expected reverseJournalEntry to reject, but it succeeded')
  const err = rejection as { status?: number; body?: { error?: string } }
  assert.strictEqual(err.status, 409)
  assert.match(String(err.body?.error), /already been reversed/i)
})
