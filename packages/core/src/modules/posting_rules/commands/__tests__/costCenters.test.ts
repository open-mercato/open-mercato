// The sentinel `UNALLOCATED` cost centre is protected by the commands (spec,
// Design Decisions, "The sentinel CostCenter is protected by the commands"):
// its code cannot change, it cannot be deactivated, it cannot be deleted.
export {}

import { CostCenter } from '../../data/entities'
import { UNALLOCATED_COST_CENTER_CODE } from '../../lib/seedDefaults'
import { buildFakeEm, ORG, TENANT } from '../../lib/__tests__/support/fixtures'

const registerCommand = jest.fn()
const runCrudCommandWrite = jest.fn(async () => undefined)

jest.mock('@open-mercato/shared/lib/commands', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/commands'),
  registerCommand,
}))
jest.mock('@open-mercato/shared/lib/commands/runCrudCommandWrite', () => ({
  runCrudCommandWrite: (...args: unknown[]) => runCrudCommandWrite(...(args as [])),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

const SENTINEL_ID = '77777777-7777-4777-8777-777777777771'
const REGULAR_ID = '77777777-7777-4777-8777-777777777772'

type Handler = { execute: (input: unknown, ctx: unknown) => Promise<unknown> }

function loadHandler(id: string): Handler {
  let handler: unknown
  jest.isolateModules(() => {
    require('../costCenters')
    handler = registerCommand.mock.calls.find(([candidate]: [{ id: string }]) => candidate.id === id)?.[0]
  })
  if (!handler) throw new Error(`${id} was not registered`)
  return handler as Handler
}

function setup() {
  const em = buildFakeEm()
  em.seed(CostCenter, { id: SENTINEL_ID, organizationId: ORG, tenantId: TENANT, code: UNALLOCATED_COST_CENTER_CODE, name: 'Unallocated', isActive: true, deletedAt: null })
  em.seed(CostCenter, { id: REGULAR_ID, organizationId: ORG, tenantId: TENANT, code: 'MPK-1', name: 'Marketing', isActive: true, deletedAt: null })
  const ctx = {
    container: { resolve: jest.fn((token: string) => (token === 'em' ? { ...em, fork: () => ({ ...em, persist: jest.fn(), count: jest.fn(async () => 0) }) } : undefined)) },
    auth: { sub: 'user-1', tenantId: TENANT, orgId: ORG, isSuperAdmin: false },
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
  }
  return { em, ctx }
}

describe('posting_rules.updateCostCenter — sentinel protection', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('rejects changing the sentinel\'s code with 409', async () => {
    const { ctx } = setup()
    await expect(loadHandler('posting_rules.updateCostCenter').execute({ id: SENTINEL_ID, code: 'RENAMED' }, ctx)).rejects.toMatchObject({ status: 409 })
    expect(runCrudCommandWrite).not.toHaveBeenCalled()
  })

  it('rejects deactivating the sentinel with 409', async () => {
    const { ctx } = setup()
    await expect(loadHandler('posting_rules.updateCostCenter').execute({ id: SENTINEL_ID, isActive: false }, ctx)).rejects.toMatchObject({ status: 409 })
    expect(runCrudCommandWrite).not.toHaveBeenCalled()
  })

  it('still lets the sentinel be renamed (name only) and re-saved with its own code', async () => {
    const { ctx } = setup()
    await loadHandler('posting_rules.updateCostCenter').execute({ id: SENTINEL_ID, name: 'Unallocated costs', code: UNALLOCATED_COST_CENTER_CODE, isActive: true }, ctx)
    expect(runCrudCommandWrite).toHaveBeenCalledTimes(1)
  })

  it('lets an ordinary cost centre be deactivated', async () => {
    const { ctx } = setup()
    await loadHandler('posting_rules.updateCostCenter').execute({ id: REGULAR_ID, isActive: false }, ctx)
    expect(runCrudCommandWrite).toHaveBeenCalledTimes(1)
  })
})

describe('posting_rules.deleteCostCenter — sentinel protection', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('rejects deleting the sentinel with 409', async () => {
    const { ctx } = setup()
    await expect(loadHandler('posting_rules.deleteCostCenter').execute({ id: SENTINEL_ID }, ctx)).rejects.toMatchObject({ status: 409 })
    expect(runCrudCommandWrite).not.toHaveBeenCalled()
  })
})
