// Step definitions for `../features/journal_entry_operation_date.feature`.
//
// `operationDate` is a required `z.coerce.date()` field (no `.optional()`)
// in `postJournalEntrySchema` — omitting it is rejected by
// `postJournalEntrySchema.parse()` (zod) before the command ever calls
// `ctx.container.resolve('em')`, so — like the balance-invariant
// scenarios in `journal_entry_balance.steps.ts` — no fixture seeding is
// needed here at all.
import { When, Then } from '@cucumber/cucumber'
import assert from 'node:assert'
import '../../commands/postJournalEntry'
import { commandRegistry } from '@open-mercato/shared/lib/commands'
import { buildCommandContext, FakeEntityManager, newId, ORG_ID, TENANT_ID } from '../support/world'

let capturedError: unknown

When('I attempt to post an entry with no operation date specified', async function () {
  const input = {
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    // operationDate deliberately omitted — this is the entire point of
    // the scenario.
    description: 'BDD scenario: missing operation date',
    currencyId: newId(),
    lines: [
      { accountId: newId(), debit: '100.00' },
      { accountId: newId(), credit: '100.00' },
    ],
  }

  const command = commandRegistry.get('ledger.postJournalEntry')
  assert.ok(command, 'ledger.postJournalEntry must be registered before this step runs')

  capturedError = null
  try {
    await command!.execute(input, buildCommandContext(new FakeEntityManager()))
  } catch (err) {
    capturedError = err
  }
})

Then('the attempt is rejected before any posting is attempted, citing the missing operation date', function () {
  assert.ok(capturedError, 'expected postJournalEntry to reject an entry with no operation date, but it succeeded')
  const issues = (capturedError as { issues?: { path?: unknown[] }[] } | null)?.issues
  assert.ok(Array.isArray(issues), `expected a zod validation error, got: ${String(capturedError)}`)
  assert.ok(
    issues!.some((issue) => Array.isArray(issue.path) && issue.path.includes('operationDate')),
    `expected a validation issue on "operationDate", got paths: ${JSON.stringify(issues!.map((i) => i.path))}`,
  )
})
