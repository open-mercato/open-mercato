jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string, fallback?: string) => fallback ?? key }),
}))

const mockFindWithDecryption = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockEmitCustomersEvent = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

jest.mock('../../events', () => ({
  emitCustomersEvent: (...args: unknown[]) => mockEmitCustomersEvent(...args),
}))

import '../tags'
import type { AwilixContainer } from 'awilix'
import { LockMode } from '@mikro-orm/core'
import type { CommandHandler, CommandRuntimeContext, CommandUndoLogEntry } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CustomerEntity, CustomerTag, CustomerTagAssignment } from '../../data/entities'

const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_TENANT_ID = '99999999-9999-4999-8999-999999999999'
const OTHER_ORGANIZATION_ID = '88888888-8888-4888-8888-888888888888'
const TAG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PERSON_ID = '33333333-3333-4333-8333-333333333333'
const COMPANY_ID = '44444444-4444-4444-8444-444444444444'
const CREATED_AT = new Date('2026-10-20T12:34:56.789Z')
const previousCrudCacheFlag = process.env.ENABLE_CRUD_API_CACHE

type TagRow = {
  id: string
  tenantId: string
  organizationId: string
  slug: string
  label: string
  color: string | null
  description: string | null
}

type CustomerRow = {
  id: string
  kind: 'person' | 'company'
  tenantId: string
  organizationId: string
  deletedAt: Date | null
}

type AssignmentRow = {
  id: string
  tagId: string
  entityId: string
  tenantId: string
  organizationId: string
  createdAt: Date
}

type AssignmentSnapshot = Omit<AssignmentRow, 'tagId' | 'createdAt'> & { createdAt: string }
type TagSnapshot = TagRow & { assignments?: AssignmentSnapshot[] }
type DeleteInput = { body: { id: string } }
type DeleteHandler = CommandHandler<DeleteInput, { tagId: string }>
type PersistedLog = CommandUndoLogEntry & { commandPayload: { undo: { before: TagSnapshot } } }

function referenceId(value: unknown): unknown {
  return value && typeof value === 'object' && 'id' in value ? value.id : value
}

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key]
    if (expected && typeof expected === 'object' && '$in' in expected) {
      return Array.isArray(expected.$in) && expected.$in.includes(referenceId(actual))
    }
    return referenceId(actual) === referenceId(expected)
  })
}

