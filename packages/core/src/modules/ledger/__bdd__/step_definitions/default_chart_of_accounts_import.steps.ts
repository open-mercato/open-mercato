// Step definitions for `../features/default_chart_of_accounts_import.feature`.
//
// Exercises the real `ledger.importDefaultChartOfAccounts` command (not a
// reimplementation of its logic) against the fake persistence layer in
// `../support/world.ts`, the same wiring every other feature file in this
// suite uses. `LedgerAccountGroup` rows for all nine zespoły are seeded
// directly (mirroring `lib/seeds.ts`'s own `seedPolishAccountGroups`
// shape, and the equivalent `seedAccountGroups` helper in the Jest suite's
// `commands/__tests__/importDefaultChartOfAccounts.test.ts`) because the
// command's own precondition/validation reads them, but this suite has no
// seeding command of its own to call.
//
// Permission enforcement is not exercised here, for the same reason the
// Jest unit suite omits it (see that test file's own header comment):
// every command in this module enforces permissions exclusively at the
// HTTP route layer (`api/accounts/import-default-chart-of-accounts/route.ts`'s
// `metadata.POST.requireFeatures`), never inside `execute()` itself —
// there is nothing for a command-level scenario to observe.
import { Given, When, Then } from '@cucumber/cucumber'
import assert from 'node:assert'
import { commandRegistry } from '@open-mercato/shared/lib/commands'
import '../../commands/importDefaultChartOfAccounts'
import '../../commands/ledgerAccountTypes'
import '../../commands/ledgerAccounts'
import {
  LedgerAccount,
  LedgerAccountGroup,
  LedgerAccountType,
} from '../../data/entities'
import {
  buildCommandContext,
  captureRejection,
  executeCommand,
  FakeEntityManager,
  newId,
  setActiveEm,
  ORG_ID,
  TENANT_ID,
} from '../support/world'

const ACCOUNT_GROUP_CODES_PL = ['0', '1', '2', '3', '4', '5', '6', '7', '8']
// A second organization, distinct from `world.ts`'s shared `ORG_ID`, for
// the tenant/organization-scoping scenario only.
const OTHER_ORG_ID = '99999999-9999-4999-8999-999999999999'
const COMMAND_ID = 'ledger.importDefaultChartOfAccounts'

type ImportResult = { createdAccountTypeIds: string[]; createdAccountIds: string[] }

let em: FakeEntityManager
let rejection: unknown
let importResult: ImportResult | null

function seedAccountGroups(target: FakeEntityManager, organizationId: string): void {
  for (const code of ACCOUNT_GROUP_CODES_PL) {
    target.seed(LedgerAccountGroup, {
      id: newId(),
      organizationId,
      tenantId: TENANT_ID,
      jurisdiction: 'PL',
      code,
      name: `Zespół ${code}`,
    })
  }
}

function seedExistingAccountType(target: FakeEntityManager, organizationId: string, slug: string): string {
  const id = newId()
  target.seed(LedgerAccountType, {
    id,
    organizationId,
    tenantId: TENANT_ID,
    slug,
    name: 'Existing type',
    normalBalance: 'DEBIT',
    parentAccountTypeId: null,
    accountGroupId: null,
    deletedAt: null,
  })
  return id
}

async function runImport(organizationId: string): Promise<void> {
  rejection = null
  importResult = null
  const ctx = buildCommandContext(em)
  const err = await captureRejection(async () => {
    importResult = await executeCommand<ImportResult>(COMMAND_ID, { organizationId, tenantId: TENANT_ID }, ctx)
  })
  rejection = err
}

Given('an organization with no account types or accounts yet', function () {
  em = setActiveEm(new FakeEntityManager())
  seedAccountGroups(em, ORG_ID)
})

Given('an organization whose chart of accounts already has at least one account type or account', function () {
  em = setActiveEm(new FakeEntityManager())
  seedAccountGroups(em, ORG_ID)
  seedExistingAccountType(em, ORG_ID, 'existing-type')
})

Given('an organization whose only account types and accounts have since been removed', function () {
  em = setActiveEm(new FakeEntityManager())
  seedAccountGroups(em, ORG_ID)
  const removedTypeId = newId()
  em.seed(LedgerAccountType, {
    id: removedTypeId,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    slug: 'removed-type',
    name: 'Removed type',
    normalBalance: 'DEBIT',
    parentAccountTypeId: null,
    accountGroupId: null,
    deletedAt: new Date('2026-01-01'),
  })
  em.seed(LedgerAccount, {
    id: newId(),
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    slug: 'removed-account',
    accountTypeId: removedTypeId,
    parentAccountId: null,
    deletedAt: new Date('2026-01-01'),
  })
})

Given('an organization that just imported the default chart of accounts', async function () {
  em = setActiveEm(new FakeEntityManager())
  seedAccountGroups(em, ORG_ID)
  await runImport(ORG_ID)
  assert.strictEqual(rejection, null, `fixture setup: expected the import to succeed, but it rejected with ${String(rejection)}`)
})

