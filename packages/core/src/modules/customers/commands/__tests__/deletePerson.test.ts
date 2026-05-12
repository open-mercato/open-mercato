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
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  CustomerDealPersonLink,
  CustomerEntity,
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

function makeEm(entity: CustomerEntity, dealLinks: number) {
  const em: any = {
    fork: jest.fn(),
    findOne: jest.fn(async (ctor: any) => (ctor === CustomerEntity ? entity : null)),
    find: jest.fn(async () => []),
    count: jest.fn(async (ctor: any) => (ctor === CustomerDealPersonLink ? dealLinks : 0)),
    nativeDelete: jest.fn(async () => undefined),
    remove: jest.fn().mockReturnValue(undefined),
    flush: jest.fn().mockResolvedValue(undefined),
    persist: jest.fn(),
    getReference: jest.fn((_ctor: any, id: string) => ({ id })),
  }
  em.fork.mockReturnValue(em)
  return em as jest.Mocked<Pick<EntityManager, 'fork' | 'findOne' | 'find' | 'count' | 'nativeDelete' | 'remove' | 'flush'>>
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
  afterEach(() => jest.clearAllMocks())

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
})
