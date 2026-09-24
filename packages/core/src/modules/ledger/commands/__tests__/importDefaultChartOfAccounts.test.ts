// Unit tests for `ledger.importDefaultChartOfAccounts` (OM-19), per the
// (corrected, 39/43) Testing Strategy in
// `2026-09-15-default-chart-of-accounts.md`.
//
// One bullet in that Testing Strategy is not testable at the command
// level as written: "Permission enforcement: call the command as a
// principal without ledger.accounts.manage, assert it's rejected the
// same way createLedgerAccountType already rejects that principal."
// Checked directly against the sibling commands this spec's own wording
// points to (`grep -n "requireFeature|hasFeature|rbac|permission|
// [Ff]orbidden" commands/ledgerAccountTypes.ts commands/ledgerAccounts.ts`
// — zero matches): neither `createLedgerAccountType` nor
// `createLedgerAccount` enforces permissions inside `execute()` at all.
// Every command in this module is gated exclusively at the HTTP route
// layer (`metadata.POST.requireFeatures`), checked by the framework
// before `commandBus.execute()` is ever called — confirmed by this same
// pattern in `api/fiscal-periods/[id]/lock/route.ts` and reused verbatim
// for this command's own route,
// `api/accounts/import-default-chart-of-accounts/route.ts`
// (`requireFeatures: ['ledger.accounts.manage']`). There is nothing to
// unit-test on `importDefaultChartOfAccountsCommand.execute` for this
// bullet — the real enforcement point is that route's `metadata`, which
// is exercised by manual QA (OM-20), not a command unit test.
export {}

import { randomUUID } from 'crypto'
import {
  LedgerAccount,
  LedgerAccountGroup,
  LedgerAccountType,
} from '../../data/entities'
import { DEFAULT_CHART_OF_ACCOUNTS_PL } from '../../lib/defaultChartOfAccounts'
import { buildFakeCtx, buildFakeEm, type FakeEm } from './support/fakeEntityManager'

const registerCommand = jest.fn()

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand,
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

const ORG_A = '11111111-1111-4111-8111-111111111111'
const ORG_B = '33333333-3333-4333-8333-333333333333'
const TENANT = '22222222-2222-4222-8222-222222222222'

const ACCOUNT_GROUP_CODES_PL = ['0', '1', '2', '3', '4', '5', '6', '7', '8']
const TOTAL_TEMPLATE_TYPES = DEFAULT_CHART_OF_ACCOUNTS_PL.length
const TOTAL_TEMPLATE_ACCOUNTS = DEFAULT_CHART_OF_ACCOUNTS_PL.reduce((sum, type) => sum + type.accounts.length, 0)

type ImportResult = { createdAccountTypeIds: string[]; createdAccountIds: string[] }
type LogEntryLike = { commandPayload: unknown; organizationId: string | null; tenantId: string | null }
type ImportCommandHandler = {
  execute: (input: unknown, ctx: unknown) => Promise<ImportResult>
  buildLog: (args: { input: unknown; result: ImportResult | undefined; ctx: unknown }) => Promise<{
    payload: unknown
    organizationId: string | null
    tenantId: string | null
  } | null>
  undo: (args: { logEntry: LogEntryLike; ctx: unknown }) => Promise<void>
}

function loadImportCommand(): ImportCommandHandler {
  let handler: unknown
  jest.isolateModules(() => {
    require('../importDefaultChartOfAccounts')
    handler = registerCommand.mock.calls.find(
      ([candidate]) => candidate.id === 'ledger.importDefaultChartOfAccounts',
    )?.[0]
  })
  if (!handler) throw new Error('ledger.importDefaultChartOfAccounts was not registered')
  return handler as ImportCommandHandler
}

function seedAccountGroups(em: FakeEm, scope: { organizationId: string; tenantId: string }) {
  return ACCOUNT_GROUP_CODES_PL.map((code) =>
    em.seed(LedgerAccountGroup, {
      id: randomUUID(),
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      jurisdiction: 'PL',
      code,
      name: `Zespół ${code}`,
      createdAt: new Date(),
    }),
  )
}

function nonDeletedCount(em: FakeEm, entityClass: { name: string }, organizationId: string) {
  return (em.tables.get(entityClass.name) ?? []).filter(
    (row) => row.organizationId === organizationId && row.deletedAt == null,
  ).length
}

