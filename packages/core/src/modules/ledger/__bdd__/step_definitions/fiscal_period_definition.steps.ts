// Step definitions for `../features/fiscal_period_definition.feature`.
//
// Exercises the real `ledger.createFiscalPeriod` and
// `ledger.generateFiscalPeriods` commands: a period is any inclusive date
// range, it may not overlap another period of the same organization, and
// "generate 12 months" creates twelve consecutive calendar months at once.
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

Given('no fiscal periods exist', function () {
  em = setActiveEm(new FakeEntityManager())
})

When('I generate 12 months starting {string}', async function (start: string) {
  outcome = null
  rejection = await captureRejection(async () => {
    outcome = await executeCommand(
      'ledger.generateFiscalPeriods',
      { organizationId: ORG_ID, tenantId: TENANT_ID, startDate: start },
      buildCommandContext(em),
    )
  })
})

const day = (value: unknown) => new Date(value as Date).toISOString().slice(0, 10)

Then('twelve consecutive monthly periods exist from {string} to {string}', async function (first: string, last: string) {
  assert.strictEqual(rejection, null, `expected the periods to be created, but it rejected with ${String(rejection)}`)
  const rows = (await em.find(FiscalPeriod, { organizationId: ORG_ID, tenantId: TENANT_ID })) as Array<{
    startDate: Date
    endDate: Date
  }>
  assert.strictEqual(rows.length, 12)
  const sorted = [...rows].sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
  assert.strictEqual(day(sorted[0].startDate), first)
  assert.strictEqual(day(sorted[11].endDate), last)
  for (let i = 1; i < sorted.length; i += 1) {
    const dayAfterPrevious = new Date(new Date(sorted[i - 1].endDate).getTime() + 24 * 3600 * 1000)
    assert.strictEqual(day(dayAfterPrevious), day(sorted[i].startDate), `gap or overlap before period ${i + 1}`)
  }
})

Then('only the existing period remains', async function () {
  const rows = await em.find(FiscalPeriod, { organizationId: ORG_ID, tenantId: TENANT_ID })
  assert.strictEqual(rows.length, 1, 'a rejected generate must create nothing')
})

Then('the request is rejected because the start is not the first day of a month', function () {
  assert.ok(rejection, 'expected generateFiscalPeriods to reject, but it succeeded')
})
