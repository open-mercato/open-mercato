// Step definitions for `../features/delete_blocking.feature`.
//
// Same wiring as `account_type_immutability.steps.ts`: exercises the real
// `ledger.deleteLedgerAccount` command against the fake persistence layer
// (see `../README.md`'s "Verification status" section).
import { Given, When, Then } from '@cucumber/cucumber'
import assert from 'node:assert'
import '../../commands/ledgerAccounts'
import { LedgerAccount, LedgerAccountType, JournalEntryLine } from '../../data/entities'
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
  setActiveLedgerAccountId,
  activeLedgerAccountIdOrThrow,
} from '../support/world'

let em: FakeEntityManager
let outcome: unknown
let rejection: unknown

// Shared across feature files (see `account_type_immutability.feature`'s
// reclassification scenario) — this is the one place it's defined.
Given('a ledger account has a posted entry', function () {
  em = setActiveEm(new FakeEntityManager())
  const accountTypeId = newId()
  em.seed(LedgerAccountType, {
    id: accountTypeId,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    number: `type-for-delete-blocking-${accountTypeId.slice(0, 8)}`,
    name: 'Type backing a posted account',
    normalBalance: 'DEBIT',
    accountGroupId: null,
    deletedAt: null,
  })
  const accountId = newId()
  em.seed(LedgerAccount, {
    id: accountId,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    number: `account-for-delete-blocking-${accountId.slice(0, 8)}`,
    accountTypeId,
    deletedAt: null,
  })
  em.seed(JournalEntryLine, {
    id: newId(),
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    journalEntryId: newId(),
    accountId,
    debit: '100.0000',
    credit: '0.0000',
    currencyId: newId(),
    exchangeRate: '1',
    amountCurrency: '100.0000',
  })
  setActiveLedgerAccountId(accountId)
})

When('I try to delete that account', async function () {
  outcome = null
  rejection = null
  const target = activeEmOrNew()
  const ctx = buildCommandContext(target)
  const accountId = activeLedgerAccountIdOrThrow()
  const err = await captureRejection(async () => {
    outcome = await executeCommand('ledger.deleteLedgerAccount', { id: accountId }, ctx)
  })
  rejection = err
})

Then('the delete is rejected because the account has posted entries', function () {
  assert.ok(rejection, 'expected deleteLedgerAccount to reject, but it succeeded')
  const err = rejection as { status?: number; body?: { error?: string } }
  assert.strictEqual(err.status, 409)
  assert.match(String(err.body?.error), /posted/i)
})
