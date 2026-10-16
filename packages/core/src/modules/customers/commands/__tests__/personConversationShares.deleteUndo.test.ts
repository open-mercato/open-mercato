jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string, fallback?: string) => fallback ?? key }),
}))

const mockFindWithDecryption = jest.fn(async (_manager: unknown, _entityClass: unknown, _where: unknown): Promise<unknown[]> => [])
const mockFindOneWithDecryption = jest.fn(async (_manager: unknown, _entityClass: unknown): Promise<unknown> => null)
const mockEmitCrudSideEffects = jest.fn(async () => undefined)
const mockEmitCrudUndoSideEffects = jest.fn(async () => undefined)

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: [unknown, unknown, unknown]) => mockFindWithDecryption(...args),
  findOneWithDecryption: (...args: [unknown, unknown]) => mockFindOneWithDecryption(...args),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  ...jest.requireActual<typeof import('@open-mercato/shared/lib/commands/helpers')>('@open-mercato/shared/lib/commands/helpers'),
  emitCrudSideEffects: () => mockEmitCrudSideEffects(),
  emitCrudUndoSideEffects: () => mockEmitCrudUndoSideEffects(),
}))

jest.mock('@open-mercato/shared/lib/commands/customFieldSnapshots', () => ({
  ...jest.requireActual<typeof import('@open-mercato/shared/lib/commands/customFieldSnapshots')>('@open-mercato/shared/lib/commands/customFieldSnapshots'),
  loadCustomFieldSnapshot: async () => ({}),
}))

jest.mock('../../lib/customFieldRouting', () => ({
  ...jest.requireActual<typeof import('../../lib/customFieldRouting')>('../../lib/customFieldRouting'),
  resolvePersonCustomFieldRouting: async () => new Map(),
}))

jest.mock('../../lib/personCompanies', () => ({
  loadPersonCompanyLinks: async () => [],
  summarizePersonCompanies: () => [],
  syncLegacyPrimaryCompanyLink: async () => undefined,
}))

jest.mock('../shared', () => ({
  ...jest.requireActual<typeof import('../shared')>('../shared'),
  loadEntityTagIds: async () => [],
  syncEntityTags: async () => undefined,
  emitQueryIndexDeleteEvents: async () => undefined,
  emitQueryIndexUpsertEvents: async () => undefined,
}))

import '../people'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import {
  CustomerEmailConversationShare,
  CustomerEntity,
  CustomerPersonProfile,
} from '../../data/entities'

const TENANT_ID = '00000000-0000-4000-8000-000000000001'
const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000002'
const PERSON_ID = '00000000-0000-4000-8000-000000000003'
const PROFILE_ID = '00000000-0000-4000-8000-000000000004'
const OWNER_ID = '00000000-0000-4000-8000-000000000005'
const OTHER_OWNER_ID = '00000000-0000-4000-8000-000000000006'
const CREATED_AT = new Date('2026-09-28T10:00:00.000Z')
const UPDATED_AT = new Date('2026-09-29T11:00:00.000Z')
const REVOKED_AT = new Date('2026-09-29T11:00:00.000Z')

function getHandler(commandId: string) {
  const handler = commandRegistry.get(commandId)
  if (!handler) throw new Error(`[internal] Missing command ${commandId}`)
  return handler
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('[internal] Expected record')
  return value as Record<string, unknown>
}

function matchesShare(share: CustomerEmailConversationShare, filter: Record<string, unknown>) {
  const personFilter = filter.personEntity
  const personId = typeof personFilter === 'string' ? personFilter : personFilter ? asRecord(personFilter).id : undefined
  return (personId === undefined || share.personEntity.id === personId)
    && (filter.tenantId === undefined || share.tenantId === filter.tenantId)
    && (filter.organizationId === undefined || share.organizationId === filter.organizationId)
    && (filter.ownerUserId === undefined || share.ownerUserId === filter.ownerUserId)
    && (!Object.prototype.hasOwnProperty.call(filter, 'deletedAt') || (share.deletedAt ?? null) === filter.deletedAt)
}

