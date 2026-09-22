// Step definitions for `../features/journal_entry_balance.feature`.
//
// Both scenarios here are rejected by `postJournalEntrySchema.parse()`
// (zod) at the very top of `postJournalEntryCommand.execute()`, before the
// command ever calls `ctx.container.resolve('em')` or touches a fiscal
// period — so, unlike the other step-definition files in this suite, no
// `FakeEntityManager` is needed here at all: this is a pure schema-level
// invariant check against the real, imported schema.
import { Given, When, Then, type DataTable } from '@cucumber/cucumber'
import assert from 'node:assert'
import '../../commands/postJournalEntry'
import { commandRegistry } from '@open-mercato/shared/lib/commands'
import { buildCommandContext, FakeEntityManager, newId, ORG_ID, TENANT_ID } from '../support/world'

const ACCOUNT_IDS: Record<string, string> = {
  cash: newId(),
  revenue: newId(),
}

let capturedError: unknown

When('I attempt to post an entry with lines:', async function (table: DataTable) {
  const lines = table.hashes().map((row) => {
    const line: Record<string, unknown> = { accountId: ACCOUNT_IDS[row.account] ?? newId() }
    if (row.side === 'debit') line.debit = row.amount
    else if (row.side === 'credit') line.credit = row.amount
    // side === 'none': neither field set, matching the "one-sided" scenario.
    return line
  })

  const input = {
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    operationDate: '2026-04-01',
    description: 'BDD scenario: journal entry balance invariant',
    currencyId: newId(),
    lines,
  }

  const command = commandRegistry.get('ledger.postJournalEntry')
  assert.ok(command, 'ledger.postJournalEntry must be registered before this step runs')

  capturedError = null
  try {
    // A `FakeEntityManager` is supplied even though this path never reaches
    // it, purely so `execute()`'s signature is satisfied the same way
    // every other step definition in this suite calls it.
    await command!.execute(input, buildCommandContext(new FakeEntityManager()))
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
