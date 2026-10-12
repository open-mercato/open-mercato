// Step definitions for `../features/fiscal_period_definition.feature`.
//
// Exercises the real `ledger.createFiscalPeriod` command: a period is any
// inclusive date range, and it may not overlap another period of the same
// organization.
import { Given, When, Then } from '@cucumber/cucumber'
import assert from 'node:assert'
import '../../commands/fiscalPeriods'
import { FiscalPeriod } from '../../data/entities'
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

let em: FakeEntityManager
let outcome: unknown
let rejection: unknown

Given('an existing fiscal period from {string} to {string}', function (start: string, end: string) {
  em = setActiveEm(new FakeEntityManager())
  em.seed(FiscalPeriod, {
    id: newId(),
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    startDate: new Date(start),
    endDate: new Date(end),
    isLocked: false,
    deletedAt: null,
    updatedAt: new Date('2026-02-01T00:00:00Z'),
  })
})

When('I create a fiscal period from {string} to {string}', async function (start: string, end: string) {
  outcome = null
  rejection = await captureRejection(async () => {
    outcome = await executeCommand(
      'ledger.createFiscalPeriod',
      { organizationId: ORG_ID, tenantId: TENANT_ID, startDate: start, endDate: end },
      buildCommandContext(em),
    )
  })
})

Then('the period is rejected because it overlaps an existing one', function () {
  assert.ok(rejection, 'expected createFiscalPeriod to reject, but it succeeded')
  const err = rejection as { status?: number; body?: { error?: string } }
  assert.strictEqual(err.status, 409)
  assert.match(String(err.body?.error), /overlaps an existing fiscal period/i)
})

Then('the period is created', function () {
  assert.strictEqual(rejection, null, `expected the period to be created, but it rejected with ${String(rejection)}`)
  assert.ok(outcome, 'expected a result from createFiscalPeriod')
})
