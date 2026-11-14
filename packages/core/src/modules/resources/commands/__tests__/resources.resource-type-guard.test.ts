/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandRuntimeContext, CommandUndoLogEntry } from '@open-mercato/shared/lib/commands/types'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ResourcesResource, ResourcesResourceType } from '../../data/entities'
import { resourceTypeLockKey } from '../../lib/resourceTypeLock'

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
const TEST_TYPE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const OTHER_TYPE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const OTHER_ORG_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

const UNAVAILABLE_BODY = {
  error: 'The selected resource type is no longer available.',
  code: 'resources.resources.errors.resourceTypeUnavailable',
}
const DELETED_BODY = {
  error: 'This would put the resource on a deleted resource type. Restore the resource type first.',
  code: 'resources.resources.errors.resourceTypeDeleted',
}

function buildSnapshot(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  }
}

type EnvelopeOptions = {
  record?: Record<string, unknown> | null
  liveTypeIds?: string[]
  deletedTypeIds?: string[]
  otherOrgTypeIds?: string[]
}
type CountWhere = {
  id: string
  tenantId?: string
  organizationId?: string
  resourceTypeId?: string
  deletedAt: null | { $ne: null }
}

function buildEnvelope(options: EnvelopeOptions = {}) {
  const liveTypeIds = new Set(options.liveTypeIds ?? [])
  const deletedTypeIds = new Set(options.deletedTypeIds ?? [])
  const otherOrgTypeIds = new Set(options.otherOrgTypeIds ?? [])
  const calls: string[] = []
  let inTransaction = false
  const em = {
    begin: jest.fn().mockImplementation(async () => {
      inTransaction = true
    }),
    commit: jest.fn().mockImplementation(async () => {
      inTransaction = false
    }),
    rollback: jest.fn().mockImplementation(async () => {
      inTransaction = false
    }),
    isInTransaction: jest.fn(() => inTransaction),
    execute: jest.fn().mockImplementation(async (_sql: string, params: unknown[]) => {
      expect(inTransaction).toBe(true)
      calls.push(`lock:${String(params[0])}`)
      return []
    }),
    flush: jest.fn().mockResolvedValue(undefined),
    persist: jest.fn(),
    nativeDelete: jest.fn().mockResolvedValue(undefined),
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(options.record ?? null),
    count: jest.fn().mockImplementation(async (entity: unknown, where: CountWhere) => {
      calls.push(entity === ResourcesResource ? 'count:resource' : 'count:type')
      if (entity === ResourcesResource) {
        const record = options.record
        if (!record || record.id !== where.id || record.deletedAt) return 0
        return record.resourceTypeId === where.resourceTypeId ? 1 : 0
      }
      if (where.tenantId !== TEST_TENANT_ID) return 0
      if (otherOrgTypeIds.has(where.id)) return where.organizationId === OTHER_ORG_ID && where.deletedAt === null ? 1 : 0
      if (where.organizationId !== TEST_ORG_ID) return 0
      return (where.deletedAt === null ? liveTypeIds : deletedTypeIds).has(where.id) ? 1 : 0
    }),
    getReference: jest.fn((_entity: unknown, id: string) => ({ id })),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ id: TEST_RESOURCE_ID, ...data })),
  }
  const ctx = {
    container: {
      resolve: jest.fn().mockImplementation((name: string) => {
        if (name === 'em') return { fork: jest.fn().mockReturnValue(em) }
        return {}
      }),
    },
    auth: { tenantId: TEST_TENANT_ID, orgId: TEST_ORG_ID, isSuperAdmin: true, sub: 'user-1' },
    selectedOrganizationId: TEST_ORG_ID,
    organizationIds: [TEST_ORG_ID],
    request: {} as Request,
    organizationScope: null,
  } as unknown as CommandRuntimeContext
  return { em, ctx, calls }
}

function asLogEntry(commandPayload: unknown): CommandUndoLogEntry {
  return { commandPayload }
}

async function captureFailure(promise: Promise<unknown>): Promise<CrudHttpError> {
  const failure = await promise.then(() => null, (err: unknown) => err)
  expect(failure).toBeInstanceOf(CrudHttpError)
  return failure as CrudHttpError
}

