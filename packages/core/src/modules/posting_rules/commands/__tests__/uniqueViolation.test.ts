// Concurrent duplicates: two requests can both pass a command's `findOne`
// uniqueness check, and the second insert then fails on the DB unique index
// (SQLSTATE 23505). `makeCrudRoute`'s error handler has no unique-violation
// branch, so the commands must turn that error into a translated 409 —
// otherwise the client gets a generic 500.
export {}

import { LedgerAccount, LedgerAccountGroup, LedgerAccountType } from '../../../ledger/data/entities'
import { ORG, TENANT, buildFakeEm, seedZespol4Account, type FakeEm } from '../../lib/__tests__/support/fixtures'

const registerCommand = jest.fn()
const runCrudCommandWrite = jest.fn(async (options: { phases: Array<() => unknown> }) => {
  for (const phase of options.phases) await phase()
})

jest.mock('@open-mercato/shared/lib/commands', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/commands'),
  registerCommand,
}))
jest.mock('@open-mercato/shared/lib/commands/runCrudCommandWrite', () => ({
  runCrudCommandWrite: (options: { phases: Array<() => unknown> }) => runCrudCommandWrite(options),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (key: string) => `translated:${key}`,
  }),
}))

type Handler = { execute: (input: unknown, ctx: unknown) => Promise<unknown> }

function loadHandler(modulePath: string, id: string): Handler {
  let handler: unknown
  jest.isolateModules(() => {
    require(modulePath)
    handler = registerCommand.mock.calls.find(([candidate]: [{ id: string }]) => candidate.id === id)?.[0]
  })
  if (!handler) throw new Error(`[internal] ${id} was not registered`)
  return handler as Handler
}

function uniqueViolation(constraint: string): Error {
  return Object.assign(new Error(`duplicate key value violates unique constraint "${constraint}"`), {
    name: 'UniqueConstraintViolationException',
    code: '23505',
    constraint,
  })
}

const SOURCE = '66666666-6666-4666-8666-666666666601'
const TARGET = '66666666-6666-4666-8666-666666666602'
const COST_CENTER_ID = '66666666-6666-4666-8666-666666666620'

function seedZespol5Account(em: FakeEm, accountId: string) {
  em.seed(LedgerAccount, { id: accountId, organizationId: ORG, tenantId: TENANT, accountTypeId: 'type-5' })
  em.seed(LedgerAccountType, { id: 'type-5', organizationId: ORG, tenantId: TENANT, accountGroupId: 'group-5', normalBalance: 'DEBIT' })
  em.seed(LedgerAccountGroup, { id: 'group-5', organizationId: ORG, tenantId: TENANT, jurisdiction: 'PL', code: '5' })
}

function buildCtx(em: FakeEm, extra: Record<string, unknown> = {}) {
  const writableEm = { ...em, create: (_entity: unknown, data: Record<string, unknown>) => data, persist: jest.fn(), remove: jest.fn(), ...extra }
  return {
    container: { resolve: jest.fn((token: string) => (token === 'em' ? { ...writableEm, fork: () => writableEm } : undefined)) },
    auth: { sub: 'user-1', tenantId: TENANT, orgId: ORG, isSuperAdmin: false },
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
    request: null,
  }
}

describe('posting_rules commands — concurrent duplicate becomes a translated 409', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('createCostCenter maps a unique violation on the code index to 409', async () => {
    runCrudCommandWrite.mockRejectedValueOnce(uniqueViolation('posting_rules_cost_centers_scope_code_unique'))
    const handler = loadHandler('../costCenters', 'posting_rules.createCostCenter')

    await expect(
      handler.execute({ organizationId: ORG, tenantId: TENANT, code: 'MPK-1', name: 'Marketing' }, buildCtx(buildFakeEm())),
    ).rejects.toMatchObject({ status: 409, body: { error: 'translated:posting_rules.errors.costCenterCodeTaken' } })
  })

  it('updateCostCenter maps a unique violation on the code index to 409', async () => {
    const em = buildFakeEm()
    em.seed((await import('../../data/entities')).CostCenter, { id: COST_CENTER_ID, organizationId: ORG, tenantId: TENANT, code: 'MPK-1', name: 'Marketing', isActive: true, deletedAt: null })
    runCrudCommandWrite.mockRejectedValueOnce(uniqueViolation('posting_rules_cost_centers_scope_code_unique'))
    const handler = loadHandler('../costCenters', 'posting_rules.updateCostCenter')

    await expect(handler.execute({ id: COST_CENTER_ID, code: 'MPK-2' }, buildCtx(em))).rejects.toMatchObject({
      status: 409,
      body: { error: 'translated:posting_rules.errors.costCenterCodeTaken' },
    })
  })

  it('does not swallow a violation of another constraint', async () => {
    const other = uniqueViolation('some_other_unique')
    runCrudCommandWrite.mockRejectedValueOnce(other)
    const handler = loadHandler('../costCenters', 'posting_rules.createCostCenter')

    await expect(
      handler.execute({ organizationId: ORG, tenantId: TENANT, code: 'MPK-1', name: 'Marketing' }, buildCtx(buildFakeEm())),
    ).rejects.toBe(other)
  })

  it('createDefaultAccountPostingRule maps a unique violation on the source-account constraint to 409', async () => {
    const em = buildFakeEm()
    seedZespol4Account(em, SOURCE)
    seedZespol5Account(em, TARGET)
    runCrudCommandWrite.mockRejectedValueOnce(uniqueViolation('posting_rules_default_account_posting_rules_source_unique'))
    const handler = loadHandler('../defaultAccountPostingRules', 'posting_rules.createDefaultAccountPostingRule')

    await expect(
      handler.execute({ organizationId: ORG, tenantId: TENANT, sourceAccountId: SOURCE, targetAccountId: TARGET }, buildCtx(em)),
    ).rejects.toMatchObject({ status: 409, body: { error: 'translated:posting_rules.errors.defaultAccountPostingRuleSourceTaken' } })
  })

  it('updatePostingRulesSettings maps a concurrent first insert (scope unique) to 409', async () => {
    const flush = jest.fn(async () => {
      throw uniqueViolation('posting_rules_settings_scope_unique')
    })
    const handler = loadHandler('../postingRulesSettings', 'posting_rules.updatePostingRulesSettings')

    await expect(
      handler.execute({ organizationId: ORG, tenantId: TENANT, clearingAccountId: null }, buildCtx(buildFakeEm(), { flush })),
    ).rejects.toMatchObject({ status: 409, body: { error: 'translated:posting_rules.errors.settingsSavedConcurrently' } })
    expect(flush).toHaveBeenCalledTimes(1)
  })
})
