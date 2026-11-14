/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ResourcesResource, ResourcesResourceType } from '../../data/entities'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
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
const TEST_TYPE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

type Row = Record<string, unknown> & { id: string; deletedAt: Date | null }
type Where = Record<string, unknown>

type Deferred = { promise: Promise<void>; resolve: () => void }

function deferred(): Deferred {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function settle(): Promise<void> {
  return new Promise((done) => setImmediate(done))
}

function matches(row: Row, where: Where): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key]
    if (expected && typeof expected === 'object' && '$ne' in expected) return actual !== (expected as { $ne: unknown }).$ne
    return actual === expected
  })
}

function buildDatabase(options: { resourceDeleted: boolean; typeDeleted?: boolean }) {
  const types = new Map<string, Row>([[TEST_TYPE_ID, {
    id: TEST_TYPE_ID,
    tenantId: TEST_TENANT_ID,
    organizationId: TEST_ORG_ID,
    name: 'Type A',
    deletedAt: options.typeDeleted ? new Date('2026-01-01T00:00:00.000Z') : null,
  }]])
  const resources = new Map<string, Row>()
  if (options.resourceDeleted) {
    resources.set(TEST_RESOURCE_ID, {
      id: TEST_RESOURCE_ID,
      tenantId: TEST_TENANT_ID,
      organizationId: TEST_ORG_ID,
      name: 'Resource A',
      resourceTypeId: TEST_TYPE_ID,
      deletedAt: new Date('2026-01-01T00:00:00.000Z'),
    })
  }
  const lockTails = new Map<string, Promise<void>>()

  async function acquire(key: string): Promise<() => void> {
    const previous = lockTails.get(key) ?? Promise.resolve()
    const release = deferred()
    lockTails.set(key, previous.then(() => release.promise))
    await previous
    return release.resolve
  }

  function table(entity: unknown): Map<string, Row> {
    return entity === ResourcesResourceType ? types : resources
  }

  function contender() {
    const loaded = new Map<Row, { entity: unknown; committed: Row | undefined }>()
    const held: Array<() => void> = []
    const locked = deferred()
    const loadedOnce = deferred()
    let afterFirstLoad: Promise<void> | null = null
    let beforeCommit: Promise<void> = Promise.resolve()
    let inTransaction = false

    function load(entity: unknown, where: Where): Row | null {
      const committed = [...table(entity).values()].find((row) => matches(row, where))
      if (!committed) return null
      const copy = { ...committed }
      loaded.set(copy, { entity, committed })
      return copy
    }

    function applyLoaded() {
      for (const [row, source] of loaded) {
        if (source.committed) Object.assign(source.committed, row)
        else if (em.persist.mock.calls.some(([persisted]) => persisted === row)) table(source.entity).set(row.id, { ...row })
      }
    }

    function releaseAll() {
      inTransaction = false
      while (held.length) held.pop()!()
    }

    const em = {
      fork: () => em,
      begin: jest.fn(async () => {
        inTransaction = true
      }),
      isInTransaction: () => inTransaction,
      execute: jest.fn(async (_sql: string, params: unknown[]) => {
        held.push(await acquire(String(params[0])))
        locked.resolve()
        return []
      }),
      count: jest.fn(async (entity: unknown, where: Where) =>
        [...table(entity).values()].filter((row) => matches(row, where)).length),
      findOne: jest.fn(async (entity: unknown, where: Where) => {
        const row = load(entity, where)
        const gate = afterFirstLoad
        afterFirstLoad = null
        loadedOnce.resolve()
        if (gate) await gate
        return row
      }),
      find: jest.fn(async () => []),
      nativeDelete: jest.fn(async () => 0),
      getReference: jest.fn((_entity: unknown, id: string) => ({ id })),
      create: jest.fn((entity: unknown, data: Record<string, unknown>) => {
        const row = { id: TEST_RESOURCE_ID, deletedAt: null, ...data } as Row
        loaded.set(row, { entity, committed: undefined })
        return row
      }),
      persist: jest.fn(),
      flush: jest.fn(async () => {
        if (!inTransaction) applyLoaded()
      }),
      commit: jest.fn(async () => {
        await beforeCommit
        applyLoaded()
        releaseAll()
      }),
      rollback: jest.fn(async () => {
        releaseAll()
      }),
    }
    const ctx = {
      container: {
        resolve: jest.fn((name: string) => (name === 'em' ? em : {})),
      },
      auth: { tenantId: TEST_TENANT_ID, orgId: TEST_ORG_ID, isSuperAdmin: true, sub: 'user-1' },
      selectedOrganizationId: TEST_ORG_ID,
      organizationIds: [TEST_ORG_ID],
      request: {} as Request,
      organizationScope: null,
    } as unknown as CommandRuntimeContext
    return {
      em,
      ctx,
      load,
      locked: locked.promise,
      loaded: loadedOnce.promise,
      holdCommitUntil(gate: Promise<void>) {
        beforeCommit = gate
      },
      pauseAfterFirstLoad(gate: Promise<void>) {
        afterFirstLoad = gate
      },
    }
  }

  return { types, resources, contender }
}

