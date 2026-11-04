/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
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
const TEST_TYPE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const ASSIGNED_BODY = {
  error: 'Resource type has assigned resources.',
  code: 'resources.resourceTypes.errors.deleteAssigned',
}

function buildTypeSnapshot() {
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

function buildEnvelope(assignedCount: number) {
  const record: Record<string, unknown> = { ...buildTypeSnapshot(), deletedAt: null }
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
    fork: jest.fn(),
    findOne: jest.fn().mockResolvedValue(record),
    count: jest.fn().mockImplementation(async (entity: unknown) => {
      if (entity === ResourcesResourceType) {
        calls.push('count:live')
        return record.deletedAt ? 0 : 1
      }
      calls.push('count:assigned')
      return assignedCount
    }),
    flush: jest.fn().mockResolvedValue(undefined),
  }
  em.fork.mockReturnValue(em)
  const ctx = {
    container: {
      resolve: jest.fn().mockImplementation((name: string) => (name === 'em' ? em : {})),
    },
    auth: { tenantId: TEST_TENANT_ID, orgId: TEST_ORG_ID, isSuperAdmin: true, sub: 'user-1' },
    selectedOrganizationId: TEST_ORG_ID,
    organizationIds: [TEST_ORG_ID],
    request: {} as Request,
    organizationScope: null,
  } as unknown as CommandRuntimeContext
  return { em, ctx, record, calls }
}

function createLogEntry() {
  return { commandPayload: { undo: { after: buildTypeSnapshot(), customAfter: null } } }
}

describe('resource type "has assigned resources" guard', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../resource-types')
  })

  beforeEach(() => {
    ;(findOneWithDecryption as jest.Mock).mockReset().mockResolvedValue(null)
    ;(emitCrudUndoSideEffects as jest.Mock).mockClear()
  })

  it('refuses to undo a resource type create while live resources are assigned to it', async () => {
    const { em, ctx, record, calls } = buildEnvelope(3)
    const handler = commandRegistry.get('resources.resourceTypes.create')

    const failure = await handler!.undo!({ input: undefined, logEntry: createLogEntry(), ctx }).catch((err: unknown) => err)

    expect(failure).toBeInstanceOf(CrudHttpError)
    expect((failure as CrudHttpError).status).toBe(409)
    expect((failure as CrudHttpError).body).toEqual(ASSIGNED_BODY)
    expect(em.count).toHaveBeenCalledWith(ResourcesResource, {
      resourceTypeId: TEST_TYPE_ID,
      deletedAt: null,
      tenantId: TEST_TENANT_ID,
      organizationId: TEST_ORG_ID,
    })
    expect(record.deletedAt).toBeNull()
    expect(em.flush).not.toHaveBeenCalled()
    expect(calls).toEqual([`lock:${resourceTypeLockKey(TEST_TYPE_ID)}`, 'count:live', 'count:assigned'])
    expect(em.rollback).toHaveBeenCalledTimes(1)
    expect(em.commit).not.toHaveBeenCalled()
  })

  it('still soft-deletes the resource type on undo when no live resource references it', async () => {
    const { em, ctx, record } = buildEnvelope(0)
    const handler = commandRegistry.get('resources.resourceTypes.create')

    await handler!.undo!({ input: undefined, logEntry: createLogEntry(), ctx })

    expect(record.deletedAt).toBeInstanceOf(Date)
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(emitCrudUndoSideEffects).toHaveBeenCalledTimes(1)
  })

  it('takes the lock and leaves an already-deleted resource type untouched on undo', async () => {
    const { em, ctx, record, calls } = buildEnvelope(1)
    const deletedAt = new Date('2026-01-01T00:00:00.000Z')
    record.deletedAt = deletedAt
    const handler = commandRegistry.get('resources.resourceTypes.create')

    await handler!.undo!({ input: undefined, logEntry: createLogEntry(), ctx })

    expect(calls).toEqual([`lock:${resourceTypeLockKey(TEST_TYPE_ID)}`, 'count:live'])
    expect(record.deletedAt).toBe(deletedAt)
    expect(em.commit).toHaveBeenCalledTimes(1)
    expect(emitCrudUndoSideEffects).not.toHaveBeenCalled()
  })

  it('keeps refusing a direct delete of a resource type with assigned resources', async () => {
    const { em, ctx, record, calls } = buildEnvelope(2)
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(record)
    const handler = commandRegistry.get('resources.resourceTypes.delete')

    const failure = await handler!.execute({ id: TEST_TYPE_ID }, ctx).catch((err: unknown) => err)

    expect(failure).toBeInstanceOf(CrudHttpError)
    expect((failure as CrudHttpError).status).toBe(400)
    expect((failure as CrudHttpError).body).toEqual(ASSIGNED_BODY)
    expect(record.deletedAt).toBeNull()
    expect(em.flush).not.toHaveBeenCalled()
    expect(calls).toEqual([`lock:${resourceTypeLockKey(TEST_TYPE_ID)}`, 'count:assigned'])
    expect(em.rollback).toHaveBeenCalledTimes(1)
    expect(em.commit).not.toHaveBeenCalled()
  })
})
