// Update and delete look the record up inside the caller's tenant and selected
// organization, so a record of another organization or tenant is not found
// (404) instead of being loaded and refused (403, which would confirm the id
// exists elsewhere).
export {}

import { CostCenter, DefaultAccountPostingRule } from '../../data/entities'
import { ORG, TENANT, buildFakeEm, type FakeEm } from '../../lib/__tests__/support/fixtures'

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

function loadHandler(modulePath: string, id: string): Handler {
  let handler: unknown
  jest.isolateModules(() => {
    require(modulePath)
    handler = registerCommand.mock.calls.find(([candidate]: [{ id: string }]) => candidate.id === id)?.[0]
  })
  if (!handler) throw new Error(`[internal] ${id} was not registered`)
  return handler as Handler
}

const OTHER_ORG = '33333333-3333-4333-8333-333333333399'
const OTHER_TENANT = '44444444-4444-4444-8444-444444444499'
const FOREIGN_ORG_COST_CENTER = '77777777-7777-4777-8777-777777777781'
const FOREIGN_TENANT_COST_CENTER = '77777777-7777-4777-8777-777777777782'
const OWN_COST_CENTER = '77777777-7777-4777-8777-777777777783'
const FOREIGN_ORG_RULE = '77777777-7777-4777-8777-777777777791'
const OWN_RULE = '77777777-7777-4777-8777-777777777793'

function seed(em: FakeEm) {
  em.seed(CostCenter, { id: FOREIGN_ORG_COST_CENTER, organizationId: OTHER_ORG, tenantId: TENANT, code: 'B-1', name: 'Other org', isActive: true, deletedAt: null })
  em.seed(CostCenter, { id: FOREIGN_TENANT_COST_CENTER, organizationId: OTHER_ORG, tenantId: OTHER_TENANT, code: 'T-1', name: 'Other tenant', isActive: true, deletedAt: null })
  em.seed(CostCenter, { id: OWN_COST_CENTER, organizationId: ORG, tenantId: TENANT, code: 'A-1', name: 'Own', isActive: true, deletedAt: null })
  em.seed(DefaultAccountPostingRule, { id: FOREIGN_ORG_RULE, organizationId: OTHER_ORG, tenantId: TENANT, sourceAccountId: 's', targetAccountId: 't', defaultCostCenterId: null })
  em.seed(DefaultAccountPostingRule, { id: OWN_RULE, organizationId: ORG, tenantId: TENANT, sourceAccountId: 's2', targetAccountId: 't2', defaultCostCenterId: null })
}

function setup(selectedOrganizationId: string | null = ORG) {
  const em = buildFakeEm()
  seed(em)
  const writableEm = { ...em, create: (_entity: unknown, data: Record<string, unknown>) => data, persist: jest.fn(), remove: jest.fn(), count: jest.fn(async () => 0) }
  const ctx = {
    container: { resolve: jest.fn((token: string) => (token === 'em' ? { ...writableEm, fork: () => writableEm } : undefined)) },
    auth: { sub: 'user-1', tenantId: TENANT, orgId: ORG, isSuperAdmin: false },
    organizationScope: null,
    selectedOrganizationId,
    organizationIds: [ORG],
  }
  return { em, ctx }
}

describe('posting_rules update/delete — out-of-scope record is 404, not 403', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it.each([
    ['updateCostCenter', FOREIGN_ORG_COST_CENTER, { name: 'x' }],
    ['updateCostCenter', FOREIGN_TENANT_COST_CENTER, { name: 'x' }],
    ['deleteCostCenter', FOREIGN_ORG_COST_CENTER, {}],
    ['deleteCostCenter', FOREIGN_TENANT_COST_CENTER, {}],
  ])('%s on a record of another scope (%s) is 404', async (command, id, extra) => {
    const { ctx } = setup()
    await expect(loadHandler('../costCenters', `posting_rules.${command}`).execute({ id, ...extra }, ctx)).rejects.toMatchObject({ status: 404 })
    expect(runCrudCommandWrite).not.toHaveBeenCalled()
  })

  it.each([
    ['updateDefaultAccountPostingRule', { defaultCostCenterId: null }],
    ['deleteDefaultAccountPostingRule', {}],
  ])('%s on a rule of another organization is 404', async (command, extra) => {
    const { ctx } = setup()
    await expect(
      loadHandler('../defaultAccountPostingRules', `posting_rules.${command}`).execute({ id: FOREIGN_ORG_RULE, ...extra }, ctx),
    ).rejects.toMatchObject({ status: 404 })
    expect(runCrudCommandWrite).not.toHaveBeenCalled()
  })

  it('looks the record up with the caller tenant and selected organization', async () => {
    const { em, ctx } = setup()
    await loadHandler('../costCenters', 'posting_rules.updateCostCenter').execute({ id: OWN_COST_CENTER, name: 'Renamed' }, ctx)
    expect(em.findOne).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: OWN_COST_CENTER, tenantId: TENANT, organizationId: ORG }))
    expect(runCrudCommandWrite).toHaveBeenCalledTimes(1)
  })

  it('still updates and deletes an in-scope rule', async () => {
    const { ctx } = setup()
    await loadHandler('../defaultAccountPostingRules', 'posting_rules.updateDefaultAccountPostingRule').execute({ id: OWN_RULE, defaultCostCenterId: null }, ctx)
    await loadHandler('../defaultAccountPostingRules', 'posting_rules.deleteDefaultAccountPostingRule').execute({ id: OWN_RULE }, ctx)
    expect(runCrudCommandWrite).toHaveBeenCalledTimes(2)
  })
})

describe('resolveRecordScopeFilter — organization selection', () => {
  const { resolveRecordScopeFilter } = jest.requireActual('../../lib/recordScope') as typeof import('../../lib/recordScope')
  const base = { container: {}, organizationScope: null, request: undefined }

  it('uses the selected organization', () => {
    const ctx = { ...base, auth: { sub: 'u', tenantId: TENANT, orgId: ORG }, selectedOrganizationId: OTHER_ORG, organizationIds: [ORG, OTHER_ORG] }
    expect(resolveRecordScopeFilter(ctx as never, {})).toEqual({ tenantId: TENANT, organizationId: OTHER_ORG })
  })

  it('filters a superadmin with no organization selected by tenant only, matching the tenant-wide list', () => {
    const ctx = { ...base, auth: { sub: 'u', tenantId: TENANT, orgId: ORG, isSuperAdmin: true }, selectedOrganizationId: null, organizationIds: null }
    expect(resolveRecordScopeFilter(ctx as never, {})).toEqual({ tenantId: TENANT })
  })

  it('limits another user with no organization selected to the organizations the request allows', () => {
    const ctx = { ...base, auth: { sub: 'u', tenantId: TENANT, orgId: ORG }, selectedOrganizationId: null, organizationIds: [ORG, OTHER_ORG] }
    expect(resolveRecordScopeFilter(ctx as never, {})).toEqual({ tenantId: TENANT, organizationId: { $in: [ORG, OTHER_ORG] } })
  })

  it('uses the input scope only for a caller without ctx.auth', () => {
    const ctx = { ...base, auth: null, selectedOrganizationId: null, organizationIds: null }
    expect(resolveRecordScopeFilter(ctx as never, { tenantId: TENANT, organizationId: ORG })).toEqual({ tenantId: TENANT, organizationId: ORG })
  })
})