describe('ledger.importDefaultChartOfAccounts', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('the template itself is 39 account types / 43 accounts (sanity check backing every count below)', () => {
    expect(TOTAL_TEMPLATE_TYPES).toBe(39)
    expect(TOTAL_TEMPLATE_ACCOUNTS).toBe(43)
  })

  it('refuses to run against a non-empty chart of accounts and writes nothing', async () => {
    const command = loadImportCommand()
    const em = buildFakeEm()
    seedAccountGroups(em, { organizationId: ORG_A, tenantId: TENANT })
    em.seed(LedgerAccountType, {
      id: 'existing-type',
      organizationId: ORG_A,
      tenantId: TENANT,
      slug: 'existing',
      name: 'Existing type',
      normalBalance: 'DEBIT',
      parentAccountTypeId: null,
      accountGroupId: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const { ctx } = buildFakeCtx(em, { organizationId: ORG_A, tenantId: TENANT })

    await expect(
      command.execute({ organizationId: ORG_A, tenantId: TENANT }, ctx),
    ).rejects.toMatchObject({ status: 409 })

    // Nothing beyond the one pre-existing row was written.
    expect(em.tables.get('LedgerAccountType')).toHaveLength(1)
    expect(em.tables.get('LedgerAccount') ?? []).toHaveLength(0)
  })

  it('soft-deleted rows do not block the import, and the full template is created alongside them', async () => {
    const command = loadImportCommand()
    const em = buildFakeEm()
    seedAccountGroups(em, { organizationId: ORG_A, tenantId: TENANT })
    em.seed(LedgerAccountType, {
      id: 'deleted-type',
      organizationId: ORG_A,
      tenantId: TENANT,
      slug: 'deleted-type',
      name: 'Deleted type',
      normalBalance: 'DEBIT',
      parentAccountTypeId: null,
      accountGroupId: null,
      deletedAt: new Date('2026-01-01'),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.seed(LedgerAccount, {
      id: 'deleted-account',
      organizationId: ORG_A,
      tenantId: TENANT,
      slug: 'deleted-account',
      accountTypeId: 'deleted-type',
      parentAccountId: null,
      description: null,
      deletedAt: new Date('2026-01-01'),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const { ctx } = buildFakeCtx(em, { organizationId: ORG_A, tenantId: TENANT })

    const result = await command.execute({ organizationId: ORG_A, tenantId: TENANT }, ctx)

    expect(result.createdAccountTypeIds).toHaveLength(TOTAL_TEMPLATE_TYPES)
    expect(result.createdAccountIds).toHaveLength(TOTAL_TEMPLATE_ACCOUNTS)
    // The soft-deleted rows are still there (untouched), plus the newly
    // imported ones — non-deleted count is exactly the template size.
    expect(em.tables.get('LedgerAccountType')).toHaveLength(1 + TOTAL_TEMPLATE_TYPES)
    expect(em.tables.get('LedgerAccount')).toHaveLength(1 + TOTAL_TEMPLATE_ACCOUNTS)
    expect(nonDeletedCount(em, LedgerAccountType, ORG_A)).toBe(TOTAL_TEMPLATE_TYPES)
    expect(nonDeletedCount(em, LedgerAccount, ORG_A)).toBe(TOTAL_TEMPLATE_ACCOUNTS)
  })

  it('happy path: creates exactly 39 account types and 43 accounts, correctly linked', async () => {
    const command = loadImportCommand()
    const em = buildFakeEm()
    const groups = seedAccountGroups(em, { organizationId: ORG_A, tenantId: TENANT })
    const groupIds = new Set(groups.map((g) => g.id as string))
    const { ctx } = buildFakeCtx(em, { organizationId: ORG_A, tenantId: TENANT })

    const result = await command.execute({ organizationId: ORG_A, tenantId: TENANT }, ctx)

    expect(result.createdAccountTypeIds).toHaveLength(39)
    expect(result.createdAccountIds).toHaveLength(43)

    const typeIds = new Set(result.createdAccountTypeIds)
    const typeRows = em.tables.get('LedgerAccountType') ?? []
    const accountRows = em.tables.get('LedgerAccount') ?? []
    expect(typeRows).toHaveLength(39)
    expect(accountRows).toHaveLength(43)

    for (const type of typeRows) {
      expect(type.organizationId).toBe(ORG_A)
      expect(type.tenantId).toBe(TENANT)
      // Phase 1 template has no type hierarchy — every type is top-level.
      expect(type.parentAccountTypeId).toBeNull()
      expect(groupIds.has(type.accountGroupId as string)).toBe(true)
    }
    for (const account of accountRows) {
      expect(account.organizationId).toBe(ORG_A)
      expect(account.tenantId).toBe(TENANT)
      // Phase 1 template has no account hierarchy — every account is top-level.
      expect(account.parentAccountId).toBeNull()
      expect(typeIds.has(account.accountTypeId as string)).toBe(true)
    }
  })

  it('undo restores an empty chart of accounts by soft-deleting exactly the imported rows', async () => {
    const command = loadImportCommand()
    const em = buildFakeEm()
    seedAccountGroups(em, { organizationId: ORG_A, tenantId: TENANT })
    const { ctx } = buildFakeCtx(em, { organizationId: ORG_A, tenantId: TENANT })

    const result = await command.execute({ organizationId: ORG_A, tenantId: TENANT }, ctx)
    const logMeta = await command.buildLog({
      input: { organizationId: ORG_A, tenantId: TENANT },
      result,
      ctx,
    })
    expect(logMeta).not.toBeNull()

    await command.undo({
      logEntry: {
        commandPayload: logMeta!.payload,
        organizationId: logMeta!.organizationId,
        tenantId: logMeta!.tenantId,
      },
      ctx,
    })

    expect(nonDeletedCount(em, LedgerAccountType, ORG_A)).toBe(0)
    expect(nonDeletedCount(em, LedgerAccount, ORG_A)).toBe(0)
    // Soft-deleted, not hard-deleted — every row is still physically present.
    expect(em.tables.get('LedgerAccountType')).toHaveLength(39)
    expect(em.tables.get('LedgerAccount')).toHaveLength(43)
  })

  it('imported rows are ordinary rows — no special "imported" marker field that could block future edits', async () => {
    const command = loadImportCommand()
    const em = buildFakeEm()
    seedAccountGroups(em, { organizationId: ORG_A, tenantId: TENANT })
    const { ctx } = buildFakeCtx(em, { organizationId: ORG_A, tenantId: TENANT })

    await command.execute({ organizationId: ORG_A, tenantId: TENANT }, ctx)

    const [typeRow] = em.tables.get('LedgerAccountType') ?? []
    const [accountRow] = em.tables.get('LedgerAccount') ?? []
    // Exactly the fields `createLedgerAccountType`/`createLedgerAccount`
    // themselves would write — no extra "isImported"/"templateId"/
    // "sourceTemplate" style field exists anywhere in this payload, so
    // there is nothing for a future edit to be blocked by.
    expect(Object.keys(typeRow).sort()).toEqual(
      ['accountGroupId', 'createdAt', 'id', 'name', 'normalBalance', 'organizationId', 'parentAccountTypeId', 'slug', 'tenantId', 'updatedAt'].sort(),
    )
    expect(Object.keys(accountRow).sort()).toEqual(
      ['accountTypeId', 'createdAt', 'description', 'id', 'organizationId', 'parentAccountId', 'slug', 'tenantId', 'updatedAt'].sort(),
    )
  })

  it('tenant/organization scoping: importing into one organization does not touch another organization\'s chart of accounts', async () => {
    const command = loadImportCommand()
    const em = buildFakeEm()
    seedAccountGroups(em, { organizationId: ORG_A, tenantId: TENANT })
    seedAccountGroups(em, { organizationId: ORG_B, tenantId: TENANT })
    // ORG_B already has a populated chart of accounts.
    em.seed(LedgerAccountType, {
      id: 'org-b-type',
      organizationId: ORG_B,
      tenantId: TENANT,
      slug: 'org-b-type',
      name: 'Org B type',
      normalBalance: 'DEBIT',
      parentAccountTypeId: null,
      accountGroupId: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const { ctx } = buildFakeCtx(em, { organizationId: ORG_A, tenantId: TENANT })

    const result = await command.execute({ organizationId: ORG_A, tenantId: TENANT }, ctx)

    expect(result.createdAccountTypeIds).toHaveLength(39)
    // ORG_A's new rows never carry ORG_B's id, and ORG_B's pre-existing row
    // is untouched (still exactly one, non-deleted).
    const allTypes = em.tables.get('LedgerAccountType') ?? []
    expect(allTypes.filter((row) => row.organizationId === ORG_B)).toHaveLength(1)
    expect(nonDeletedCount(em, LedgerAccountType, ORG_B)).toBe(1)
    expect(allTypes.filter((row) => row.organizationId === ORG_A)).toHaveLength(39)
  })
})
