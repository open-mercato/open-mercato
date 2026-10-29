jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string, params?: Record<string, unknown>) => {
      const template = fallback ?? _key
      if (!params) return template
      return template.replace(/\{\{(\w+)\}\}|\{(\w+)\}/g, (match, doubleKey, singleKey) => {
        const key = doubleKey ?? singleKey
        if (!key) return match
        const value = params[key]
        return value === undefined ? match : String(value)
      })
    },
  }),
}))

const mockFindWithDecryption = jest.fn(async () => [])
const mockFindOneWithDecryption = jest.fn(async () => null)

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args as []),
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args as []),
}))

import '@open-mercato/core/modules/customers/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { LockMode } from '@mikro-orm/core'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  CustomerDealPersonLink,
  CustomerEntity,
  CustomerLabelAssignment,
} from '../../data/entities'

const ORG_ID = 'org-p-1'
const TENANT_ID = 'tenant-p-1'
const PERSON_ID = 'person-1'

function makePersonEntity(): CustomerEntity {
  return {
    id: PERSON_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    kind: 'person',
    displayName: 'Jane Doe',
    description: null,
    ownerUserId: null,
    primaryEmail: null,
    primaryPhone: null,
    status: null,
    lifecycleStage: null,
    source: null,
    nextInteractionAt: null,
    nextInteractionName: null,
    nextInteractionRefId: null,
    nextInteractionIcon: null,
    nextInteractionColor: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  } as unknown as CustomerEntity
}

type OperationLog = Array<{ op: 'findOne' | 'count'; entity: unknown; options?: unknown }>

function makeEm(entity: CustomerEntity, dealLinks: number, opLog: OperationLog = []) {
  const em: any = {
    fork: jest.fn(),
    findOne: jest.fn(async (ctor: any, _where: any, options?: any) => {
      opLog.push({ op: 'findOne', entity: ctor, options })
      if (ctor === CustomerEntity) return entity
      return null
    }),
    find: jest.fn(async () => []),
    count: jest.fn(async (ctor: any) => {
      opLog.push({ op: 'count', entity: ctor })
      return ctor === CustomerDealPersonLink ? dealLinks : 0
    }),
    nativeDelete: jest.fn(async () => undefined),
    remove: jest.fn().mockReturnValue(undefined),
    flush: jest.fn().mockResolvedValue(undefined),
    begin: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    persist: jest.fn(),
    getReference: jest.fn((_ctor: any, id: string) => ({ id })),
  }
  em.fork.mockReturnValue(em)
  return em as jest.Mocked<Pick<EntityManager, 'fork' | 'findOne' | 'find' | 'count' | 'nativeDelete' | 'remove' | 'flush' | 'begin' | 'commit' | 'rollback'>>
}

function makeCtx(em: any): CommandRuntimeContext {
  const dataEngine: any = {
    setCustomFields: jest.fn(async () => {}),
    emitOrmEntityEvent: jest.fn(async () => {}),
    markOrmEntityChange: jest.fn(),
    flushOrmEntityChanges: jest.fn(async () => {}),
  }
  return {
    container: {
      resolve: (token: string): any => {
        if (token === 'em') return em
        if (token === 'dataEngine') return dataEngine
        throw new Error(`Unexpected DI token: ${token}`)
      },
    } as any,
    auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID } as any,
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: null,
    request: undefined as any,
  }
}

