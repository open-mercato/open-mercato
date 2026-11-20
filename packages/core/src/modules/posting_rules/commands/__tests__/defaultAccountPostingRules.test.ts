// `DefaultAccountPostingRule` maps a zespół 4 source account to a zespół 5
// target account (spec, Design Decisions, "`DefaultAccountPostingRule` does
// double duty"). The commands refuse accounts outside those groups.
export {}

import { DefaultAccountPostingRule } from '../../data/entities'
import { LedgerAccount, LedgerAccountGroup, LedgerAccountType } from '../../../ledger/data/entities'
import {
  ORG,
  TENANT,
  buildFakeEm,
  seedNonZespol4Account,
  seedZespol4Account,
  type FakeEm,
} from '../../lib/__tests__/support/fixtures'

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
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

type Handler = { execute: (input: unknown, ctx: unknown) => Promise<unknown> }

function loadHandler(id: string): Handler {
  let handler: unknown
  jest.isolateModules(() => {
    require('../defaultAccountPostingRules')
    handler = registerCommand.mock.calls.find(([candidate]: [{ id: string }]) => candidate.id === id)?.[0]
  })
  if (!handler) throw new Error(`[internal] ${id} was not registered`)
  return handler as Handler
}

const SOURCE = '66666666-6666-4666-8666-666666666601'
const TARGET = '66666666-6666-4666-8666-666666666602'
const NOT_CLASS_4_OR_5 = '66666666-6666-4666-8666-666666666603'
const SECOND_CLASS_4 = '66666666-6666-4666-8666-666666666604'
const RULE_ID = '66666666-6666-4666-8666-666666666610'

function seedZespol5Account(em: FakeEm, accountId: string) {
  em.seed(LedgerAccount, { id: accountId, organizationId: ORG, tenantId: TENANT, accountTypeId: 'type-5' })
  if (!em.rows(LedgerAccountType).some((row) => row.id === 'type-5')) {
    em.seed(LedgerAccountType, { id: 'type-5', organizationId: ORG, tenantId: TENANT, accountGroupId: 'group-5', normalBalance: 'DEBIT' })
    em.seed(LedgerAccountGroup, { id: 'group-5', organizationId: ORG, tenantId: TENANT, jurisdiction: 'PL', code: '5' })
  }
}

function setup() {
  const em = buildFakeEm()
  seedZespol4Account(em, SOURCE)
  seedZespol4Account(em, SECOND_CLASS_4)
  seedZespol5Account(em, TARGET)
  seedNonZespol4Account(em, NOT_CLASS_4_OR_5)
  em.seed(DefaultAccountPostingRule, { id: RULE_ID, organizationId: ORG, tenantId: TENANT, sourceAccountId: SECOND_CLASS_4, targetAccountId: TARGET, defaultCostCenterId: null })
  const writableEm = { ...em, create: (_entity: unknown, data: Record<string, unknown>) => data, persist: jest.fn(), remove: jest.fn() }
  const ctx = {
    container: { resolve: jest.fn((token: string) => (token === 'em' ? { ...writableEm, fork: () => writableEm } : undefined)) },
    auth: { sub: 'user-1', tenantId: TENANT, orgId: ORG, isSuperAdmin: false },
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
  }
  return { em, ctx }
}

const scope = { organizationId: ORG, tenantId: TENANT }

describe('posting_rules.createDefaultAccountPostingRule — account groups', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('creates a rule from a zespół 4 source to a zespół 5 target', async () => {
    const { ctx } = setup()
    await loadHandler('posting_rules.createDefaultAccountPostingRule').execute({ ...scope, sourceAccountId: SOURCE, targetAccountId: TARGET }, ctx)
    expect(runCrudCommandWrite).toHaveBeenCalledTimes(1)
  })

  it('rejects a source account outside zespół 4 with 422', async () => {
    const { ctx } = setup()
    await expect(
      loadHandler('posting_rules.createDefaultAccountPostingRule').execute({ ...scope, sourceAccountId: NOT_CLASS_4_OR_5, targetAccountId: TARGET }, ctx),
    ).rejects.toMatchObject({ status: 422, body: { error: 'The source account must be an account class 4 (costs by nature) account.' } })
    expect(runCrudCommandWrite).not.toHaveBeenCalled()
  })

  it('rejects a zespół 5 account as the source with 422', async () => {
    const { ctx } = setup()
    await expect(
      loadHandler('posting_rules.createDefaultAccountPostingRule').execute({ ...scope, sourceAccountId: TARGET, targetAccountId: TARGET }, ctx),
    ).rejects.toMatchObject({ status: 422 })
    expect(runCrudCommandWrite).not.toHaveBeenCalled()
  })

  it('rejects a target account outside zespół 5 with 422', async () => {
    const { ctx } = setup()
    await expect(
      loadHandler('posting_rules.createDefaultAccountPostingRule').execute({ ...scope, sourceAccountId: SOURCE, targetAccountId: NOT_CLASS_4_OR_5 }, ctx),
    ).rejects.toMatchObject({ status: 422, body: { error: 'The target account must be an account class 5 (costs by function) account.' } })
    expect(runCrudCommandWrite).not.toHaveBeenCalled()
  })

  it('rejects a zespół 4 account as the target with 422', async () => {
    const { ctx } = setup()
    await expect(
      loadHandler('posting_rules.createDefaultAccountPostingRule').execute({ ...scope, sourceAccountId: SOURCE, targetAccountId: SECOND_CLASS_4 }, ctx),
    ).rejects.toMatchObject({ status: 422 })
    expect(runCrudCommandWrite).not.toHaveBeenCalled()
  })
})

describe('posting_rules.updateDefaultAccountPostingRule — account groups', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('rejects changing the target to an account outside zespół 5 with 422', async () => {
    const { ctx } = setup()
    await expect(
      loadHandler('posting_rules.updateDefaultAccountPostingRule').execute({ id: RULE_ID, targetAccountId: NOT_CLASS_4_OR_5 }, ctx),
    ).rejects.toMatchObject({ status: 422 })
    expect(runCrudCommandWrite).not.toHaveBeenCalled()
  })

  it('accepts a zespół 5 target', async () => {
    const { ctx } = setup()
    await loadHandler('posting_rules.updateDefaultAccountPostingRule').execute({ id: RULE_ID, targetAccountId: TARGET }, ctx)
    expect(runCrudCommandWrite).toHaveBeenCalledTimes(1)
  })
})