describe('resources commands — resource type must be live', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../resources')
  })

  beforeEach(() => {
    ;(findOneWithDecryption as jest.Mock).mockReset().mockResolvedValue(null)
  })

  it('create rejects a resource type that is not live in the organization', async () => {
    const { em, ctx } = buildEnvelope()
    const handler = commandRegistry.get('resources.resources.create')

    const failure = await captureFailure(
      handler!.execute(
        { tenantId: TEST_TENANT_ID, organizationId: TEST_ORG_ID, name: 'Resource A', resourceTypeId: TEST_TYPE_ID },
        ctx,
      ),
    )

    expect(failure.status).toBe(400)
    expect(failure.body).toEqual(UNAVAILABLE_BODY)
    expect(em.count).toHaveBeenCalledWith(ResourcesResourceType, {
      id: TEST_TYPE_ID,
      tenantId: TEST_TENANT_ID,
      organizationId: TEST_ORG_ID,
      deletedAt: null,
    })
    expect(em.flush).not.toHaveBeenCalled()
    expect(em.rollback).toHaveBeenCalledTimes(1)
    expect(em.commit).not.toHaveBeenCalled()
  })

  it('create accepts a live resource type of the same organization', async () => {
    const { em, ctx } = buildEnvelope({ liveTypeIds: [TEST_TYPE_ID] })
    const handler = commandRegistry.get('resources.resources.create')

    await expect(
      handler!.execute(
        { tenantId: TEST_TENANT_ID, organizationId: TEST_ORG_ID, name: 'Resource A', resourceTypeId: TEST_TYPE_ID },
        ctx,
      ),
    ).resolves.toEqual({ resourceId: TEST_RESOURCE_ID })
    expect(em.commit).toHaveBeenCalledTimes(1)
  })

  it('update rejects switching to an unavailable resource type', async () => {
    const record = buildSnapshot({ resourceTypeId: null })
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(record)
    const { em, ctx } = buildEnvelope({ record })
    const handler = commandRegistry.get('resources.resources.update')

    const failure = await captureFailure(
      handler!.execute({ id: TEST_RESOURCE_ID, resourceTypeId: OTHER_TYPE_ID }, ctx),
    )

    expect(failure.status).toBe(400)
    expect(failure.body).toEqual(UNAVAILABLE_BODY)
    expect(record.resourceTypeId).toBeNull()
    expect(em.rollback).toHaveBeenCalledTimes(1)
    expect(em.commit).not.toHaveBeenCalled()
  })

  it('update accepts switching to a live resource type of the same organization', async () => {
    const record = buildSnapshot()
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(record)
    const { em, ctx } = buildEnvelope({ record, liveTypeIds: [OTHER_TYPE_ID] })
    const handler = commandRegistry.get('resources.resources.update')

    await expect(
      handler!.execute({ id: TEST_RESOURCE_ID, resourceTypeId: OTHER_TYPE_ID }, ctx),
    ).resolves.toEqual({ resourceId: TEST_RESOURCE_ID })
    expect(em.count).toHaveBeenCalledWith(ResourcesResourceType, {
      id: OTHER_TYPE_ID,
      tenantId: TEST_TENANT_ID,
      organizationId: TEST_ORG_ID,
      deletedAt: null,
    })
    expect(record.resourceTypeId).toBe(OTHER_TYPE_ID)
  })

  it('update keeps resources whose stored type is already deleted editable', async () => {
    const record = buildSnapshot()
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(record)
    const { em, ctx } = buildEnvelope({ record })
    const handler = commandRegistry.get('resources.resources.update')

    await expect(
      handler!.execute({ id: TEST_RESOURCE_ID, name: 'Renamed', resourceTypeId: TEST_TYPE_ID }, ctx),
    ).resolves.toEqual({ resourceId: TEST_RESOURCE_ID })
    expect(em.count).not.toHaveBeenCalled()
    expect(record.name).toBe('Renamed')
  })

  it('delete undo refuses to restore a resource whose type was deleted meanwhile', async () => {
    const record = buildSnapshot({ deletedAt: new Date() })
    const { em, ctx } = buildEnvelope({ record, deletedTypeIds: [TEST_TYPE_ID] })
    const handler = commandRegistry.get('resources.resources.delete')

    const failure = await captureFailure(
      handler!.undo!({ input: undefined, logEntry: asLogEntry({ undo: { before: buildSnapshot() } }), ctx }),
    )

    expect(failure.status).toBe(409)
    expect(failure.body).toEqual(DELETED_BODY)
    expect(record.deletedAt).toBeInstanceOf(Date)
    expect(em.rollback).toHaveBeenCalledTimes(1)
    expect(em.commit).not.toHaveBeenCalled()
  })

  it('delete undo restores the resource while its type is still live', async () => {
    const record = buildSnapshot({ deletedAt: new Date() })
    const { ctx } = buildEnvelope({ record, liveTypeIds: [TEST_TYPE_ID] })
    const handler = commandRegistry.get('resources.resources.delete')

    await handler!.undo!({ input: undefined, logEntry: asLogEntry({ undo: { before: buildSnapshot() } }), ctx })

    expect(record.deletedAt).toBeNull()
  })

  it.each([
    ['an unknown', { deletedTypeIds: [] as string[], otherOrgTypeIds: [] as string[] }],
    ['another organization\'s', { deletedTypeIds: [] as string[], otherOrgTypeIds: [TEST_TYPE_ID] }],
  ])('delete undo refuses to restore a resource onto %s resource type id', async (_label, typeState) => {
    const record = buildSnapshot({ deletedAt: new Date() })
    const { em, ctx } = buildEnvelope({ record, ...typeState })
    const handler = commandRegistry.get('resources.resources.delete')

    const failure = await captureFailure(
      handler!.undo!({ input: undefined, logEntry: asLogEntry({ undo: { before: buildSnapshot() } }), ctx }),
    )

    expect(failure.status).toBe(409)
    expect(failure.body).toEqual(UNAVAILABLE_BODY)
    expect(em.count).toHaveBeenCalledWith(ResourcesResourceType, {
      id: TEST_TYPE_ID,
      tenantId: TEST_TENANT_ID,
      organizationId: TEST_ORG_ID,
      deletedAt: null,
    })
    expect(em.count).not.toHaveBeenCalledWith(ResourcesResourceType, expect.objectContaining({ organizationId: OTHER_ORG_ID }))
    expect(record.deletedAt).toBeInstanceOf(Date)
    expect(em.rollback).toHaveBeenCalledTimes(1)
    expect(em.commit).not.toHaveBeenCalled()
  })

  it.each([
    ['an unknown', [] as string[]],
    ['another organization\'s', [TEST_TYPE_ID]],
  ])('update undo refuses to move a resource back onto %s resource type id', async (_label, otherOrgTypeIds) => {
    const record = buildSnapshot({ resourceTypeId: OTHER_TYPE_ID })
    const { em, ctx } = buildEnvelope({ record, liveTypeIds: [OTHER_TYPE_ID], otherOrgTypeIds })
    const handler = commandRegistry.get('resources.resources.update')
    const logEntry = asLogEntry({
      undo: { before: buildSnapshot(), after: buildSnapshot({ resourceTypeId: OTHER_TYPE_ID }) },
    })

    const failure = await captureFailure(handler!.undo!({ input: undefined, logEntry, ctx }))

    expect(failure.status).toBe(409)
    expect(failure.body).toEqual(UNAVAILABLE_BODY)
    expect(record.resourceTypeId).toBe(OTHER_TYPE_ID)
    expect(em.rollback).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['an unknown', [] as string[]],
    ['another organization\'s', [TEST_TYPE_ID]],
  ])('create redo refuses to re-create a resource on %s resource type id', async (_label, otherOrgTypeIds) => {
    const record = buildSnapshot({ deletedAt: new Date() })
    const { em, ctx } = buildEnvelope({ record, otherOrgTypeIds })
    const handler = commandRegistry.get('resources.resources.create')

    const failure = await captureFailure(
      handler!.redo!({ input: undefined, logEntry: asLogEntry({ undo: { after: buildSnapshot() } }), ctx }),
    )

    expect(failure.status).toBe(409)
    expect(failure.body).toEqual(UNAVAILABLE_BODY)
    expect(record.deletedAt).toBeInstanceOf(Date)
    expect(em.rollback).toHaveBeenCalledTimes(1)
  })

  it('takes the resource type lock inside the transaction before any check', async () => {
    const record = buildSnapshot({ deletedAt: new Date() })
    const { em, ctx, calls } = buildEnvelope({ record, liveTypeIds: [TEST_TYPE_ID] })
    const handler = commandRegistry.get('resources.resources.delete')

    await handler!.undo!({ input: undefined, logEntry: asLogEntry({ undo: { before: buildSnapshot() } }), ctx })

    expect(calls).toEqual([`lock:${resourceTypeLockKey(TEST_TYPE_ID)}`, 'count:resource', 'count:type'])
    expect(em.begin.mock.invocationCallOrder[0]).toBeLessThan(em.execute.mock.invocationCallOrder[0])
    expect(em.execute.mock.invocationCallOrder[0]).toBeLessThan(em.commit.mock.invocationCallOrder[0])
  })

  it('update undo refuses to move a resource back to a deleted type', async () => {
    const record = buildSnapshot({ resourceTypeId: OTHER_TYPE_ID })
    const { em, ctx } = buildEnvelope({ record, liveTypeIds: [OTHER_TYPE_ID], deletedTypeIds: [TEST_TYPE_ID] })
    const handler = commandRegistry.get('resources.resources.update')
    const logEntry = asLogEntry({
      undo: { before: buildSnapshot(), after: buildSnapshot({ resourceTypeId: OTHER_TYPE_ID }) },
    })

    const failure = await captureFailure(handler!.undo!({ input: undefined, logEntry, ctx }))

    expect(failure.status).toBe(409)
    expect(failure.body).toEqual(DELETED_BODY)
    expect(record.resourceTypeId).toBe(OTHER_TYPE_ID)
    expect(em.rollback).toHaveBeenCalledTimes(1)
    expect(em.commit).not.toHaveBeenCalled()
  })

  it('update undo moves a resource back to its previous type while that type is live', async () => {
    const record = buildSnapshot({ resourceTypeId: OTHER_TYPE_ID })
    const { em, ctx } = buildEnvelope({ record, liveTypeIds: [TEST_TYPE_ID, OTHER_TYPE_ID] })
    const handler = commandRegistry.get('resources.resources.update')
    const logEntry = asLogEntry({
      undo: { before: buildSnapshot(), after: buildSnapshot({ resourceTypeId: OTHER_TYPE_ID }) },
    })

    await handler!.undo!({ input: undefined, logEntry, ctx })

    expect(em.count).toHaveBeenCalledWith(ResourcesResourceType, {
      id: TEST_TYPE_ID,
      tenantId: TEST_TENANT_ID,
      organizationId: TEST_ORG_ID,
      deletedAt: null,
    })
    expect(record.resourceTypeId).toBe(TEST_TYPE_ID)
  })

  it('update undo refuses to bring a deleted resource back onto its deleted type', async () => {
    const record = buildSnapshot({ deletedAt: new Date() })
    const { em, ctx } = buildEnvelope({ record, deletedTypeIds: [TEST_TYPE_ID] })
    const handler = commandRegistry.get('resources.resources.update')
    const logEntry = asLogEntry({ undo: { before: buildSnapshot(), after: buildSnapshot({ name: 'Renamed' }) } })

    const failure = await captureFailure(handler!.undo!({ input: undefined, logEntry, ctx }))

    expect(failure.status).toBe(409)
    expect(failure.body).toEqual(DELETED_BODY)
    expect(record.deletedAt).toBeInstanceOf(Date)
    expect(em.rollback).toHaveBeenCalledTimes(1)
    expect(em.commit).not.toHaveBeenCalled()
  })

  it('update undo keeps a live resource on its unchanged type without checking the type', async () => {
    const record = buildSnapshot({ name: 'Renamed' })
    const { ctx, calls } = buildEnvelope({ record })
    const handler = commandRegistry.get('resources.resources.update')
    const logEntry = asLogEntry({ undo: { before: buildSnapshot(), after: buildSnapshot({ name: 'Renamed' }) } })

    await handler!.undo!({ input: undefined, logEntry, ctx })

    expect(calls).toEqual([`lock:${resourceTypeLockKey(TEST_TYPE_ID)}`, 'count:resource'])
    expect(record.name).toBe('Resource A')
  })

  it('create redo refuses to re-create a resource whose type was deleted meanwhile', async () => {
    const record = buildSnapshot({ deletedAt: new Date() })
    const { em, ctx } = buildEnvelope({ record, deletedTypeIds: [TEST_TYPE_ID] })
    const handler = commandRegistry.get('resources.resources.create')

    const failure = await captureFailure(
      handler!.redo!({ input: undefined, logEntry: asLogEntry({ undo: { after: buildSnapshot() } }), ctx }),
    )

    expect(failure.status).toBe(409)
    expect(failure.body).toEqual(DELETED_BODY)
    expect(record.deletedAt).toBeInstanceOf(Date)
    expect(em.rollback).toHaveBeenCalledTimes(1)
    expect(em.commit).not.toHaveBeenCalled()
  })

  it('create redo re-creates the resource while its type is live', async () => {
    const record = buildSnapshot({ deletedAt: new Date() })
    const { em, ctx } = buildEnvelope({ record, liveTypeIds: [TEST_TYPE_ID] })
    const handler = commandRegistry.get('resources.resources.create')

    await handler!.redo!({ input: undefined, logEntry: asLogEntry({ undo: { after: buildSnapshot() } }), ctx })

    expect(em.count).toHaveBeenCalledWith(ResourcesResourceType, {
      id: TEST_TYPE_ID,
      tenantId: TEST_TENANT_ID,
      organizationId: TEST_ORG_ID,
      deletedAt: null,
    })
    expect(record.deletedAt).toBeNull()
  })
})
