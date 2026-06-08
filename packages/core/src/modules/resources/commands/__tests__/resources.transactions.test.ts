/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn().mockResolvedValue(null),
  findWithDecryption: jest.fn().mockResolvedValue([]),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    emitCrudSideEffects: jest.fn().mockResolvedValue(undefined),
    emitCrudUndoSideEffects: jest.fn().mockResolvedValue(undefined),
    setCustomFieldsIfAny: jest.fn().mockResolvedValue(undefined),
  }
})

const TEST_TENANT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const TEST_ORG_ID = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb'
const TEST_RESOURCE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

function buildFakeEm() {
  return {
    begin: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    flush: jest.fn().mockResolvedValue(undefined),
    persist: jest.fn(),
    remove: jest.fn(),
    nativeDelete: jest.fn().mockResolvedValue(undefined),
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    getReference: jest.fn((_entity: unknown, id: string) => ({ id })),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ id: TEST_RESOURCE_ID, ...data })),
  }
}

function buildEnvelope(em: ReturnType<typeof buildFakeEm>) {
  const container = {
    resolve: jest.fn().mockImplementation((name: string) => {
      if (name === 'em') return { fork: jest.fn().mockReturnValue(em) }
      if (name === 'dataEngine') return {}
      return {}
    }),
  }
  const ctx = {
    container,
    auth: { tenantId: TEST_TENANT_ID, orgId: TEST_ORG_ID, isSuperAdmin: true, sub: 'user-1' },
    selectedOrganizationId: TEST_ORG_ID,
    organizationIds: [TEST_ORG_ID],
    request: {} as Request,
    organizationScope: null,
  }
  return { container, ctx }
}

function buildResourceSnapshot() {
  return {
    id: TEST_RESOURCE_ID,
    tenantId: TEST_TENANT_ID,
    organizationId: TEST_ORG_ID,
    name: 'Resource A',
    description: null,
    resourceTypeId: null,
    capacity: null,
    capacityUnitValue: null,
    capacityUnitName: null,
    capacityUnitColor: null,
    capacityUnitIcon: null,
    appearanceIcon: null,
    appearanceColor: null,
    isActive: true,
    availabilityRuleSetId: null,
    tags: [] as string[],
    deletedAt: null,
  }
}

describe('resources commands — atomic relation writes (issue #2341)', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../resources')
  })

  beforeEach(() => {
    ;(findOneWithDecryption as jest.Mock).mockReset().mockResolvedValue(null)
  })

  it('create wraps record + tag sync in a single transaction', async () => {
    const em = buildFakeEm()
    const { ctx } = buildEnvelope(em)
    const handler = commandRegistry.get('resources.resources.create')
    expect(handler).toBeTruthy()

    await handler!.execute(
      { tenantId: TEST_TENANT_ID, organizationId: TEST_ORG_ID, name: 'Resource A' },
      ctx as any,
    )

    expect(em.begin).toHaveBeenCalledTimes(1)
    expect(em.commit).toHaveBeenCalledTimes(1)
    expect(em.rollback).not.toHaveBeenCalled()
  })

  it('create rolls back and skips side effects when a write phase fails', async () => {
    const em = buildFakeEm()
    em.flush.mockRejectedValueOnce(new Error('flush-failure'))
    const { ctx } = buildEnvelope(em)
    const { emitCrudSideEffects } = jest.requireMock('@open-mercato/shared/lib/commands/helpers')
    ;(emitCrudSideEffects as jest.Mock).mockClear()
    const handler = commandRegistry.get('resources.resources.create')

    await expect(
      handler!.execute(
        { tenantId: TEST_TENANT_ID, organizationId: TEST_ORG_ID, name: 'Resource A' },
        ctx as any,
      ),
    ).rejects.toThrow('flush-failure')

    expect(em.begin).toHaveBeenCalledTimes(1)
    expect(em.rollback).toHaveBeenCalledTimes(1)
    expect(em.commit).not.toHaveBeenCalled()
    expect(emitCrudSideEffects).not.toHaveBeenCalled()
  })

  it('update wraps scalar mutations + tag sync in a single transaction', async () => {
    const em = buildFakeEm()
    const record = {
      id: TEST_RESOURCE_ID,
      tenantId: TEST_TENANT_ID,
      organizationId: TEST_ORG_ID,
      name: 'Resource A',
    }
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(record)
    const { ctx } = buildEnvelope(em)
    const handler = commandRegistry.get('resources.resources.update')

    await handler!.execute({ id: TEST_RESOURCE_ID, name: 'Resource B' }, ctx as any)

    expect(em.begin).toHaveBeenCalledTimes(1)
    expect(em.commit).toHaveBeenCalledTimes(1)
    expect(em.rollback).not.toHaveBeenCalled()
  })

  it('update undo restores scalars + tags inside a transaction', async () => {
    const em = buildFakeEm()
    const record = {
      id: TEST_RESOURCE_ID,
      tenantId: TEST_TENANT_ID,
      organizationId: TEST_ORG_ID,
    }
    em.findOne.mockResolvedValue(record)
    const { ctx } = buildEnvelope(em)
    const undo = commandRegistry.get('resources.resources.update')?.undo
    expect(undo).toBeInstanceOf(Function)

    await undo!({
      logEntry: { payload: { undo: { before: buildResourceSnapshot(), after: buildResourceSnapshot() } } } as any,
      ctx: ctx as any,
    } as any)

    expect(em.begin).toHaveBeenCalledTimes(1)
    expect(em.commit).toHaveBeenCalledTimes(1)
    expect(em.rollback).not.toHaveBeenCalled()
  })

  it('delete undo recreates record + tags inside a transaction', async () => {
    const em = buildFakeEm()
    em.findOne.mockResolvedValue(null)
    const { ctx } = buildEnvelope(em)
    const undo = commandRegistry.get('resources.resources.delete')?.undo
    expect(undo).toBeInstanceOf(Function)

    await undo!({
      logEntry: { payload: { undo: { before: buildResourceSnapshot() } } } as any,
      ctx: ctx as any,
    } as any)

    expect(em.begin).toHaveBeenCalledTimes(1)
    expect(em.commit).toHaveBeenCalledTimes(1)
    expect(em.rollback).not.toHaveBeenCalled()
  })
})