type Contender = ReturnType<ReturnType<typeof buildDatabase>['contender']>

function deleteType(contender: Contender) {
  ;(findOneWithDecryption as jest.Mock).mockImplementationOnce(
    async (_em: unknown, entity: unknown, where: Where) => contender.load(entity, where),
  )
  return commandRegistry.get('resources.resourceTypes.delete')!.execute({ id: TEST_TYPE_ID }, contender.ctx)
}

function createResource(contender: Contender) {
  return commandRegistry.get('resources.resources.create')!.execute(
    { tenantId: TEST_TENANT_ID, organizationId: TEST_ORG_ID, name: 'Resource A', resourceTypeId: TEST_TYPE_ID },
    contender.ctx,
  )
}

function typeSnapshot() {
  return {
    id: TEST_TYPE_ID,
    tenantId: TEST_TENANT_ID,
    organizationId: TEST_ORG_ID,
    name: 'Type A',
    description: null,
    appearanceIcon: null,
    appearanceColor: null,
    deletedAt: null,
  }
}

function undoTypeCreate(contender: Contender) {
  return commandRegistry.get('resources.resourceTypes.create')!.undo!({
    input: undefined,
    logEntry: { commandPayload: { undo: { after: typeSnapshot(), customAfter: null } } },
    ctx: contender.ctx,
  })
}

function undoTypeDelete(contender: Contender) {
  return commandRegistry.get('resources.resourceTypes.delete')!.undo!({
    input: undefined,
    logEntry: { commandPayload: { undo: { before: typeSnapshot(), customBefore: null } } },
    ctx: contender.ctx,
  })
}

function undoResourceDelete(contender: Contender) {
  const before = {
    id: TEST_RESOURCE_ID,
    tenantId: TEST_TENANT_ID,
    organizationId: TEST_ORG_ID,
    name: 'Resource A',
    description: null,
    resourceTypeId: TEST_TYPE_ID,
    capacity: null,
    capacityUnitValue: null,
    capacityUnitName: null,
    capacityUnitColor: null,
    capacityUnitIcon: null,
    appearanceIcon: null,
    appearanceColor: null,
    isActive: true,
    availabilityRuleSetId: null,
    customFieldsetCode: null,
    tags: [] as string[],
    deletedAt: null,
  }
  return commandRegistry.get('resources.resources.delete')!.undo!({
    input: undefined,
    logEntry: { commandPayload: { undo: { before } } },
    ctx: contender.ctx,
  })
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  const failure = await promise.then(() => null, (err: unknown) => err)
  expect(failure).toBeInstanceOf(CrudHttpError)
  return ((failure as CrudHttpError).body as { code?: string }).code
}

function liveResourcesOnType(resources: Map<string, Row>): number {
  return [...resources.values()].filter((row) => row.resourceTypeId === TEST_TYPE_ID && row.deletedAt === null).length
}

