import type { AwilixContainer } from 'awilix'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const mockFindOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    emitCrudSideEffects: jest.fn().mockResolvedValue(undefined),
    emitCrudUndoSideEffects: jest.fn().mockResolvedValue(undefined),
    setCustomFieldsIfAny: jest.fn().mockResolvedValue(undefined),
  }
})

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback: string) => fallback,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
}))

type RegisteredCommand = {
  execute: (input: unknown, ctx: unknown) => Promise<unknown>
}

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ORG_ID = '33333333-3333-4333-8333-333333333333'
const RULE_ID = '44444444-4444-4444-8444-444444444444'
const RULE_SET_ID = '55555555-5555-4555-8555-555555555555'

async function loadAvailabilityCommand(id: string): Promise<RegisteredCommand> {
  jest.resetModules()
  const { commandRegistry } = await import('@open-mercato/shared/lib/commands')
  commandRegistry.clear()
  await import('../availability')
  return commandRegistry.get(id) as RegisteredCommand
}

async function loadRuleSetCommand(id: string): Promise<RegisteredCommand> {
  jest.resetModules()
  const { commandRegistry } = await import('@open-mercato/shared/lib/commands')
  commandRegistry.clear()
  await import('../availability-rule-sets')
  return commandRegistry.get(id) as RegisteredCommand
}

function buildRule(overrides: Record<string, unknown> = {}) {
  return {
    id: RULE_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    subjectType: 'ruleset',
    subjectId: RULE_SET_ID,
    timezone: 'UTC',
    rrule: 'DTSTART:20260710T090000Z\nDURATION:PT8H',
    exdates: [],
    kind: 'availability',
    note: 'Before',
    unavailabilityReasonEntryId: null,
    unavailabilityReasonValue: null,
    deletedAt: null,
    updatedAt: new Date('2026-07-01T10:00:00.000Z'),
    ...overrides,
  }
}

function buildRuleSet(overrides: Record<string, unknown> = {}) {
  return {
    id: RULE_SET_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    name: 'Before',
    description: null,
    timezone: 'UTC',
    deletedAt: null,
    updatedAt: new Date('2026-07-01T10:00:00.000Z'),
    ...overrides,
  }
}

function createEm() {
  const em = {
    fork: jest.fn(),
    findOne: jest.fn().mockResolvedValue(null),
    flush: jest.fn().mockResolvedValue(undefined),
  }
  em.fork.mockReturnValue(em)
  return em
}

function createCtx(em: unknown, overrides: Record<string, unknown> = {}) {
  return {
    auth: {
      sub: 'user-1',
      tenantId: TENANT_ID,
      orgId: OTHER_ORG_ID,
      isSuperAdmin: false,
    },
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'dataEngine') return {}
        return null
      },
    } as unknown as AwilixContainer,
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: [ORG_ID],
    ...overrides,
  }
}

function createNullScopeCtx(em: unknown) {
  return createCtx(em, {
    auth: { sub: 'api-key-1', tenantId: null, orgId: null, isSuperAdmin: false },
    selectedOrganizationId: null,
    organizationIds: null,
  })
}

describe('planner command target scoping', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('loads availability update targets with the actor tenant and selected organization', async () => {
    const update = await loadAvailabilityCommand('planner.availability.update')
    const em = createEm()
    const rule = buildRule()
    em.findOne.mockImplementation(async (_entity: unknown, where: Record<string, unknown>) => {
      if (where.id === RULE_ID && where.tenantId === TENANT_ID && where.organizationId === ORG_ID) return rule
      return null
    })

    await expect(update.execute({ id: RULE_ID, note: 'After' }, createCtx(em))).resolves.toEqual({ ruleId: RULE_ID })

    expect(em.findOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: RULE_ID,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        deletedAt: null,
      }),
    )
    expect(rule.note).toBe('After')
  })

  it('scopes availability delete targets before applying the soft delete', async () => {
    const remove = await loadAvailabilityCommand('planner.availability.delete')
    const em = createEm()
    const rule = buildRule()
    em.findOne.mockImplementation(async (_entity: unknown, where: Record<string, unknown>) => {
      if (where.id === RULE_ID && where.tenantId === TENANT_ID && where.organizationId === ORG_ID) return rule
      return null
    })

    await expect(remove.execute({ id: RULE_ID }, createCtx(em))).resolves.toEqual({ ruleId: RULE_ID })

    expect(rule.deletedAt).toBeInstanceOf(Date)
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('loads rule-set update targets with query scope and matching decryption scope', async () => {
    const update = await loadRuleSetCommand('planner.availability-rule-sets.update')
    const em = createEm()
    const ruleSet = buildRuleSet()
    mockFindOneWithDecryption.mockImplementation(async (_em, _entity, where: Record<string, unknown>) => {
      if (where.id === RULE_SET_ID && where.tenantId === TENANT_ID && where.organizationId === ORG_ID) return ruleSet
      return null
    })

    await expect(update.execute({ id: RULE_SET_ID, name: 'After' }, createCtx(em))).resolves.toEqual({
      ruleSetId: RULE_SET_ID,
    })

    expect(mockFindOneWithDecryption).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        id: RULE_SET_ID,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        deletedAt: null,
      }),
      undefined,
      { tenantId: TENANT_ID, organizationId: ORG_ID },
    )
    expect(ruleSet.name).toBe('After')
  })

  it('scopes rule-set delete targets before applying the soft delete', async () => {
    const remove = await loadRuleSetCommand('planner.availability-rule-sets.delete')
    const em = createEm()
    const ruleSet = buildRuleSet()
    mockFindOneWithDecryption.mockImplementation(async (_em, _entity, where: Record<string, unknown>) => {
      if (where.id === RULE_SET_ID && where.tenantId === TENANT_ID && where.organizationId === ORG_ID) return ruleSet
      return null
    })

    await expect(remove.execute({ id: RULE_SET_ID }, createCtx(em))).resolves.toEqual({ ruleSetId: RULE_SET_ID })

    expect(ruleSet.deletedAt).toBeInstanceOf(Date)
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('does not resolve a foreign availability target for an unscoped non-superadmin principal', async () => {
    const update = await loadAvailabilityCommand('planner.availability.update')
    const em = createEm()
    const foreignRule = buildRule({ tenantId: '66666666-6666-4666-8666-666666666666' })
    em.findOne.mockImplementation(async (_entity: unknown, where: Record<string, unknown>) => {
      if (where.id === RULE_ID && !('tenantId' in where) && !('organizationId' in where)) return foreignRule
      return null
    })

    await expect(
      update.execute({ id: RULE_ID, note: 'After' }, createNullScopeCtx(em)),
    ).rejects.toMatchObject<Partial<CrudHttpError>>({ status: 404 })

    expect(foreignRule.note).toBe('Before')
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('preserves unrestricted target resolution for explicit superadmin contexts', async () => {
    const update = await loadAvailabilityCommand('planner.availability.update')
    const em = createEm()
    const rule = buildRule()
    em.findOne.mockImplementation(async (_entity: unknown, where: Record<string, unknown>) => {
      if (where.id === RULE_ID && !('tenantId' in where) && !('organizationId' in where)) return rule
      return null
    })
    const ctx = createCtx(em, {
      auth: { sub: 'superadmin-1', tenantId: null, orgId: null, isSuperAdmin: true },
      selectedOrganizationId: null,
      organizationIds: null,
    })

    await expect(update.execute({ id: RULE_ID, note: 'After' }, ctx)).resolves.toEqual({ ruleId: RULE_ID })

    expect(rule.note).toBe('After')
  })
})
