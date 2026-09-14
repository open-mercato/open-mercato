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
  CustomerEntity,
  CustomerPersonCompanyLink,
  CustomerDealCompanyLink,
  CustomerPersonProfile,
} from '../../data/entities'

const ORG_ID = 'org-co-1'
const TENANT_ID = 'tenant-co-1'
const COMPANY_ID = 'company-1'

function makeCompanyEntity(): CustomerEntity {
  return {
    id: COMPANY_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    kind: 'company',
    displayName: 'Acme Corp',
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
    personProfile: undefined,
    companyProfile: undefined,
    addresses: [] as any,
    activities: [] as any,
    comments: [] as any,
    tagAssignments: [] as any,
    todoLinks: [] as any,
    dealPersonLinks: [] as any,
    dealCompanyLinks: [] as any,
    companyMembers: [] as any,
  } as unknown as CustomerEntity
}

type Counts = {
  personLinks?: number
  dealLinks?: number
  directPeople?: number
  softDeletedPersonLinks?: number
}

function isSoftDeletedLinkFilter(where: unknown): boolean {
  if (typeof where !== 'object' || where === null) return false
  const deletedAt = (where as { deletedAt?: unknown }).deletedAt
  return typeof deletedAt === 'object' && deletedAt !== null && '$ne' in deletedAt
}

function makeEm(entity: CustomerEntity, counts: Counts = {}): jest.Mocked<Pick<EntityManager,
  'fork' | 'findOne' | 'find' | 'count' | 'nativeDelete' | 'nativeUpdate' | 'remove' | 'flush' | 'transactional' | 'create' | 'persist' | 'getReference'
>> {
  let residualSoftDeletedLinks = counts.softDeletedPersonLinks ?? 0
  let companyRemoved = false
  const em: any = {
    fork: jest.fn().mockReturnThis(),
    findOne: jest.fn(async (ctor: any) => {
      if (ctor === CustomerEntity) return entity
      return null
    }),
    find: jest.fn(async () => []),
    count: jest.fn(async (ctor: any) => {
      if (ctor === CustomerPersonCompanyLink) return counts.personLinks ?? 0
      if (ctor === CustomerDealCompanyLink) return counts.dealLinks ?? 0
      if (ctor === CustomerPersonProfile) return counts.directPeople ?? 0
      return 0
    }),
    nativeDelete: jest.fn(async (ctor: any, where: any) => {
      if (ctor === CustomerPersonCompanyLink && isSoftDeletedLinkFilter(where)) {
        residualSoftDeletedLinks = 0
      }
      return undefined
    }),
    nativeUpdate: jest.fn(async () => undefined),
    remove: jest.fn(() => {
      companyRemoved = true
    }),
    flush: jest.fn().mockResolvedValue(undefined),
    // Postgres enforces `customer_person_company_links_company_entity_id_foreign` at commit,
    // so removing the company entity while a soft-deleted link row survives fails the
    // transaction — the HTTP 500 reported in #5965.
    transactional: jest.fn(async (fn: any) => {
      const result = await fn(em)
      if (companyRemoved && residualSoftDeletedLinks > 0) {
        throw new Error(
          'update or delete on table "customer_entities" violates foreign key constraint "customer_person_company_links_company_entity_id_foreign"',
        )
      }
      return result
    }),
    create: jest.fn((_ctor: any, data: any) => ({ id: 'new-id', ...data })),
    persist: jest.fn(),
    getReference: jest.fn((_ctor: any, id: string) => ({ id })),
  }
  return em
}

