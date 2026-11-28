// Step definitions for `../features/line_dimension_tagging.feature`.
//
// Every write goes through the REAL `CommandBus` and the REAL
// `journal_entry_line_dimensions.dimensions.set` handler (imported below,
// which registers it), so `prepareSnapshotInsideTransaction`, `prepare`,
// `buildLog` and `undo` run exactly as in production. Redo replays the
// logged input through the bus, which is what the bus does for a handler
// without its own `redo`.
import { Given, When, Then } from '@cucumber/cucumber'
import assert from 'node:assert'
import { randomUUID } from 'crypto'
import '../../commands/setJournalEntryLineDimension'
import { CommandBus, commandRegistry } from '@open-mercato/shared/lib/commands'
import type { CommandUndoLogEntry } from '@open-mercato/shared/lib/commands'
import {
  buildAuthenticatedContext,
  captureRejection,
  currentWorld,
  ORGANIZATIONS,
  startWorld,
  TENANT_ID,
} from '../support/world'

const COMMAND_ID = 'journal_entry_line_dimensions.dimensions.set'

function statusOf(err: unknown): number | null {
  if (err && typeof err === 'object' && 'status' in err && typeof (err as { status: unknown }).status === 'number') {
    return (err as { status: number }).status
  }
  return null
}

async function tagLine(writer: string, costCenter: string, organizationKey: string): Promise<void> {
  const target = currentWorld()
  const input = { journalEntryLineId: target.lineId, dimensionType: 'CostCenter', writer, dimensionIds: [costCenter] }
  target.lastInput = input
  target.lastOrganizationKey = organizationKey
  const ctx = buildAuthenticatedContext(target, organizationKey)
  target.rejection = await captureRejection(() => new CommandBus().execute(COMMAND_ID, { input, ctx }))
}

Given('a posted journal entry line in organization {string} whose fiscal period is open', function (organizationKey: string) {
  const target = startWorld()
  const organizationId = ORGANIZATIONS[organizationKey]
  const entryId = randomUUID()
  target.em.entries.push({ id: entryId, operationDate: new Date('2026-03-15'), tenantId: TENANT_ID, organizationId })
  target.em.lines.push({ id: target.lineId, journalEntryId: entryId, tenantId: TENANT_ID, organizationId })
  target.em.periods.push({
    id: randomUUID(),
    startDate: new Date('2026-03-01'),
    endDate: new Date('2026-03-31'),
    isLocked: false,
    deletedAt: null,
    tenantId: TENANT_ID,
    organizationId,
  })
})

Given('the line is tagged with cost centre {string} by {string}', async function (costCenter: string, writer: string) {
  await tagLine(writer, costCenter, 'A')
  assert.strictEqual(currentWorld().rejection, null, 'the initial tag should be accepted')
})

When(
  '{string} tags the line with cost centre {string} in organization {string}',
  async function (writer: string, costCenter: string, organizationKey: string) {
    await tagLine(writer, costCenter, organizationKey)
  },
)

When('the tag change is undone', async function () {
  const target = currentWorld()
  assert.strictEqual(target.rejection, null, 'the tag change to undo should have been accepted')
  const logEntry = target.logs.at(-1)
  assert.ok(logEntry, 'the command bus should have written an action log entry')
  const handler = commandRegistry.get(COMMAND_ID)
  assert.ok(handler?.undo, 'the command should be undoable')
  const ctx = buildAuthenticatedContext(target, target.lastOrganizationKey ?? 'A')
  await handler.undo({ input: target.lastInput, ctx, logEntry: logEntry as unknown as CommandUndoLogEntry })
})

When('the tag change is redone', async function () {
  const target = currentWorld()
  const ctx = buildAuthenticatedContext(target, target.lastOrganizationKey ?? 'A')
  target.rejection = await captureRejection(() => new CommandBus().execute(COMMAND_ID, { input: target.lastInput, ctx }))
  assert.strictEqual(target.rejection, null, 'redo should be accepted')
})

Then('the tag is accepted', function () {
  assert.strictEqual(currentWorld().rejection, null)
})

Then('the tag is rejected with status {int}', function (status: number) {
  assert.strictEqual(statusOf(currentWorld().rejection), status)
})

Then('the line carries only cost centre {string} owned by {string}', function (costCenter: string, writer: string) {
  const rows = currentWorld().em.dimensions.map((row) => [row.dimensionType, row.dimensionId, row.writer])
  assert.deepStrictEqual(rows, [['CostCenter', costCenter, writer]])
})

Then('the line carries no cost centre tag', function () {
  assert.deepStrictEqual(currentWorld().em.dimensions, [])
})