function makeFixture() {
  const entity = Object.assign(new CustomerEntity(), {
    id: PERSON_ID,
    organizationId: ORGANIZATION_ID,
    tenantId: TENANT_ID,
    kind: 'person' as const,
    displayName: 'Conversation owner',
    isActive: true,
  })
  const profile = Object.assign(new CustomerPersonProfile(), {
    id: PROFILE_ID,
    organizationId: ORGANIZATION_ID,
    tenantId: TENANT_ID,
    entity,
    firstName: 'Conversation',
    lastName: 'Owner',
  })
  const shares = [
    Object.assign(new CustomerEmailConversationShare(), {
      id: 'share-active', personEntity: entity, organizationId: ORGANIZATION_ID, tenantId: TENANT_ID,
      ownerUserId: OWNER_ID, sharedByUserId: OTHER_OWNER_ID,
      createdAt: CREATED_AT, updatedAt: UPDATED_AT, deletedAt: null,
    }),
    Object.assign(new CustomerEmailConversationShare(), {
      id: 'share-revoked', personEntity: entity, organizationId: ORGANIZATION_ID, tenantId: TENANT_ID,
      ownerUserId: OWNER_ID, sharedByUserId: OWNER_ID,
      createdAt: CREATED_AT, updatedAt: UPDATED_AT, deletedAt: REVOKED_AT,
    }),
    Object.assign(new CustomerEmailConversationShare(), {
      id: 'share-older-revoked', personEntity: entity, organizationId: ORGANIZATION_ID, tenantId: TENANT_ID,
      ownerUserId: OWNER_ID, sharedByUserId: OWNER_ID,
      createdAt: CREATED_AT, updatedAt: null, deletedAt: REVOKED_AT,
    }),
    Object.assign(new CustomerEmailConversationShare(), {
      id: 'share-other-owner', personEntity: entity, organizationId: ORGANIZATION_ID, tenantId: TENANT_ID,
      ownerUserId: OTHER_OWNER_ID, sharedByUserId: OTHER_OWNER_ID,
      createdAt: CREATED_AT, updatedAt: null, deletedAt: null,
    }),
  ]
  const state = { shares: [...shares], entity: entity as CustomerEntity | null, profile: profile as CustomerPersonProfile | null }
  let transactionSnapshot = { ...state, shares: [...state.shares] }
  const em = {
    fork: jest.fn(),
    findOne: jest.fn(async (entityClass: unknown) => entityClass === CustomerEntity ? state.entity : entityClass === CustomerPersonProfile ? state.profile : null),
    find: jest.fn(async () => []),
    count: jest.fn(async () => 0),
    nativeDelete: jest.fn(async (entityClass: unknown, where: Record<string, unknown>) => {
      if (entityClass === CustomerEmailConversationShare) state.shares = state.shares.filter((share) => !matchesShare(share, where))
      return 0
    }),
    nativeUpdate: jest.fn(async (entityClass: unknown, where: Record<string, unknown>, values: Record<string, unknown>) => {
      if (entityClass === CustomerEmailConversationShare) {
        const ids = asRecord(where.id).$in
        if (!Array.isArray(ids)) throw new Error('[internal] Expected share IDs')
        for (const share of state.shares) {
          if (ids.includes(share.id) && matchesShare(share, where)) Object.assign(share, values)
        }
      }
      return 0
    }),
    remove: jest.fn((record: unknown) => {
      if (record === state.entity) {
        if (state.shares.some((share) => share.personEntity.id === entity.id)) throw new Error('[internal] foreign key violation')
        state.entity = null
      }
      if (record === state.profile) state.profile = null
    }),
    create: jest.fn((entityClass: unknown, values: Record<string, unknown>) => {
      if (entityClass === CustomerEmailConversationShare) return Object.assign(new CustomerEmailConversationShare(), values, { updatedAt: values.updatedAt ?? new Date() })
      if (entityClass === CustomerEntity) return Object.assign(new CustomerEntity(), values)
      if (entityClass === CustomerPersonProfile) return Object.assign(new CustomerPersonProfile(), values)
      return values
    }),
    persist: jest.fn((record: unknown) => {
      if (record instanceof CustomerEmailConversationShare) state.shares.push(record)
      if (record instanceof CustomerEntity) state.entity = record
      if (record instanceof CustomerPersonProfile) state.profile = record
    }),
    flush: jest.fn(async () => undefined),
    begin: jest.fn(async () => { transactionSnapshot = { ...state, shares: [...state.shares] } }),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => { Object.assign(state, transactionSnapshot) }),
    getReference: jest.fn((_entityClass: unknown, id: string) => ({ id })),
  }
  em.fork.mockReturnValue(em)
  mockFindOneWithDecryption.mockImplementation(async (_manager, entityClass) => em.findOne(entityClass))
  mockFindWithDecryption.mockImplementation(async (_manager, entityClass, where) => entityClass === CustomerEmailConversationShare
    ? state.shares.filter((share) => matchesShare(share, asRecord(where)))
    : [])
  const dataEngine = {
    setCustomFields: jest.fn(async () => undefined),
    emitOrmEntityEvent: jest.fn(async () => undefined),
    markOrmEntityChange: jest.fn(),
    flushOrmEntityChanges: jest.fn(async () => undefined),
  }
  const ctx = {
    container: { resolve: (token: string): unknown => token === 'em' ? em : token === 'dataEngine' ? dataEngine : undefined },
    auth: { sub: OWNER_ID, tenantId: TENANT_ID, orgId: ORGANIZATION_ID },
    selectedOrganizationId: ORGANIZATION_ID,
    organizationScope: null,
    organizationIds: null,
  } as unknown as CommandRuntimeContext
  return { entity, profile, shares, state, em, ctx }
}