describe('customers.people.delete — dependent guard', () => {
  afterEach(() => {
    jest.clearAllMocks()
    mockFindWithDecryption.mockImplementation(async () => [])
  })

  it('throws 422 with PERSON_HAS_DEPENDENTS when the person is referenced by deals', async () => {
    const entity = makePersonEntity()
    const em = makeEm(entity, 3)
    const ctx = makeCtx(em)
    const handler = commandRegistry.get('customers.people.delete') as CommandHandler
    expect(handler).toBeDefined()

    let captured: unknown
    try {
      await handler.execute({ body: { id: PERSON_ID } }, ctx)
    } catch (err) {
      captured = err
    }

    expect(captured).toBeInstanceOf(CrudHttpError)
    const httpError = captured as CrudHttpError
    expect(httpError.status).toBe(422)
    const body = httpError.body as { error: string; code: string }
    expect(body.code).toBe('PERSON_HAS_DEPENDENTS')
    expect(body.error).toContain('linked deals')
    expect(body.error).toContain('3')
    expect(em.remove).not.toHaveBeenCalled()
    expect(em.nativeDelete).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('proceeds past the guard when there are no deal links', async () => {
    const entity = makePersonEntity()
    const em = makeEm(entity, 0)
    const ctx = makeCtx(em)
    const handler = commandRegistry.get('customers.people.delete') as CommandHandler

    let captured: unknown
    try {
      await handler.execute({ body: { id: PERSON_ID } }, ctx)
    } catch (err) {
      captured = err
    }

    if (captured instanceof CrudHttpError) {
      expect(captured.body).not.toMatchObject({ code: 'PERSON_HAS_DEPENDENTS' })
    }
    expect(em.count).toHaveBeenCalledWith(CustomerDealPersonLink, { person: entity })
  })

  it('removes the person\'s label assignments with the person and returns them for undo', async () => {
    const entity = makePersonEntity()
    const em = makeEm(entity, 0)
    const ctx = makeCtx(em)
    const handler = commandRegistry.get('customers.people.delete') as CommandHandler
    const createdAt = new Date('2026-01-01T00:00:00.000Z')
    mockFindWithDecryption.mockImplementation((async (_em: unknown, ctor: unknown) =>
      ctor === CustomerLabelAssignment
        ? [{ id: 'la-1', label: { id: 'label-1' }, userId: 'user-2', createdAt }]
        : []) as unknown as () => Promise<never[]>)

    const result = await handler.execute({ body: { id: PERSON_ID } }, ctx)

    expect(em.nativeDelete).toHaveBeenCalledWith(CustomerLabelAssignment, {
      id: { $in: ['la-1'] },
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
    })
    expect(result).toEqual({
      entityId: PERSON_ID,
      labelAssignments: [{ id: 'la-1', labelId: 'label-1', userId: 'user-2', createdAt }],
    })
  })
})

describe('customers.people.delete — row lock (issue #7613)', () => {
  afterEach(() => jest.clearAllMocks())

  it('locks the entity row with PESSIMISTIC_WRITE before any dependent check or child cleanup', async () => {
    const entity = makePersonEntity()
    const opLog: OperationLog = []
    const em = makeEm(entity, 0, opLog)
    const ctx = makeCtx(em)
    const handler = commandRegistry.get('customers.people.delete') as CommandHandler

    await handler.execute({ body: { id: PERSON_ID } }, ctx)

    // The transaction must open before any row is touched, so a concurrent
    // insert of a child row (e.g. a label assignment) blocks on the lock
    // instead of racing the final delete with a 409 FOREIGN_KEY_VIOLATION.
    expect(em.begin).toHaveBeenCalledTimes(1)
    const lockIndex = opLog.findIndex((entry) =>
      entry.op === 'findOne' && entry.entity === CustomerEntity
      && (entry.options as { lockMode?: LockMode } | undefined)?.lockMode === LockMode.PESSIMISTIC_WRITE)
    expect(lockIndex).toBeGreaterThanOrEqual(0)
    // The dependent-links count (and every later child read/cleanup) happens
    // strictly after the lock is acquired.
    const dealLinksIndex = opLog.findIndex((entry) => entry.op === 'count' && entry.entity === CustomerDealPersonLink)
    expect(dealLinksIndex).toBeGreaterThan(lockIndex)
    expect(em.commit).toHaveBeenCalledTimes(1)
    expect(em.rollback).not.toHaveBeenCalled()
  })

  it('rolls back without deleting anything when a concurrent deal link already exists under the lock', async () => {
    const entity = makePersonEntity()
    const opLog: OperationLog = []
    const em = makeEm(entity, 1, opLog)
    const ctx = makeCtx(em)
    const handler = commandRegistry.get('customers.people.delete') as CommandHandler

    await expect(handler.execute({ body: { id: PERSON_ID } }, ctx)).rejects.toBeInstanceOf(CrudHttpError)

    const lockIndex = opLog.findIndex((entry) =>
      entry.op === 'findOne' && entry.entity === CustomerEntity
      && (entry.options as { lockMode?: LockMode } | undefined)?.lockMode === LockMode.PESSIMISTIC_WRITE)
    expect(lockIndex).toBeGreaterThanOrEqual(0)
    const dealLinksIndex = opLog.findIndex((entry) => entry.op === 'count' && entry.entity === CustomerDealPersonLink)
    expect(dealLinksIndex).toBeGreaterThan(lockIndex)
    expect(em.remove).not.toHaveBeenCalled()
    expect(em.nativeDelete).not.toHaveBeenCalled()
    expect(em.commit).not.toHaveBeenCalled()
    expect(em.rollback).toHaveBeenCalledTimes(1)
  })
})
