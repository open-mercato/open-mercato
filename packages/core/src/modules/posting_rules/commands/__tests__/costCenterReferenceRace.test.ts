// Deleting a cost centre and creating/updating a rule that references it must
// not interleave into a rule pointing at a deleted cost centre. Both paths
// re-read the cost centre with a row lock inside their own write transaction
// (`for update` on delete, `for share` on the rule write) and decide only
// after the lock is granted. These tests simulate the other transaction
// committing while this one waits for the lock.
export {}

import { LockMode } from '@mikro-orm/core'
import { CostCenter, DefaultAccountPostingRule } from '../../data/entities'
import { LedgerAccount, LedgerAccountGroup, LedgerAccountType } from '../../../ledger/data/entities'
import { ORG, TENANT, buildFakeEm, seedZespol4Account, type FakeEm } from '../../lib/__tests__/support/fixtures'

const registerCommand = jest.fn()
let insidePhases = false
const runCrudCommandWrite = jest.fn(async (options: { phases: Array<() => unknown> }) => {
  insidePhases = true
  try {
    for (const phase of options.phases) await phase()
  } finally {
    insidePhases = false
  }
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
    translate: (key: string) => key,
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

const COST_CENTER_ID = '88888888-8888-4888-8888-888888888801'
const SOURCE = '88888888-8888-4888-8888-888888888802'
const TARGET = '88888888-8888-4888-8888-888888888803'
const RULE_ID = '88888888-8888-4888-8888-888888888804'

type FindOptions = { lockMode?: LockMode; refresh?: boolean } | undefined

function seedZespol5Account(em: FakeEm, accountId: string) {
  em.seed(LedgerAccount, { id: accountId, organizationId: ORG, tenantId: TENANT, accountTypeId: 'type-5' })
  em.seed(LedgerAccountType, { id: 'type-5', organizationId: ORG, tenantId: TENANT, accountGroupId: 'group-5', normalBalance: 'DEBIT' })
  em.seed(LedgerAccountGroup, { id: 'group-5', organizationId: ORG, tenantId: TENANT, jurisdiction: 'PL', code: '5' })
}

/**
 * `onLock` runs when a pessimistic lock on the cost centre is requested —
 * the moment the concurrent transaction's commit becomes visible to this one.
 */
function setup(onLock: (em: FakeEm) => void) {
  const em = buildFakeEm()
  em.seed(CostCenter, { id: COST_CENTER_ID, organizationId: ORG, tenantId: TENANT, code: 'MPK-1', name: 'Marketing', isActive: true, deletedAt: null })
  seedZespol4Account(em, SOURCE)
  seedZespol5Account(em, TARGET)
  const locks: Array<{ lockMode: LockMode | undefined; insidePhases: boolean }> = []
  const baseFindOne = em.findOne.getMockImplementation() as (entity: { name: string }, where: Record<string, unknown>) => Promise<unknown>
  em.findOne.mockImplementation(async (entity: { name: string }, where: Record<string, unknown>, options: FindOptions) => {
    if (entity.name === 'CostCenter' && options?.lockMode) {
      locks.push({ lockMode: options.lockMode, insidePhases })
      onLock(em)
    }
    return baseFindOne(entity, where)
  })
  const count = jest.fn(async (entity: { name: string }, where: Record<string, unknown>) => (await em.find(entity, where)).length)
  const writableEm = {
    ...em,
    count,
    create: (_entity: unknown, data: Record<string, unknown>) => data,
    persist: jest.fn(),
    remove: jest.fn(),
  }
  const ctx = {
    container: { resolve: jest.fn((token: string) => (token === 'em' ? { ...writableEm, fork: () => writableEm } : undefined)) },
    auth: { sub: 'user-1', tenantId: TENANT, orgId: ORG, isSuperAdmin: false },
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
  }
  return { em, ctx, locks }
}

describe('cost centre delete vs. rule reference race', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('deleteCostCenter takes FOR UPDATE inside its transaction and refuses when a rule committed while it waited', async () => {
    const { em, ctx, locks } = setup((store) => {
      store.seed(DefaultAccountPostingRule, { id: RULE_ID, organizationId: ORG, tenantId: TENANT, sourceAccountId: SOURCE, targetAccountId: TARGET, defaultCostCenterId: COST_CENTER_ID })
    })

    await expect(loadHandler('../costCenters', 'posting_rules.deleteCostCenter').execute({ id: COST_CENTER_ID }, ctx)).rejects.toMatchObject({
      status: 409,
      body: { error: 'posting_rules.errors.costCenterStillInUseCannotDelete' },
    })
    expect(locks).toEqual([{ lockMode: LockMode.PESSIMISTIC_WRITE, insidePhases: true }])
    expect(em.rows(CostCenter)[0].deletedAt).toBeNull()
  })

  it('deleteCostCenter soft-deletes when no rule references it after the lock', async () => {
    const { em, ctx, locks } = setup(() => undefined)

    await loadHandler('../costCenters', 'posting_rules.deleteCostCenter').execute({ id: COST_CENTER_ID }, ctx)

    expect(locks).toEqual([{ lockMode: LockMode.PESSIMISTIC_WRITE, insidePhases: true }])
    expect(em.rows(CostCenter)[0].deletedAt).toBeInstanceOf(Date)
  })

  it('createDefaultAccountPostingRule takes FOR SHARE inside its transaction and refuses a cost centre deleted while it waited', async () => {
    const { ctx, locks } = setup((store) => {
      store.rows(CostCenter)[0].deletedAt = new Date()
    })

    await expect(
      loadHandler('../defaultAccountPostingRules', 'posting_rules.createDefaultAccountPostingRule').execute(
        { organizationId: ORG, tenantId: TENANT, sourceAccountId: SOURCE, targetAccountId: TARGET, defaultCostCenterId: COST_CENTER_ID },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 409, body: { error: 'posting_rules.errors.defaultCostCenterNotFoundForOrg' } })
    expect(locks).toEqual([{ lockMode: LockMode.PESSIMISTIC_READ, insidePhases: true }])
  })

  it('updateDefaultAccountPostingRule takes FOR SHARE inside its transaction and refuses a cost centre deleted while it waited', async () => {
    const { em, ctx, locks } = setup((store) => {
      store.rows(CostCenter)[0].deletedAt = new Date()
    })
    em.seed(DefaultAccountPostingRule, { id: RULE_ID, organizationId: ORG, tenantId: TENANT, sourceAccountId: SOURCE, targetAccountId: TARGET, defaultCostCenterId: null })

    await expect(
      loadHandler('../defaultAccountPostingRules', 'posting_rules.updateDefaultAccountPostingRule').execute(
        { id: RULE_ID, defaultCostCenterId: COST_CENTER_ID },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 409 })
    expect(locks).toEqual([{ lockMode: LockMode.PESSIMISTIC_READ, insidePhases: true }])
    expect(em.rows(DefaultAccountPostingRule)[0].defaultCostCenterId).toBeNull()
  })
})
