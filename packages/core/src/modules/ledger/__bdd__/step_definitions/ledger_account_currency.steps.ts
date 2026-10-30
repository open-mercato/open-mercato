// Step definitions for `../features/ledger_account_currency.feature`.
//
// Exercises the real `ledger.updateLedgerAccount` command. "Given a ledger
// account has a posted entry" is deliberately NOT redefined here — it exists
// globally in `delete_blocking.steps.ts` (Cucumber matches step text across
// every step-definition file) and registers its fake store and account id
// through `world.ts`.
import { Given, When, Then } from '@cucumber/cucumber'
import assert from 'node:assert'
import '../../commands/ledgerAccounts'
import { LedgerAccount } from '../../data/entities'
import { Currency } from '@open-mercato/core/modules/currencies/data/entities'
import {
  activeEmOrNew,
  activeLedgerAccountIdOrThrow,
  buildCommandContext,
  captureRejection,
  executeCommand,
  FakeEntityManager,
  newId,
  ORG_ID,
  setActiveEm,
  setActiveLedgerAccountId,
  TENANT_ID,
} from '../support/world'

const currencyIds: Record<string, string> = {}
let em: FakeEntityManager
let rejection: unknown

function seedCurrency(target: FakeEntityManager, code: string): void {
  currencyIds[code] = newId()
  target.seed(Currency, {
    id: currencyIds[code],
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    code,
    name: code,
    isBase: false,
    decimalPlaces: 2,
    deletedAt: null,
  })
}

Given('a ledger account with no posted entries and a currency {string} exists', function (code: string) {
  em = setActiveEm(new FakeEntityManager())
  const accountId = newId()
  em.seed(LedgerAccount, {
    id: accountId,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    number: `account-under-test-${accountId.slice(0, 8)}`,
    accountTypeId: newId(),
    currencyId: null,
    deletedAt: null,
  })
  setActiveLedgerAccountId(accountId)
  seedCurrency(em, code)
})

Given('a currency {string} exists', function (code: string) {
  em = activeEmOrNew()
  seedCurrency(em, code)
})

async function setAccountCurrency(currencyId: string): Promise<void> {
  rejection = await captureRejection(async () => {
    await executeCommand(
      'ledger.updateLedgerAccount',
      { id: activeLedgerAccountIdOrThrow(), currencyId },
      buildCommandContext(em),
    )
  })
}

When("I set that account's currency to {string}", async function (code: string) {
  await setAccountCurrency(currencyIds[code])
})

When("I try to set that account's currency to {string}", async function (code: string) {
  await setAccountCurrency(currencyIds[code])
})

When("I try to set that account's currency to an unknown currency", async function () {
  await setAccountCurrency(newId())
})

Then('the account is kept in {string}', async function (code: string) {
  assert.strictEqual(rejection, null, `expected the change to succeed, but it rejected with ${String(rejection)}`)
  const account = await em.findOne(LedgerAccount, { id: activeLedgerAccountIdOrThrow() })
  assert.strictEqual(account!.currencyId, currencyIds[code])
})

Then('the currency change is rejected because the account has posted entries', function () {
  assert.ok(rejection, 'expected updateLedgerAccount to reject, but it succeeded')
  const err = rejection as { status?: number; body?: { error?: string } }
  assert.strictEqual(err.status, 409)
  assert.match(String(err.body?.error), /posted entries/i)
})

Then('the currency change is rejected because the currency does not exist', function () {
  assert.ok(rejection, 'expected updateLedgerAccount to reject, but it succeeded')
  const err = rejection as { status?: number; body?: { error?: string } }
  assert.strictEqual(err.status, 409)
  assert.match(String(err.body?.error), /currency does not exist/i)
})