async function captureDelete(fixture: ReturnType<typeof makeFixture>) {
  const handler = getHandler('customers.people.delete')
  const input = { body: { id: PERSON_ID } }
  const snapshots = await handler.prepare?.(input, fixture.ctx)
  const before = asRecord(snapshots?.before)
  const log = await handler.buildLog?.({ input, result: { entityId: PERSON_ID }, ctx: fixture.ctx, snapshots: { before } })
  if (!log) throw new Error('[internal] Missing delete log')
  return { handler, input, before, log }
}

describe('Person delete and undo preserve conversation shares', () => {
  beforeEach(() => jest.clearAllMocks())

  it('captures active, revoked and other-owner shares only for the authorized Person scope', async () => {
    const fixture = makeFixture()
    const { before } = await captureDelete(fixture)
    expect(before.emailConversationShares).toEqual(fixture.shares.map((share) => ({
      id: share.id, ownerUserId: share.ownerUserId, sharedByUserId: share.sharedByUserId,
      createdAt: share.createdAt, updatedAt: share.updatedAt, deletedAt: share.deletedAt,
    })))
    const call = mockFindWithDecryption.mock.calls.find(([, entityClass]) => entityClass === CustomerEmailConversationShare)
    expect(call?.[2]).toEqual({ personEntity: PERSON_ID, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID })
  })

  it.each(['tenant', 'organization'])('rejects an unauthorized %s before reading share metadata', async (scope) => {
    const fixture = makeFixture()
    if (scope === 'tenant') fixture.ctx.auth = { ...fixture.ctx.auth!, tenantId: 'another-tenant' }
    else fixture.ctx.selectedOrganizationId = 'another-organization'
    await expect(getHandler('customers.people.delete').prepare?.({ body: { id: PERSON_ID } }, fixture.ctx)).rejects.toMatchObject({ status: 403 })
    expect(mockFindWithDecryption.mock.calls.some(([, entityClass]) => entityClass === CustomerEmailConversationShare)).toBe(false)
  })

  it('keeps share ownership and revocation history out of public audit snapshots', async () => {
    const { log, before } = await captureDelete(makeFixture())
    expect(log.snapshotBefore).not.toHaveProperty('emailConversationShares')
    expect(asRecord(asRecord(log.payload).undo).before).toEqual(before)
    expect(before).toHaveProperty('emailConversationShares')
  })

  it('keeps create and update snapshots free of conversation-share metadata', async () => {
    const fixture = makeFixture()
    const after = await getHandler('customers.people.create').captureAfter?.({}, { entityId: PERSON_ID, personId: PROFILE_ID }, fixture.ctx)
    const update = await getHandler('customers.people.update').prepare?.({ id: PERSON_ID }, fixture.ctx)
    expect(after).not.toHaveProperty('emailConversationShares')
    expect(update?.before).not.toHaveProperty('emailConversationShares')
    expect(mockFindWithDecryption.mock.calls.some(([, entityClass]) => entityClass === CustomerEmailConversationShare)).toBe(false)
  })

  it.each(['active', 'revoked'])('deletes a Person with %s shares and leaves a neighboring Person untouched', async (status) => {
    const fixture = makeFixture()
    fixture.state.shares = fixture.shares.filter((share) => status === 'active' ? !share.deletedAt : Boolean(share.deletedAt))
    const neighbor = Object.assign(new CustomerEmailConversationShare(), fixture.shares[0], { id: 'neighbor-share', personEntity: { id: 'neighbor-person' } })
    fixture.state.shares.push(neighbor)
    await expect(getHandler('customers.people.delete').execute({ body: { id: PERSON_ID } }, fixture.ctx)).resolves.toEqual({ entityId: PERSON_ID })
    expect(fixture.state.entity).toBeNull()
    expect(fixture.state.shares).toEqual([neighbor])
    expect(fixture.em.nativeDelete).toHaveBeenCalledWith(CustomerEmailConversationShare, { personEntity: fixture.entity, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID })
    expect(fixture.em.commit).toHaveBeenCalledTimes(1)
  })

  it('restores exact share ids, owners, actors, nullable dates and revocation state after JSON persistence', async () => {
    const fixture = makeFixture()
    const { handler, input, log } = await captureDelete(fixture)
    const persistedPayload: unknown = JSON.parse(JSON.stringify(log.payload))
    fixture.state.shares = []
    fixture.state.entity = null
    fixture.state.profile = null
    await handler.undo?.({ input, ctx: fixture.ctx, logEntry: { commandPayload: persistedPayload } })
    const restoredShares = fixture.state.shares.map((share) => ({
      id: share.id, personEntityId: share.personEntity.id, tenantId: share.tenantId, organizationId: share.organizationId,
      ownerUserId: share.ownerUserId, sharedByUserId: share.sharedByUserId,
      createdAt: share.createdAt, updatedAt: share.updatedAt, deletedAt: share.deletedAt,
    }))
    expect(restoredShares).toEqual(fixture.shares.map((share) => ({
      id: share.id, personEntityId: PERSON_ID, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID,
      ownerUserId: share.ownerUserId, sharedByUserId: share.sharedByUserId,
      createdAt: share.createdAt, updatedAt: share.updatedAt, deletedAt: share.deletedAt,
    })))
    expect(fixture.state.shares.every((share) => share.createdAt instanceof Date)).toBe(true)
    expect(fixture.em.nativeDelete).toHaveBeenCalledWith(CustomerEmailConversationShare, { personEntity: fixture.state.entity, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID })
    expect(fixture.em.nativeUpdate).toHaveBeenCalledWith(CustomerEmailConversationShare, {
      id: { $in: ['share-older-revoked', 'share-other-owner'] },
      personEntity: fixture.state.entity,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
    }, { updatedAt: null })
    expect(fixture.em.commit).toHaveBeenCalledTimes(1)
  })

  it('restores legacy delete logs without a share collection', async () => {
    const fixture = makeFixture()
    const { handler, input, before } = await captureDelete(fixture)
    delete before.emailConversationShares
    fixture.state.shares = []
    await expect(handler.undo?.({ input, ctx: fixture.ctx, logEntry: { commandPayload: { undo: { before } } } })).resolves.toBeUndefined()
    expect(fixture.state.shares).toEqual([])
    expect(fixture.em.commit).toHaveBeenCalledTimes(1)
  })

  it('rolls back the delete when removing shares fails without emitting side effects', async () => {
    const fixture = makeFixture()
    const nativeDelete = fixture.em.nativeDelete.getMockImplementation()!
    fixture.em.nativeDelete.mockImplementation(async (entityClass, where) => {
      if (entityClass === CustomerEmailConversationShare) throw new Error('[internal] share deletion failed')
      return nativeDelete(entityClass, where)
    })
    await expect(getHandler('customers.people.delete').execute({ body: { id: PERSON_ID } }, fixture.ctx)).rejects.toThrow('[internal] share deletion failed')
    expect(fixture.state.shares).toEqual(fixture.shares)
    expect(fixture.state.entity).toBe(fixture.entity)
    expect(fixture.em.rollback).toHaveBeenCalledTimes(1)
    expect(fixture.em.commit).not.toHaveBeenCalled()
    expect(mockEmitCrudSideEffects).not.toHaveBeenCalled()
  })

  it('rolls back undo if share restoration fails without emitting side effects', async () => {
    const fixture = makeFixture()
    const { handler, input, log } = await captureDelete(fixture)
    fixture.state.shares = []
    fixture.state.entity = null
    fixture.state.profile = null
    const create = fixture.em.create.getMockImplementation()!
    fixture.em.create.mockImplementation((entityClass, values) => {
      if (entityClass === CustomerEmailConversationShare) throw new Error('[internal] share restoration failed')
      return create(entityClass, values)
    })
    await expect(handler.undo?.({ input, ctx: fixture.ctx, logEntry: { commandPayload: log.payload } })).rejects.toThrow('[internal] share restoration failed')
    expect(fixture.state.entity).toBeNull()
    expect(fixture.state.shares).toEqual([])
    expect(fixture.em.rollback).toHaveBeenCalledTimes(1)
    expect(fixture.em.commit).not.toHaveBeenCalled()
    expect(mockEmitCrudUndoSideEffects).not.toHaveBeenCalled()
  })

  it('removes active and revoked shares before undoing Person creation', async () => {
    const fixture = makeFixture()
    await expect(getHandler('customers.people.create').undo?.({ input: {}, ctx: fixture.ctx, logEntry: { resourceId: PERSON_ID } })).resolves.toBeUndefined()
    expect(fixture.state.entity).toBeNull()
    expect(fixture.state.shares).toEqual([])
    expect(fixture.em.nativeDelete).toHaveBeenCalledWith(CustomerEmailConversationShare, { personEntity: fixture.entity, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID })
    expect(fixture.em.commit).toHaveBeenCalledTimes(1)
  })
})