function makeCtx(em: any): CommandRuntimeContext {
  const queue: any[] = []
  const dataEngine: any = {
    setCustomFields: jest.fn(async () => {}),
    emitOrmEntityEvent: jest.fn(async () => {}),
    markOrmEntityChange: jest.fn((entry: any) => { if (entry?.entity) queue.push(entry) }),
    flushOrmEntityChanges: jest.fn(async () => {
      while (queue.length) await dataEngine.emitOrmEntityEvent(queue.shift())
    }),
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

describe('customers.companies.delete — dependent guard', () => {
  afterEach(() => jest.clearAllMocks())

  it('deletes a dependent-free company without raising', async () => {
    const entity = makeCompanyEntity()
    const em = makeEm(entity, { personLinks: 0, dealLinks: 0, directPeople: 0 })
    const ctx = makeCtx(em)
    const handler = commandRegistry.get('customers.companies.delete') as CommandHandler
    expect(handler).toBeDefined()

    mockFindOneWithDecryption.mockResolvedValueOnce(entity as unknown as null)

    await handler.execute({ body: { id: COMPANY_ID } }, ctx)

    expect(em.transactional).toHaveBeenCalledTimes(1)
    expect(em.remove).toHaveBeenCalledWith(entity)
  })

  it('removes residual soft-deleted person links so the company delete does not break the foreign key', async () => {
    const entity = makeCompanyEntity()
    const em = makeEm(entity, { personLinks: 0, softDeletedPersonLinks: 1 })
    const ctx = makeCtx(em)
    const handler = commandRegistry.get('customers.companies.delete') as CommandHandler

    mockFindOneWithDecryption.mockResolvedValueOnce(entity as unknown as null)

    await expect(handler.execute({ body: { id: COMPANY_ID } }, ctx)).resolves.toEqual({ entityId: COMPANY_ID })

    expect(em.nativeDelete).toHaveBeenCalledWith(CustomerPersonCompanyLink, {
      company: entity,
      deletedAt: { $ne: null },
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
    })
  })

  it('never hard-deletes active person links — the 422 guard runs before any cleanup', async () => {
    const entity = makeCompanyEntity()
    const em = makeEm(entity, { personLinks: 1, softDeletedPersonLinks: 1 })
    const ctx = makeCtx(em)
    const handler = commandRegistry.get('customers.companies.delete') as CommandHandler

    await expect(handler.execute({ body: { id: COMPANY_ID } }, ctx)).rejects.toBeInstanceOf(CrudHttpError)

    expect(em.nativeDelete).not.toHaveBeenCalledWith(CustomerPersonCompanyLink, expect.anything())
  })

  it('throws 422 with a "linked persons" blocker when person links are active', async () => {
    const entity = makeCompanyEntity()
    const em = makeEm(entity, { personLinks: 1 })
    const ctx = makeCtx(em)
    const handler = commandRegistry.get('customers.companies.delete') as CommandHandler

    let captured: unknown
    try {
      await handler.execute({ body: { id: COMPANY_ID } }, ctx)
    } catch (err) {
      captured = err
    }
    expect(captured).toBeInstanceOf(CrudHttpError)
    const httpError = captured as CrudHttpError
    expect(httpError.status).toBe(422)
    const body = httpError.body as { error: string; code: string }
    expect(body.code).toBe('COMPANY_HAS_DEPENDENTS')
    expect(body.error).toContain('linked persons')
    expect(em.remove).not.toHaveBeenCalled()
  })

  it('throws 422 with a "linked deals" blocker when deal links are active', async () => {
    const entity = makeCompanyEntity()
    const em = makeEm(entity, { dealLinks: 2 })
    const ctx = makeCtx(em)
    const handler = commandRegistry.get('customers.companies.delete') as CommandHandler

    let captured: unknown
    try {
      await handler.execute({ body: { id: COMPANY_ID } }, ctx)
    } catch (err) {
      captured = err
    }
    expect(captured).toBeInstanceOf(CrudHttpError)
    const httpError = captured as CrudHttpError
    expect(httpError.status).toBe(422)
    const body = httpError.body as { error: string; code: string }
    expect(body.code).toBe('COMPANY_HAS_DEPENDENTS')
    expect(body.error).toContain('linked deals')
    expect(body.error).toContain('2')
  })

  it('lists every blocker when more than one dependent class is active', async () => {
    const entity = makeCompanyEntity()
    const em = makeEm(entity, { personLinks: 1, dealLinks: 2, directPeople: 3 })
    const ctx = makeCtx(em)
    const handler = commandRegistry.get('customers.companies.delete') as CommandHandler

    let captured: unknown
    try {
      await handler.execute({ body: { id: COMPANY_ID } }, ctx)
    } catch (err) {
      captured = err
    }
    expect(captured).toBeInstanceOf(CrudHttpError)
    const httpError = captured as CrudHttpError
    const body = httpError.body as { error: string; code: string }
    expect(body.error).toContain('linked persons')
    expect(body.error).toContain('linked deals')
    expect(body.error).toContain('persons whose primary company')
    expect(body.error).toContain('1')
    expect(body.error).toContain('2')
    expect(body.error).toContain('3')
  })
})
