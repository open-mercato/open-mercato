// Step definitions for `../features/account_type_immutability.feature`.
//
// Exercises the real `ledger.updateLedgerAccountType` / `ledger.updateLedgerAccount`
// commands (not a reimplementation of their logic) against the fake
// persistence layer in `../support/world.ts`. Importing the command
// modules triggers their own top-level `registerCommand(...)` calls
// exactly once, the same way requiring them from a real route handler
// would.
//
import { Given, When, Then } from '@cucumber/cucumber'
import assert from 'node:assert'
import '../../commands/ledgerAccountTypes'
import '../../commands/ledgerAccounts'
import { LedgerAccount, LedgerAccountGroup, LedgerAccountType, JournalEntryLine } from '../../data/entities'
import {
  activeEmOrNew,
  buildCommandContext,
  executeCommand,
  FakeEntityManager,
  newId,
  ORG_ID,
  TENANT_ID,
  captureRejection,
  setActiveEm,
  activeLedgerAccountIdOrThrow,
  setActiveLedgerAccountId,
} from '../support/world'

let em: FakeEntityManager
let accountTypeId: string
let outcome: unknown
let rejection: unknown

function seedAccountType(target: FakeEntityManager, normalBalance: string): string {
  const id = newId()
  target.seed(LedgerAccountType, {
    id,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    number: `type-under-test-${id.slice(0, 8)}`,
    name: 'Type under test',
    normalBalance,
    accountGroupId: null,
    deletedAt: null,
  })
  return id
}

function seedAccountOfType(target: FakeEntityManager, typeId: string): string {
  const id = newId()
  target.seed(LedgerAccount, {
    id,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    number: `account-under-test-${id.slice(0, 8)}`,
    accountTypeId: typeId,
    deletedAt: null,
  })
  return id
}

function seedPostedLineFor(target: FakeEntityManager, accountId: string): void {
  target.seed(JournalEntryLine, {
    id: newId(),
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    journalEntryId: newId(),
    accountId,
    debit: '100.0000',
    credit: '0.0000',
    amountCurrency: '100.0000',
  })
}

Given('a ledger account of a type with normal balance {string} has a posted entry', function (normalBalance: string) {
  em = setActiveEm(new FakeEntityManager())
  accountTypeId = seedAccountType(em, normalBalance)
  const accountId = seedAccountOfType(em, accountTypeId)
  seedPostedLineFor(em, accountId)
})

Given('a ledger account of a type with normal balance {string} has no posted entries', function (normalBalance: string) {
  em = setActiveEm(new FakeEntityManager())
  accountTypeId = seedAccountType(em, normalBalance)
  seedAccountOfType(em, accountTypeId)
})

When('I try to change that account type\'s normal balance to {string}', async function (newNormalBalance: string) {
  outcome = null
  rejection = null
  const ctx = buildCommandContext(em)
  const err = await captureRejection(async () => {
    outcome = await executeCommand('ledger.updateLedgerAccountType', { id: accountTypeId, normalBalance: newNormalBalance }, ctx)
  })
  rejection = err
})

Then('the change is rejected because the type has posted entries', function () {
  assert.ok(rejection, 'expected updateLedgerAccountType to reject, but it succeeded')
  const err = rejection as { status?: number; body?: { error?: string } }
  assert.strictEqual(err.status, 409)
  assert.match(String(err.body?.error), /posted entries/i)
})

Then('the change succeeds', function () {
  assert.strictEqual(rejection, null, `expected the change to succeed, but it rejected with ${String(rejection)}`)
  assert.ok(outcome, 'expected a result from the command')
})

// New scenario (LedgerAccount.accountTypeId immutability — a distinct
// guard in `commands/ledgerAccounts.ts` from the normalBalance/
// accountGroupId one above, but the same "posted entries block a
// classification change" invariant). "Given a ledger account has a
// posted entry" is deliberately NOT redefined here — it already exists,
// globally, in `delete_blocking.steps.ts`; Cucumber matches step text
// across every step-definition file, and redefining it here would be an
// ambiguous-step error.
When('I try to change that account to a different account type', async function () {
  outcome = null
  rejection = null
  const target = activeEmOrNew()
  const otherAccountTypeId = seedAccountType(target, 'CREDIT')
  const ctx = buildCommandContext(target)
  const accountId = activeLedgerAccountIdOrThrow()
  const err = await captureRejection(async () => {
    outcome = await executeCommand('ledger.updateLedgerAccount', { id: accountId, accountTypeId: otherAccountTypeId }, ctx)
  })
  rejection = err
})

Then('the change is rejected because the account has posted entries', function () {
  assert.ok(rejection, 'expected updateLedgerAccount to reject, but it succeeded')
  const err = rejection as { status?: number; body?: { error?: string } }
  assert.strictEqual(err.status, 409)
  assert.match(String(err.body?.error), /posted entries/i)
})

// Number freeze (PR #6340 review, item 4): a type or account number cannot
// change once postings exist, while the type's name stays editable. The
// fixtures use a PL group so the numbers are valid under the numbering rule
// and the freeze, not the rule, is what rejects the change.
function seedPolishType(target: FakeEntityManager, number: string): string {
  const groupId = newId()
  target.seed(LedgerAccountGroup, {
    id: groupId,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    jurisdiction: 'PL',
    code: number.charAt(0),
    name: `Zespół ${number.charAt(0)}`,
  })
  const id = newId()
  target.seed(LedgerAccountType, {
    id,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    number,
    name: 'Koszty',
    normalBalance: 'DEBIT',
    accountGroupId: groupId,
    deletedAt: null,
  })
  return id
}

Given('a Polish account type numbered {string} has an account with a posted entry', function (number: string) {
  em = setActiveEm(new FakeEntityManager())
  accountTypeId = seedPolishType(em, number)
  const accountId = newId()
  em.seed(LedgerAccount, {
    id: accountId,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    number: `${number}-1`,
    accountTypeId,
    deletedAt: null,
  })
  seedPostedLineFor(em, accountId)
})

Given('an account numbered {string} of a Polish account type has a posted entry', function (number: string) {
  em = setActiveEm(new FakeEntityManager())
  const typeNumber = number.split('-')[0]
  accountTypeId = seedPolishType(em, typeNumber)
  const accountId = newId()
  em.seed(LedgerAccount, {
    id: accountId,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    number,
    accountTypeId,
    deletedAt: null,
  })
  seedPostedLineFor(em, accountId)
  setActiveLedgerAccountId(accountId)
})

When('I try to change that type\'s number to {string}', async function (number: string) {
  outcome = null
  rejection = await captureRejection(async () => {
    outcome = await executeCommand('ledger.updateLedgerAccountType', { id: accountTypeId, number }, buildCommandContext(em))
  })
})

When('I rename that type to {string}', async function (name: string) {
  outcome = null
  rejection = await captureRejection(async () => {
    outcome = await executeCommand('ledger.updateLedgerAccountType', { id: accountTypeId, name }, buildCommandContext(em))
  })
})

When('I try to change that account\'s number to {string}', async function (number: string) {
  outcome = null
  rejection = await captureRejection(async () => {
    outcome = await executeCommand(
      'ledger.updateLedgerAccount',
      { id: activeLedgerAccountIdOrThrow(), number },
      buildCommandContext(em),
    )
  })
})