function makeStore() {
  const tags = new Map<string, TagRow>([[TAG_ID, {
    id: TAG_ID, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID,
    slug: 'important', label: 'Important', color: null, description: 'Shared by people and companies',
  }]])
  const customers = new Map<string, CustomerRow>([
    [PERSON_ID, { id: PERSON_ID, kind: 'person', tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, deletedAt: null }],
    [COMPANY_ID, { id: COMPANY_ID, kind: 'company', tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, deletedAt: null }],
  ])
  const assignments = new Map<string, AssignmentRow>([PERSON_ID, COMPANY_ID].map((entityId, index) => {
    const id = `55555555-5555-4555-8555-55555555555${index}`
    return [id, { id, entityId, tagId: TAG_ID, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, createdAt: CREATED_AT }]
  }))
  const pendingSaves = new Set<CustomerTag | CustomerTagAssignment>()
  const pendingRemovals = new Set<CustomerTag | CustomerTagAssignment>()
  const insertedTags = new Set<CustomerTag>()
  let transactionSnapshot: { tags: Map<string, TagRow>; assignments: Map<string, AssignmentRow> } | null = null
  let assignmentFlushFails = false
  const hydrateTag = (row: TagRow): CustomerTag => Object.assign(new CustomerTag(), row)
  const hydrateCustomer = (row: CustomerRow): CustomerEntity => Object.assign(new CustomerEntity(), row)
  const hydrateAssignment = (row: AssignmentRow): CustomerTagAssignment => Object.assign(new CustomerTagAssignment(), {
    id: row.id, tenantId: row.tenantId, organizationId: row.organizationId, createdAt: row.createdAt,
    tag: Object.assign(new CustomerTag(), tags.get(row.tagId) ?? { id: row.tagId }),
    entity: Object.assign(new CustomerEntity(), customers.get(row.entityId) ?? { id: row.entityId }),
  })
  const read = (ctor: unknown, where: Record<string, unknown>): Array<CustomerTag | CustomerEntity | CustomerTagAssignment> => {
    if (ctor === CustomerTag) return [...tags.values()].filter((row) => matches(row, where)).map(hydrateTag)
    if (ctor === CustomerEntity) return [...customers.values()].filter((row) => matches(row, where)).map(hydrateCustomer)
    if (ctor === CustomerTagAssignment) {
      return [...assignments.values()].filter((row) => matches({ ...row, tag: row.tagId, entity: row.entityId }, where)).map(hydrateAssignment)
    }
    throw new Error('[internal] Unexpected entity class')
  }
  const em = {
    fork: jest.fn(),
    find: jest.fn(async (ctor: unknown, where: Record<string, unknown>) => read(ctor, where)),
    findOne: jest.fn(async (ctor: unknown, where: Record<string, unknown>, _options?: Record<string, unknown>) => read(ctor, where)[0] ?? null),
    create: jest.fn((ctor: unknown, data: Record<string, unknown>) => {
      if (ctor === CustomerTag) {
        const tag = Object.assign(new CustomerTag(), data)
        insertedTags.add(tag)
        return tag
      }
      if (ctor === CustomerTagAssignment) return Object.assign(new CustomerTagAssignment(), { id: 'new-assignment' }, data)
      throw new Error('[internal] Unexpected entity class')
    }),
    persist: jest.fn((entity: CustomerTag | CustomerTagAssignment) => { pendingSaves.add(entity) }),
    remove: jest.fn((entity: CustomerTag | CustomerTagAssignment) => { pendingRemovals.add(entity) }),
    nativeDelete: jest.fn(async (ctor: unknown, where: Record<string, unknown>) => {
      if (ctor !== CustomerTagAssignment) throw new Error('[internal] Unexpected nativeDelete target')
      let count = 0
      for (const [id, row] of assignments) {
        if (matches({ ...row, tag: row.tagId, entity: row.entityId }, where)) {
          assignments.delete(id)
          count += 1
        }
      }
      return count
    }),
    isInTransaction: jest.fn(() => transactionSnapshot !== null),
    begin: jest.fn(async () => {
      transactionSnapshot = {
        tags: new Map([...tags].map(([id, row]) => [id, { ...row }])),
        assignments: new Map([...assignments].map(([id, row]) => [id, { ...row }])),
      }
    }),
    commit: jest.fn(async () => { transactionSnapshot = null }),
    rollback: jest.fn(async () => {
      if (!transactionSnapshot) throw new Error('[internal] Rollback outside transaction')
      tags.clear()
      assignments.clear()
      for (const [id, row] of transactionSnapshot.tags) tags.set(id, row)
      for (const [id, row] of transactionSnapshot.assignments) assignments.set(id, row)
      pendingSaves.clear()
      pendingRemovals.clear()
      insertedTags.clear()
      transactionSnapshot = null
    }),
    flush: jest.fn(async () => {
      if (assignmentFlushFails && [...pendingSaves].some((entity) => entity instanceof CustomerTagAssignment)) {
        throw new Error('[internal] Assignment insert failed')
      }
      for (const entity of pendingSaves) {
        if (entity instanceof CustomerTag) {
          if (insertedTags.has(entity) && tags.has(entity.id)) throw new Error('[internal] Duplicate tag id')
          tags.set(entity.id, {
            id: entity.id, tenantId: entity.tenantId, organizationId: entity.organizationId,
            slug: entity.slug, label: entity.label, color: entity.color ?? null, description: entity.description ?? null,
          })
        } else {
          if (!tags.has(entity.tag.id)) throw new Error('[internal] Assignment tag does not exist')
          if (!customers.has(entity.entity.id)) throw new Error('[internal] Assignment customer does not exist')
          const duplicate = [...assignments.values()].some((row) => row.id !== entity.id && row.tagId === entity.tag.id && row.entityId === entity.entity.id)
          if (duplicate) throw new Error('[internal] Duplicate tag membership')
          assignments.set(entity.id, {
            id: entity.id, tenantId: entity.tenantId, organizationId: entity.organizationId,
            tagId: entity.tag.id, entityId: entity.entity.id, createdAt: entity.createdAt,
          })
        }
      }
      pendingSaves.clear()
      insertedTags.clear()
      for (const entity of pendingRemovals) {
        if (entity instanceof CustomerTag) tags.delete(entity.id)
        else assignments.delete(entity.id)
      }
      pendingRemovals.clear()
    }),
  }
  em.fork.mockReturnValue(em)
  mockFindWithDecryption.mockImplementation(async (...args: unknown[]) => {
    const [, ctor, where] = args as [unknown, unknown, Record<string, unknown>]
    return em.find(ctor, where)
  })
  mockFindOneWithDecryption.mockImplementation(async (...args: unknown[]) => {
    const [, ctor, where, options] = args as [unknown, unknown, Record<string, unknown>, Record<string, unknown> | undefined]
    return em.findOne(ctor, where, options)
  })
  const assertCommitted = () => {
    if (transactionSnapshot) throw new Error('[internal] Side effects emitted before commit')
  }
  const dataEngine = { markOrmEntityChange: jest.fn(assertCommitted) }
  const eventBus = { emitEvent: jest.fn(async () => { assertCommitted() }) }
  const cache = {
    get: jest.fn(async () => null),
    set: jest.fn(async () => {}),
    deleteByTags: jest.fn(async () => { assertCommitted(); return 0 }),
  }
  const ctx: CommandRuntimeContext = {
    container: {
      resolve: (name: string): unknown => {
        if (name === 'em') return em
        if (name === 'dataEngine') return dataEngine
        if (name === 'eventBus') return eventBus
        if (name === 'cache') return cache
        throw new Error(`[internal] Unexpected DI token: ${name}`)
      },
    } as unknown as AwilixContainer,
    auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORGANIZATION_ID },
    selectedOrganizationId: ORGANIZATION_ID,
    organizationScope: null,
    organizationIds: null,
  }
  mockEmitCustomersEvent.mockImplementation(async () => { assertCommitted() })
  return {
    tags, customers, assignments, em, ctx, dataEngine, eventBus, cache,
    failAssignmentFlush: () => { assignmentFlushFails = true },
    clearEffects: () => {
      dataEngine.markOrmEntityChange.mockClear()
      eventBus.emitEvent.mockClear()
      cache.deleteByTags.mockClear()
      mockEmitCustomersEvent.mockClear()
    },
  }
}