describe('resource type lock — two contenders', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../resource-types')
    await import('../resources')
  })

  it('a resource create that arrives while the type delete holds the lock waits and is refused', async () => {
    const db = buildDatabase({ resourceDeleted: false })
    const deleter = db.contender()
    const creator = db.contender()
    const releaseDelete = deferred()
    deleter.holdCommitUntil(releaseDelete.promise)

    const deleting = deleteType(deleter)
    await deleter.locked
    const creating = createResource(creator)
    await settle()

    expect(creator.em.execute).toHaveBeenCalledTimes(1)
    expect(creator.em.count).not.toHaveBeenCalled()

    releaseDelete.resolve()
    await expect(deleting).resolves.toEqual({ resourceTypeId: TEST_TYPE_ID })
    await expect(codeOf(creating)).resolves.toBe('resources.resources.errors.resourceTypeUnavailable')
    expect(db.types.get(TEST_TYPE_ID)!.deletedAt).toBeInstanceOf(Date)
    expect(db.resources.size).toBe(0)
  })

  it('a type delete that arrives while a resource create holds the lock waits and is refused', async () => {
    const db = buildDatabase({ resourceDeleted: false })
    const creator = db.contender()
    const deleter = db.contender()
    const releaseCreate = deferred()
    creator.holdCommitUntil(releaseCreate.promise)

    const creating = createResource(creator)
    await creator.locked
    const deleting = deleteType(deleter)
    await settle()

    expect(deleter.em.execute).toHaveBeenCalledTimes(1)
    expect(deleter.em.count).not.toHaveBeenCalled()

    releaseCreate.resolve()
    await expect(creating).resolves.toEqual({ resourceId: TEST_RESOURCE_ID })
    await expect(codeOf(deleting)).resolves.toBe('resources.resourceTypes.errors.deleteAssigned')
    expect(db.types.get(TEST_TYPE_ID)!.deletedAt).toBeNull()
    expect(liveResourcesOnType(db.resources)).toBe(1)
  })

  it('a resource delete undo that arrives while the type delete holds the lock waits and is refused', async () => {
    const db = buildDatabase({ resourceDeleted: true })
    const deleter = db.contender()
    const restorer = db.contender()
    const releaseDelete = deferred()
    deleter.holdCommitUntil(releaseDelete.promise)

    const deleting = deleteType(deleter)
    await deleter.locked
    const restoring = undoResourceDelete(restorer)
    await settle()

    expect(restorer.em.execute).toHaveBeenCalledTimes(1)
    expect(restorer.em.count).not.toHaveBeenCalled()

    releaseDelete.resolve()
    await expect(deleting).resolves.toEqual({ resourceTypeId: TEST_TYPE_ID })
    await expect(codeOf(restoring)).resolves.toBe('resources.resources.errors.resourceTypeDeleted')
    expect(db.types.get(TEST_TYPE_ID)!.deletedAt).toBeInstanceOf(Date)
    expect(liveResourcesOnType(db.resources)).toBe(0)
  })

  it('a type create undo that loaded an already-deleted type re-checks it under the lock after a restore and a resource create', async () => {
    const db = buildDatabase({ resourceDeleted: false, typeDeleted: true })
    const undoer = db.contender()
    const restorer = db.contender()
    const creator = db.contender()
    const resumeUndo = deferred()
    undoer.pauseAfterFirstLoad(resumeUndo.promise)

    const undoing = undoTypeCreate(undoer)
    await undoer.loaded
    await undoTypeDelete(restorer)
    expect(db.types.get(TEST_TYPE_ID)!.deletedAt).toBeNull()
    await expect(createResource(creator)).resolves.toEqual({ resourceId: TEST_RESOURCE_ID })

    resumeUndo.resolve()
    await expect(codeOf(undoing)).resolves.toBe('resources.resourceTypes.errors.deleteAssigned')
    expect(undoer.em.execute).toHaveBeenCalledTimes(1)
    expect(db.types.get(TEST_TYPE_ID)!.deletedAt).toBeNull()
    expect(liveResourcesOnType(db.resources)).toBe(1)
  })
})
