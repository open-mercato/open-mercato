// Step definitions for `../features/journal_entry_balance.feature`.
//
// The three rejection scenarios here are rejected by
// `postJournalEntrySchema.parse()` (zod) at the very top of
// `postJournalEntryCommand.execute()`, before the command ever calls
// `ctx.container.resolve('em')` or touches a fiscal period — so, unlike
// the other step-definition files in this suite, no seeded fixtures are
// needed for those. The "balanced entry" scenario is different: it passes
// schema validation and reaches the real persistence path
// (`runPostJournalEntry`), which needs a covering `FiscalPeriod` and a
// real `Currency`/`LedgerAccount` for each referenced id
// (`requireValidPostingReferences`, PR #6340 review M5) — seeded below so
// that scenario can actually succeed rather than fail on an unrelated
// "currency not found"/"account not found".
import { Given, When, Then, type DataTable } from '@cucumber/cucumber'
import assert from 'node:assert'
import '../../commands/postJournalEntry'
import { commandRegistry } from '@open-mercato/shared/lib/commands'
import { FiscalPeriod, LedgerAccount } from '../../data/entities'
import { Currency } from '@open-mercato/core/modules/currencies/data/entities'
import { buildCommandContext, FakeEntityManager, newId, ORG_ID, TENANT_ID } from '../support/world'
import type { PostJournalEntryResult } from '../../commands/postJournalEntry'

const ACCOUNT_IDS: Record<string, string> = {
  cash: newId(),
  revenue: newId(),
}
const CURRENCY_ID = newId()

let capturedError: unknown
let capturedResult: PostJournalEntryResult | null

function seededEm(): FakeEntityManager {
  const em = new FakeEntityManager()
  em.seed(FiscalPeriod, {
    id: newId(),
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    startDate: new Date('2026-04-01'),
    endDate: new Date('2026-04-30'),
    isLocked: false,
    deletedAt: null,
  })
  em.seed(Currency, { id: CURRENCY_ID, organizationId: ORG_ID, tenantId: TENANT_ID, code: 'PLN', name: 'Polish Zloty', deletedAt: null })
  em.seed(LedgerAccount, { id: ACCOUNT_IDS.cash, organizationId: ORG_ID, tenantId: TENANT_ID, slug: 'cash', accountTypeId: newId(), deletedAt: null })
  em.seed(LedgerAccount, { id: ACCOUNT_IDS.revenue, organizationId: ORG_ID, tenantId: TENANT_ID, slug: 'revenue', accountTypeId: newId(), deletedAt: null })
  return em
}

When('I attempt to post an entry with lines:', async function (table: DataTable) {
  const lines = table.hashes().map((row) => {
    const line: Record<string, unknown> = { accountId: ACCOUNT_IDS[row.account] ?? newId() }
    if (row.side === 'debit') line.debit = row.amount
    else if (row.side === 'credit') line.credit = row.amount
    else if (row.side === 'both') {
      // Both sides populated with the same amount — the exact-one-side
      // invariant rejects this the same way it rejects "neither" (see
      // postJournalEntrySchema's per-line refine).
      line.debit = row.amount
      line.credit = row.amount
    }
    // side === 'none': neither field set, matching the "one-sided" scenario.
    return line
  })

  const input = {
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    operationDate: '2026-04-15',
    description: 'BDD scenario: journal entry balance invariant',
    currencyId: CURRENCY_ID,
    lines,
  }

  const command = commandRegistry.get('ledger.postJournalEntry')
  assert.ok(command, 'ledger.postJournalEntry must be registered before this step runs')

  capturedError = null
  capturedResult = null
  try {
    // A fully-seeded `FakeEntityManager` is supplied even though the
    // rejected scenarios never reach it, purely so `execute()`'s signature
    // is satisfied the same way every other step definition in this suite
    // calls it — only the "balanced entry" scenario actually depends on
    // what's seeded here.
    capturedResult = (await command!.execute(input, buildCommandContext(seededEm()))) as PostJournalEntryResult
  } catch (err) {
    capturedError = err
  }
})

function zodIssueMessages(err: unknown): string[] {
  const issues = (err as { issues?: { message: string }[] } | null)?.issues
  if (Array.isArray(issues)) return issues.map((issue) => issue.message)
  return [String((err as { message?: unknown } | null)?.message ?? err)]
}

Then('the attempt is rejected before any posting is attempted, citing the balance invariant', function () {
  assert.ok(capturedError, 'expected postJournalEntry to reject an unbalanced entry, but it succeeded')
  const messages = zodIssueMessages(capturedError)
  assert.ok(
    messages.some((message) => /not balanced/i.test(message)),
    `expected a "not balanced" validation issue, got: ${messages.join(' | ')}`,
  )
})

Then('the attempt is rejected before any posting is attempted, citing the one-sided-line invariant', function () {
  assert.ok(capturedError, 'expected postJournalEntry to reject a two-sided/no-sided line, but it succeeded')
  const messages = zodIssueMessages(capturedError)
  assert.ok(
    messages.some((message) => /exactly one side/i.test(message)),
    `expected an "exactly one side" validation issue, got: ${messages.join(' | ')}`,
  )
})

Then('the entry is posted successfully', function () {
  assert.strictEqual(capturedError, null, `expected postJournalEntry to succeed, but it rejected with ${String(capturedError)}`)
  assert.ok(capturedResult, 'expected a result from postJournalEntry')
  assert.ok(capturedResult!.journalEntryId, 'expected a journalEntryId in the result')
  assert.ok(typeof capturedResult!.sequenceNumber === 'number', 'expected a sequenceNumber in the result')
})