Given('two organizations, one with an existing chart of accounts and one with none', function () {
  em = setActiveEm(new FakeEntityManager())
  seedAccountGroups(em, ORG_ID)
  seedAccountGroups(em, OTHER_ORG_ID)
  seedExistingAccountType(em, OTHER_ORG_ID, 'other-org-existing-type')
})

When('I import the default chart of accounts', async function () {
  await runImport(ORG_ID)
})

When('I try to import the default chart of accounts', async function () {
  await runImport(ORG_ID)
})

When('I import the default chart of accounts into the organization that has none', async function () {
  await runImport(ORG_ID)
})

When('I undo that import', async function () {
  const command = commandRegistry.get(COMMAND_ID)!
  const ctx = buildCommandContext(em)
  const logMeta = await command.buildLog({
    input: { organizationId: ORG_ID, tenantId: TENANT_ID },
    result: importResult,
    ctx,
  })
  assert.ok(logMeta, 'expected buildLog to return undo metadata')
  await command.undo({
    logEntry: {
      commandPayload: logMeta!.payload,
      organizationId: logMeta!.organizationId,
      tenantId: logMeta!.tenantId,
    },
    ctx,
  })
})

Then(
  'the chart of accounts is populated with a full, correctly classified starting set of account types and accounts',
  async function () {
    assert.strictEqual(rejection, null, `expected the import to succeed, but it rejected with ${String(rejection)}`)
    assert.ok(importResult, 'expected a result from the import')
    const typeCount = await em.count(LedgerAccountType, { organizationId: ORG_ID, deletedAt: null })
    const accountCount = await em.count(LedgerAccount, { organizationId: ORG_ID, deletedAt: null })
    assert.strictEqual(typeCount, importResult!.createdAccountTypeIds.length)
    assert.strictEqual(accountCount, importResult!.createdAccountIds.length)
    assert.ok(typeCount > 0 && accountCount > 0, 'expected at least one account type and one account to be created')
  },
)

Then('every imported account and account type can be edited afterward exactly like one created by hand', async function () {
  const ctx = buildCommandContext(em)
  const [typeId] = importResult!.createdAccountTypeIds
  const [accountId] = importResult!.createdAccountIds
  const typeUpdateError = await captureRejection(() =>
    executeCommand('ledger.updateLedgerAccountType', { id: typeId, name: 'Renamed after import' }, ctx),
  )
  assert.strictEqual(typeUpdateError, null, `expected renaming an imported account type to succeed, but it rejected with ${String(typeUpdateError)}`)
  const accountUpdateError = await captureRejection(() =>
    executeCommand('ledger.updateLedgerAccount', { id: accountId, description: 'Updated after import' }, ctx),
  )
  assert.strictEqual(accountUpdateError, null, `expected editing an imported account to succeed, but it rejected with ${String(accountUpdateError)}`)
})

Then('the import is rejected because the chart of accounts is not empty, and nothing is created', async function () {
  assert.ok(rejection, 'expected the import to reject, but it succeeded')
  const err = rejection as { status?: number }
  assert.strictEqual(err.status, 409)
  // Only the one pre-existing row from the Given step — nothing else was written.
  const typeCount = await em.count(LedgerAccountType, { organizationId: ORG_ID })
  const accountCount = await em.count(LedgerAccount, { organizationId: ORG_ID })
  assert.strictEqual(typeCount, 1)
  assert.strictEqual(accountCount, 0)
})

Then('the import succeeds and the full starting chart of accounts is created', async function () {
  assert.strictEqual(rejection, null, `expected the import to succeed, but it rejected with ${String(rejection)}`)
  assert.ok(importResult, 'expected a result from the import')
  const typeCount = await em.count(LedgerAccountType, { organizationId: ORG_ID, deletedAt: null })
  const accountCount = await em.count(LedgerAccount, { organizationId: ORG_ID, deletedAt: null })
  assert.strictEqual(typeCount, importResult!.createdAccountTypeIds.length)
  assert.strictEqual(accountCount, importResult!.createdAccountIds.length)
})

Then('the chart of accounts is empty again', async function () {
  const typeCount = await em.count(LedgerAccountType, { organizationId: ORG_ID, deletedAt: null })
  const accountCount = await em.count(LedgerAccount, { organizationId: ORG_ID, deletedAt: null })
  assert.strictEqual(typeCount, 0)
  assert.strictEqual(accountCount, 0)
})

Then(
  "only that organization's chart of accounts changes, and the other organization's chart of accounts is untouched",
  async function () {
    assert.strictEqual(rejection, null, `expected the import to succeed, but it rejected with ${String(rejection)}`)
    const orgTypeCount = await em.count(LedgerAccountType, { organizationId: ORG_ID, deletedAt: null })
    assert.strictEqual(orgTypeCount, importResult!.createdAccountTypeIds.length)
    // The other organization's pre-existing row is still exactly the one it started with.
    const otherOrgTypeCount = await em.count(LedgerAccountType, { organizationId: OTHER_ORG_ID, deletedAt: null })
    assert.strictEqual(otherOrgTypeCount, 1)
  },
)
