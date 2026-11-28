// Step definitions for `../features/account_numbering.feature`.
//
// Exercises the real `ledger.createLedgerAccountType` /
// `ledger.createLedgerAccount` commands, so the PL numbering rule is checked
// where it is enforced (the commands), not in a form. See
// `../../lib/accountNumbering.ts` for the rule itself.
import { Given, When, Then } from '@cucumber/cucumber'
import assert from 'node:assert'
import '../../commands/ledgerAccountTypes'
import '../../commands/ledgerAccounts'
import { LedgerAccountGroup, LedgerAccountType } from '../../data/entities'
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
let groupId: string
let accountTypeId: string
let outcome: unknown
let rejection: unknown

function seedPolishGroup(target: FakeEntityManager, code: string): string {
  const id = newId()
  target.seed(LedgerAccountGroup, {
    id,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    jurisdiction: 'PL',
    code,
    name: `Zespół ${code}`,
  })
  return id
}

Given('a Polish account group with code {string}', function (code: string) {
  em = setActiveEm(new FakeEntityManager())
  groupId = seedPolishGroup(em, code)
})

Given('a Polish account type numbered {string}', function (number: string) {
  em = setActiveEm(new FakeEntityManager())
  groupId = seedPolishGroup(em, number.charAt(0))
  accountTypeId = newId()
  em.seed(LedgerAccountType, {
    id: accountTypeId,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    number,
    name: 'Koszty',
    normalBalance: 'DEBIT',
    accountGroupId: groupId,
    deletedAt: null,
  })
})

When('I create an account type numbered {string} in that group', async function (number: string) {
  outcome = null
  rejection = await captureRejection(async () => {
    outcome = await executeCommand(
      'ledger.createLedgerAccountType',
      { organizationId: ORG_ID, tenantId: TENANT_ID, number, name: 'Koszty', normalBalance: 'DEBIT', accountGroupId: groupId },
      buildCommandContext(em),
    )
  })
})

When('I create an account numbered {string} under that type', async function (number: string) {
  outcome = null
  rejection = await captureRejection(async () => {
    outcome = await executeCommand(
      'ledger.createLedgerAccount',
      { organizationId: ORG_ID, tenantId: TENANT_ID, number, accountTypeId },
      buildCommandContext(em),
    )
  })
})

function assertRejected(pattern: RegExp): void {
  assert.ok(rejection, 'expected the command to reject, but it succeeded')
  const err = rejection as { status?: number; body?: { error?: string } }
  assert.strictEqual(err.status, 400)
  assert.match(String(err.body?.error), pattern)
}

Then('the type is rejected because its number does not start with the group digit', function () {
  assertRejected(/first digit of the type number/i)
})

Then('the type is rejected because its number is not three digits', function () {
  assertRejected(/exactly three digits/i)
})

Then('the account is rejected because its number does not start with the type number', function () {
  assertRejected(/must start with its type number/i)
})

Then('the type is created', function () {
  assert.strictEqual(rejection, null, `expected the type to be created, but it rejected with ${String(rejection)}`)
  assert.ok(outcome, 'expected a result from createLedgerAccountType')
})

Then('the account is created', function () {
  assert.strictEqual(rejection, null, `expected the account to be created, but it rejected with ${String(rejection)}`)
  assert.ok(outcome, 'expected a result from createLedgerAccount')
})