type Store = ReturnType<typeof makeStore>

function deleteHandler(): DeleteHandler {
  const handler = commandRegistry.get('customers.tags.delete') as DeleteHandler | undefined
  if (!handler) throw new Error('[internal] Tag delete command is not registered')
  return handler
}

async function deleteTag(store: Store): Promise<PersistedLog> {
  const handler = deleteHandler()
  const input = { body: { id: TAG_ID } }
  let snapshots: { before?: unknown } = {}
  let executeCtx = store.ctx
  if (handler.prepareSnapshotInsideTransaction && handler.prepare) {
    const prepare = handler.prepare
    const originalBeforeWrite = store.ctx.beforeTransactionalWrite
    executeCtx = {
      ...store.ctx,
      beforeTransactionalWrite: async (em, writeInput) => {
        await originalBeforeWrite?.(em, writeInput)
        snapshots = await prepare(input, { ...executeCtx, transactionalEm: em }) ?? {}
      },
    }
  } else {
    snapshots = await handler.prepare?.(input, store.ctx) ?? {}
  }
  const result = await handler.execute(input, executeCtx)
  const log = await handler.buildLog?.({ input, result, snapshots, ctx: executeCtx })
  if (!log) throw new Error('[internal] Missing tag delete log')
  return JSON.parse(JSON.stringify({
    resourceId: log.resourceId,
    commandId: handler.id,
    resourceKind: log.resourceKind,
    contextJson: log.context,
    tenantId: log.tenantId,
    organizationId: log.organizationId,
    snapshotBefore: log.snapshotBefore,
    commandPayload: { ...log.payload, __redoInput: input },
  })) as PersistedLog
}

