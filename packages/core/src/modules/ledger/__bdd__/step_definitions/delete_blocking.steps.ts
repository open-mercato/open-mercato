// Step definitions for `../features/delete_blocking.feature`.
//
// Same wiring as `account_type_immutability.steps.ts`: exercises the real
// `ledger.deleteLedgerAccount` / `ledger.deleteLedgerAccountType` commands
// against the fake persistence layer, now that
// `#generated/entities.ids.generated` exists in this checkout (see
// `../README.md`'s "Verification status" section).
import { Given, When, Then } from '@cucumber/cucumber'
import assert from 'node:assert'
import '../../commands/ledgerAccounts'
import '../../commands/ledgerAccountTypes'
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
let parentAccountTypeId: string
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
    slug: `type-for-delete-blocking-${accountTypeId.slice(0, 8)}`,
    name: 'Type backing a posted account',
    normalBalance: 'DEBIT',
    parentAccountTypeId: null,
    accountGroupId: null,
    deletedAt: null,
  })
  const accountId = newId()
  em.seed(LedgerAccount, {
    id: accountId,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    slug: `account-for-delete-blocking-${accountId.slice(0, 8)}`,
    accountTypeId,
    parentAccountId: null,
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

Given('a ledger account type is the declared parent of another account type', function () {
  em = setActiveEm(new FakeEntityManager())
  parentAccountTypeId = newId()
  em.seed(LedgerAccountType, {
    id: parentAccountTypeId,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    slug: `parent-type-${parentAccountTypeId.slice(0, 8)}`,
    name: 'Parent account type',
    normalBalance: 'DEBIT',
    parentAccountTypeId: null,
    accountGroupId: null,
    deletedAt: null,
  })
  const childId = newId()
  em.seed(LedgerAccountType, {
    id: childId,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    slug: `child-type-${childId.slice(0, 8)}`,
    name: 'Child account type',
    normalBalance: 'DEBIT',
    parentAccountTypeId,
    accountGroupId: null,
    deletedAt: null,
  })
})

When('I try to delete that parent account type', async function () {
  outcome = null
  rejection = null
  const ctx = buildCommandContext(em)
  const err = await captureRejection(async () => {
    outcome = await executeCommand('ledger.deleteLedgerAccountType', { id: parentAccountTypeId }, ctx)
  })
  rejection = err
})

Then('the delete is rejected because another account type still lists it as parent', function () {
  assert.ok(rejection, 'expected deleteLedgerAccountType to reject, but it succeeded')
  const err = rejection as { status?: number; body?: { error?: string } }
  assert.strictEqual(err.status, 409)
  assert.match(String(err.body?.error), /parent/i)
})