async function undoTag(store: Store, logEntry: CommandUndoLogEntry): Promise<void> {
  await deleteHandler().undo?.({ input: { body: { id: TAG_ID } }, ctx: store.ctx, logEntry })
}

describe('customers.tags.delete membership undo', () => {
  beforeAll(() => { process.env.ENABLE_CRUD_API_CACHE = 'true' })
  afterAll(() => {
    if (previousCrudCacheFlag === undefined) delete process.env.ENABLE_CRUD_API_CACHE
    else process.env.ENABLE_CRUD_API_CACHE = previousCrudCacheFlag
  })
  beforeEach(() => jest.clearAllMocks())

  it('restores multiple people and companies with the original assignment identities across redo and another undo', async () => {
    const store = makeStore()
    const secondPersonId = '66666666-6666-4666-8666-666666666666'
    const secondCompanyId = '77777777-7777-4777-8777-777777777777'
    for (const [id, kind] of [[secondPersonId, 'person'], [secondCompanyId, 'company']] as const) {
      store.customers.set(id, { id, kind, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, deletedAt: null })
      store.assignments.set(id, { id, entityId: id, tagId: TAG_ID, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, createdAt: CREATED_AT })
    }
    const originalAssignments = [...store.assignments.values()]
    const log = await deleteTag(store)
    expect(store.tags.has(TAG_ID)).toBe(false)
    expect(store.assignments.size).toBe(0)
    expect(log.commandPayload.undo.before.assignments).toHaveLength(4)
    expect(log.contextJson).toMatchObject({ cacheAliases: expect.arrayContaining(['customers.tagAssignment']) })
    store.clearEffects()
    await undoTag(store, log)
    expect(store.tags.get(TAG_ID)?.label).toBe('Important')
    expect([...store.assignments.values()]).toEqual(originalAssignments)
    expect(store.dataEngine.markOrmEntityChange).toHaveBeenCalledWith(expect.objectContaining({
      action: 'created', identifiers: expect.objectContaining({ id: TAG_ID }),
      indexer: expect.objectContaining({ entityType: 'customers:customer_tag' }),
    }))
    expect(mockEmitCustomersEvent).toHaveBeenCalledWith('customers.tag.assigned', expect.objectContaining({ tagId: TAG_ID, entityId: PERSON_ID }), { persistent: true })
    expect(store.cache.deleteByTags).toHaveBeenCalled()
    expect(store.eventBus.emitEvent).toHaveBeenCalledWith('query_index.upsert_one', expect.objectContaining({ entityType: 'customers:customer_entity', recordId: PERSON_ID }), expect.objectContaining({ tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }))
    const redoLog = await deleteTag(store)
    expect(store.tags.has(TAG_ID)).toBe(false)
    expect(store.assignments.size).toBe(0)
    await undoTag(store, redoLog)
    expect([...store.assignments.values()]).toEqual(originalAssignments)
  })

  it('locks the tag before snapshotting memberships added after an earlier preflight read', async () => {
    const store = makeStore()
    const handler = deleteHandler()
    const input = { body: { id: TAG_ID } }
    const preflight = await handler.prepare?.(input, store.ctx)
    expect((preflight?.before as TagSnapshot).assignments).toHaveLength(2)
    expect(handler.prepareSnapshotInsideTransaction).toBe(true)
    store.em.findOne.mockClear()
    mockFindWithDecryption.mockClear()
    const latePersonId = '66666666-6666-4666-8666-666666666666'
    const lateAssignment: AssignmentRow = {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', entityId: latePersonId,
      tagId: TAG_ID, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, createdAt: CREATED_AT,
    }
    store.ctx.beforeTransactionalWrite = jest.fn(async (em) => {
      expect(em).toBe(store.em)
      expect(store.em.isInTransaction()).toBe(true)
      expect(store.em.findOne).toHaveBeenCalledWith(CustomerTag, expect.objectContaining({ id: TAG_ID }), expect.objectContaining({ lockMode: LockMode.PESSIMISTIC_WRITE }))
      expect(mockFindWithDecryption).not.toHaveBeenCalled()
      expect(store.em.nativeDelete).not.toHaveBeenCalled()
      store.customers.set(latePersonId, { id: latePersonId, kind: 'person', tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, deletedAt: null })
      store.assignments.set(lateAssignment.id, lateAssignment)
    })
    const log = await deleteTag(store)
    expect(store.ctx.beforeTransactionalWrite).toHaveBeenCalledTimes(1)
    expect(log.commandPayload.undo.before.assignments).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: lateAssignment.id, entityId: latePersonId }),
    ]))
    expect(log.commandPayload.undo.before.assignments).toHaveLength(3)
    expect(mockFindWithDecryption.mock.invocationCallOrder[0]).toBeLessThan(store.em.nativeDelete.mock.invocationCallOrder[0])
    expect(store.assignments.size).toBe(0)
    await undoTag(store, log)
    expect(store.assignments.get(lateAssignment.id)).toEqual(lateAssignment)
    expect(store.assignments.size).toBe(3)
  })

  it.each(['tenantId', 'organizationId'] as const)('excludes foreign %s tags from both snapshot reads and locking queries', async (field) => {
    const store = makeStore()
    const foreignTag = store.tags.get(TAG_ID)!
    foreignTag[field] = field === 'tenantId' ? OTHER_TENANT_ID : OTHER_ORGANIZATION_ID
    const handler = deleteHandler()
    const input = { body: { id: TAG_ID } }
    const authorizedWhere = { id: TAG_ID, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }
    const authorizedScope = { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }
    expect(await handler.prepare?.(input, store.ctx)).toEqual({})
    expect(mockFindOneWithDecryption).toHaveBeenCalledWith(store.em, CustomerTag, authorizedWhere, {}, authorizedScope)
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
    mockFindOneWithDecryption.mockClear()
    await expect(handler.execute(input, store.ctx)).rejects.toMatchObject({ status: 404 })
    expect(mockFindOneWithDecryption).toHaveBeenCalledWith(store.em, CustomerTag, authorizedWhere, { lockMode: LockMode.PESSIMISTIC_WRITE }, authorizedScope)
    expect(store.em.nativeDelete).not.toHaveBeenCalled()
    expect(store.em.remove).not.toHaveBeenCalled()
    expect(store.tags.get(TAG_ID)).toEqual(foreignTag)
    expect(store.assignments.size).toBe(2)
    expect(store.dataEngine.markOrmEntityChange).not.toHaveBeenCalled()
  })

  it('allows every authorized organization while retaining the tenant predicate before reads and locks', async () => {
    const store = makeStore()
    store.ctx.selectedOrganizationId = OTHER_ORGANIZATION_ID
    store.ctx.organizationScope = {
      tenantId: TENANT_ID, selectedId: OTHER_ORGANIZATION_ID,
      allowedIds: [ORGANIZATION_ID, OTHER_ORGANIZATION_ID], filterIds: [OTHER_ORGANIZATION_ID],
    }
    const log = await deleteTag(store)
    const authorizedWhere = { id: TAG_ID, tenantId: TENANT_ID, organizationId: { $in: [ORGANIZATION_ID, OTHER_ORGANIZATION_ID] } }
    const authorizedScope = { tenantId: TENANT_ID, organizationId: null }
    expect(mockFindOneWithDecryption).toHaveBeenCalledWith(store.em, CustomerTag, authorizedWhere, { lockMode: LockMode.PESSIMISTIC_WRITE }, authorizedScope)
    expect(mockFindOneWithDecryption).toHaveBeenCalledWith(store.em, CustomerTag, authorizedWhere, {}, authorizedScope)
    expect(log.commandPayload.undo.before.assignments).toHaveLength(2)
  })

  it('keeps an explicitly unrestricted organization scope within its authorized tenant', async () => {
    const store = makeStore()
    store.ctx.selectedOrganizationId = OTHER_ORGANIZATION_ID
    store.ctx.organizationScope = {
      tenantId: TENANT_ID, selectedId: OTHER_ORGANIZATION_ID, allowedIds: null, filterIds: null,
    }
    await deleteTag(store)
    expect(mockFindOneWithDecryption).toHaveBeenCalledWith(store.em, CustomerTag, { id: TAG_ID, tenantId: TENANT_ID }, { lockMode: LockMode.PESSIMISTIC_WRITE }, { tenantId: TENANT_ID, organizationId: null })
  })

  it('does not widen an empty allowed-organization list to the selected organization', async () => {
    const store = makeStore()
    store.ctx.organizationScope = {
      tenantId: TENANT_ID, selectedId: ORGANIZATION_ID, allowedIds: [], filterIds: [],
    }
    const handler = deleteHandler()
    const input = { body: { id: TAG_ID } }
    expect(await handler.prepare?.(input, store.ctx)).toEqual({})
    await expect(handler.execute(input, store.ctx)).rejects.toMatchObject({ status: 404 })
    expect(mockFindOneWithDecryption).toHaveBeenCalledWith(store.em, CustomerTag, { id: TAG_ID, tenantId: TENANT_ID, organizationId: { $in: [] } }, { lockMode: LockMode.PESSIMISTIC_WRITE }, { tenantId: TENANT_ID, organizationId: null })
    expect(store.em.nativeDelete).not.toHaveBeenCalled()
  })

  it.each([TENANT_ID, null])('preserves superadmin organization access with tenant context %s', async (tenantId) => {
    const store = makeStore()
    store.ctx.auth = { sub: 'superadmin', tenantId, orgId: OTHER_ORGANIZATION_ID, isSuperAdmin: true }
    store.ctx.selectedOrganizationId = OTHER_ORGANIZATION_ID
    store.ctx.organizationScope = { tenantId, selectedId: OTHER_ORGANIZATION_ID, allowedIds: [], filterIds: [] }
    await deleteTag(store)
    expect(mockFindOneWithDecryption).toHaveBeenCalledWith(store.em, CustomerTag, { id: TAG_ID, ...(tenantId ? { tenantId } : {}) }, { lockMode: LockMode.PESSIMISTIC_WRITE }, { tenantId, organizationId: null })
  })

  it('uses the resolved tenant and organization for an auth-less system actor before selecting a tag', async () => {
    const store = makeStore()
    store.ctx.auth = null
    store.ctx.systemActor = true
    store.ctx.organizationScope = {
      tenantId: TENANT_ID, selectedId: ORGANIZATION_ID, allowedIds: [ORGANIZATION_ID], filterIds: [ORGANIZATION_ID],
    }
    store.tags.get(TAG_ID)!.tenantId = OTHER_TENANT_ID
    const handler = deleteHandler()
    const input = { body: { id: TAG_ID } }
    expect(await handler.prepare?.(input, store.ctx)).toEqual({})
    await expect(handler.execute(input, store.ctx)).rejects.toMatchObject({ status: 404 })
    expect(mockFindOneWithDecryption).toHaveBeenCalledWith(store.em, CustomerTag, { id: TAG_ID, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }, { lockMode: LockMode.PESSIMISTIC_WRITE }, { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID })
    expect(store.em.nativeDelete).not.toHaveBeenCalled()
  })

  it('preserves auth-less system execution without a resolved tenant or organization', async () => {
    const store = makeStore()
    store.ctx.auth = null
    store.ctx.systemActor = true
    store.ctx.selectedOrganizationId = null
    await deleteTag(store)
    expect(mockFindOneWithDecryption).toHaveBeenCalledWith(store.em, CustomerTag, { id: TAG_ID }, { lockMode: LockMode.PESSIMISTIC_WRITE }, { tenantId: null, organizationId: null })
  })

  it.each(['actor-tenant', 'organization-tenant'] as const)('rejects authenticated system actors with missing %s before any query', async (missingContext) => {
    const store = makeStore()
    store.ctx.systemActor = true
    if (missingContext === 'actor-tenant') store.ctx.auth!.tenantId = null
    else store.ctx.organizationScope = { tenantId: null, selectedId: ORGANIZATION_ID, allowedIds: [ORGANIZATION_ID], filterIds: [ORGANIZATION_ID] }
    const handler = deleteHandler()
    const input = { body: { id: TAG_ID } }
    await expect(handler.prepare?.(input, store.ctx)).rejects.toMatchObject({ status: 403 })
    await expect(handler.execute(input, store.ctx)).rejects.toMatchObject({ status: 403 })
    expect(store.em.findOne).not.toHaveBeenCalled()
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
    expect(store.em.nativeDelete).not.toHaveBeenCalled()
  })

  it.each(['missing', 'deleted', 'other-tenant', 'other-organization'] as const)('skips a %s customer while restoring valid memberships', async (state) => {
    const store = makeStore()
    const log = await deleteTag(store)
    const person = store.customers.get(PERSON_ID)!
    if (state === 'missing') store.customers.delete(PERSON_ID)
    if (state === 'deleted') person.deletedAt = new Date()
    if (state === 'other-tenant') person.tenantId = OTHER_TENANT_ID
    if (state === 'other-organization') person.organizationId = OTHER_ORGANIZATION_ID
    await undoTag(store, log)
    expect([...store.assignments.values()].map((row) => row.entityId)).toEqual([COMPANY_ID])
    expect(store.tags.has(TAG_ID)).toBe(true)
  })

  it.each(['tenantId', 'organizationId'] as const)('does not restore assignment snapshots with a foreign %s', async (field) => {
    const store = makeStore()
    const log = await deleteTag(store)
    const snapshots = log.commandPayload.undo.before.assignments!
    snapshots[0][field] = field === 'tenantId' ? OTHER_TENANT_ID : OTHER_ORGANIZATION_ID
    await undoTag(store, log)
    expect([...store.assignments.values()].map((row) => row.entityId)).toEqual([COMPANY_ID])
  })

  it('keeps legacy logs without assignment snapshots readable', async () => {
    const store = makeStore()
    const log = await deleteTag(store)
    delete log.commandPayload.undo.before.assignments
    await undoTag(store, log)
    expect(store.tags.get(TAG_ID)?.label).toBe('Important')
    expect(store.assignments.size).toBe(0)
  })

  it('does not duplicate existing memberships when undo is repeated', async () => {
    const store = makeStore()
    const log = await deleteTag(store)
    await undoTag(store, log)
    const firstRestore = [...store.assignments.values()]
    await undoTag(store, log)
    expect([...store.assignments.values()]).toEqual(firstRestore)
    expect(store.assignments.size).toBe(2)
  })

  it.each(['tenant', 'organization'] as const)('rejects undo from another %s before making changes', async (scope) => {
    const store = makeStore()
    const log = await deleteTag(store)
    store.clearEffects()
    if (scope === 'tenant') store.ctx.auth!.tenantId = OTHER_TENANT_ID
    else store.ctx.selectedOrganizationId = OTHER_ORGANIZATION_ID
    await expect(undoTag(store, log)).rejects.toMatchObject({ status: 403 })
    expect(store.tags.has(TAG_ID)).toBe(false)
    expect(store.assignments.size).toBe(0)
    expect(store.dataEngine.markOrmEntityChange).not.toHaveBeenCalled()
    expect(mockEmitCustomersEvent).not.toHaveBeenCalled()
  })

  it('does not overwrite a tag ID that belongs to another scope', async () => {
    const store = makeStore()
    const log = await deleteTag(store)
    const foreignTag: TagRow = { ...log.commandPayload.undo.before, organizationId: OTHER_ORGANIZATION_ID, label: 'Foreign tag' }
    store.tags.set(TAG_ID, foreignTag)
    await expect(undoTag(store, log)).rejects.toThrow('Duplicate tag id')
    expect(store.tags.get(TAG_ID)?.label).toBe('Foreign tag')
    expect(store.assignments.size).toBe(0)
  })

  it('rolls back the tag and every membership if assignment restoration fails, without publishing side effects', async () => {
    const store = makeStore()
    const log = await deleteTag(store)
    store.clearEffects()
    store.failAssignmentFlush()
    await expect(undoTag(store, log)).rejects.toThrow('Assignment insert failed')
    expect(store.tags.has(TAG_ID)).toBe(false)
    expect(store.assignments.size).toBe(0)
    expect(store.em.rollback).toHaveBeenCalledTimes(1)
    expect(store.dataEngine.markOrmEntityChange).not.toHaveBeenCalled()
    expect(store.eventBus.emitEvent).not.toHaveBeenCalled()
    expect(store.cache.deleteByTags).not.toHaveBeenCalled()
    expect(mockEmitCustomersEvent).not.toHaveBeenCalled()
  })
})
