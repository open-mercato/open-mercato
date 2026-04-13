/**
 * Tests that every em.nativeDelete call in the people command handlers
 * includes organizationId + tenantId scope where the entity schema supports it.
 *
 * Regression coverage for: fix/customers-data-integrity
 *   – delete execute:  CustomerAddress/Comment/Activity/Interaction/TodoLink/TagAssignment
 *   – create undo:     CustomerTagAssignment
 *   – delete undo:     CustomerActivity/Comment/Address/TodoLink/Interaction
 *
 * CustomerDealPersonLink is intentionally NOT scoped: it has no org/tenant columns.
 */

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async () => []),
  findOneWithDecryption: jest.fn(async () => null),
}))

import '@open-mercato/core/modules/customers/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  CustomerEntity,
  CustomerPersonProfile,
  CustomerAddress,
  CustomerComment,
  CustomerActivity,
  CustomerInteraction,
  CustomerTodoLink,
  CustomerTagAssignment,
  CustomerDealPersonLink,
} from '../../data/entities'

const ORG_ID = 'org-aaa'
const TENANT_ID = 'tenant-bbb'
const ENTITY_ID = 'entity-111'

function makeEntity(overrides: Partial<CustomerEntity> = {}): CustomerEntity {
  return {
    id: ENTITY_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    kind: 'person',
    displayName: 'Test Person',
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
    ...overrides,
  }
}

function makeEm(entity: CustomerEntity): jest.Mocked<Pick<EntityManager,
  'fork' | 'findOne' | 'find' | 'nativeDelete' | 'remove' | 'flush' | 'create' | 'persist' | 'getReference'
>> {
  const em: any = {
    fork: jest.fn().mockReturnThis(),
    findOne: jest.fn(async (ctor: any) => {
      if (ctor === CustomerEntity) return entity
      return null
    }),
    find: jest.fn(async () => []),
    nativeDelete: jest.fn(async () => undefined),
    remove: jest.fn().mockReturnValue({ flush: jest.fn().mockResolvedValue(undefined) }),
    flush: jest.fn().mockResolvedValue(undefined),
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

describe('people commands — nativeDelete tenant/org scoping', () => {
  afterEach(() => jest.clearAllMocks())

  describe('customers.people.delete execute', () => {
    it('scopes nativeDelete with organizationId + tenantId for all tenant-aware child entities', async () => {
      const entity = makeEntity()
      const em = makeEm(entity)
      const ctx = makeCtx(em)
      const handler = commandRegistry.get('customers.people.delete') as CommandHandler
      expect(handler).toBeDefined()

      await handler.execute({ body: { id: ENTITY_ID } }, ctx)

      const scope = { organizationId: ORG_ID, tenantId: TENANT_ID }

      expect(em.nativeDelete).toHaveBeenCalledWith(CustomerAddress,     expect.objectContaining({ entity, ...scope }))
      expect(em.nativeDelete).toHaveBeenCalledWith(CustomerComment,     expect.objectContaining({ entity, ...scope }))
      expect(em.nativeDelete).toHaveBeenCalledWith(CustomerActivity,    expect.objectContaining({ entity, ...scope }))
      expect(em.nativeDelete).toHaveBeenCalledWith(CustomerInteraction, expect.objectContaining({ entity, ...scope }))
      expect(em.nativeDelete).toHaveBeenCalledWith(CustomerTodoLink,    expect.objectContaining({ entity, ...scope }))
      expect(em.nativeDelete).toHaveBeenCalledWith(CustomerTagAssignment, expect.objectContaining({ entity, ...scope }))
    })

    it('does NOT add organizationId/tenantId scope to CustomerDealPersonLink (join table has no tenant columns)', async () => {
      const entity = makeEntity()
      const em = makeEm(entity)
      const ctx = makeCtx(em)
      const handler = commandRegistry.get('customers.people.delete') as CommandHandler

      await handler.execute({ body: { id: ENTITY_ID } }, ctx)

      const dealPersonLinkCalls = (em.nativeDelete as jest.Mock).mock.calls.filter(
        ([ctor]: [any]) => ctor === CustomerDealPersonLink,
      )
      expect(dealPersonLinkCalls).toHaveLength(1)
      expect(dealPersonLinkCalls[0][1]).not.toHaveProperty('organizationId')
      expect(dealPersonLinkCalls[0][1]).not.toHaveProperty('tenantId')
    })
  })

  describe('customers.people.create undo', () => {
    it('scopes nativeDelete(CustomerTagAssignment) with organizationId + tenantId', async () => {
      const entity = makeEntity()
      const em = makeEm(entity)
      const ctx = makeCtx(em)
      const handler = commandRegistry.get('customers.people.create') as CommandHandler
      expect(handler).toBeDefined()
      expect(handler.undo).toBeDefined()

      const logEntry = {
        resourceId: ENTITY_ID,
        commandPayload: {
          undo: {
            after: {
              entity: {
                id: ENTITY_ID,
                organizationId: ORG_ID,
                tenantId: TENANT_ID,
              },
              profile: { id: 'profile-1' },
              tagIds: [],
            },
          },
        },
      }

      await handler.undo!({ input: undefined, logEntry: logEntry as any, ctx })

      expect(em.nativeDelete).toHaveBeenCalledWith(
        CustomerTagAssignment,
        expect.objectContaining({ entity, organizationId: ORG_ID, tenantId: TENANT_ID }),
      )
    })
  })

  describe('customers.people.delete undo', () => {
    it('scopes nativeDelete with organizationId + tenantId for all tenant-aware child entities', async () => {
      const entity = makeEntity()
      const em = makeEm(entity)
      const ctx = makeCtx(em)
      const handler = commandRegistry.get('customers.people.delete') as CommandHandler
      expect(handler).toBeDefined()
      expect(handler.undo).toBeDefined()

      const before = {
        entity: {
          id: ENTITY_ID,
          organizationId: ORG_ID,
          tenantId: TENANT_ID,
          kind: 'person' as const,
          displayName: 'Test Person',
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
          isActive: true,
        },
        profile: {
          id: 'profile-1',
          firstName: 'Test',
          lastName: 'Person',
          preferredName: null,
          jobTitle: null,
          department: null,
          seniority: null,
          timezone: null,
          linkedInUrl: null,
          twitterUrl: null,
          companyEntityId: null,
        },
        deals: [],
        comments: [],
        addresses: [],
        tagIds: [],
        custom: {},
      }

      const logEntry = {
        commandPayload: { undo: { before } },
      }

      await handler.undo!({ input: undefined, logEntry: logEntry as any, ctx })

      const scope = { organizationId: ORG_ID, tenantId: TENANT_ID }

      expect(em.nativeDelete).toHaveBeenCalledWith(CustomerActivity,    expect.objectContaining({ entity, ...scope }))
      expect(em.nativeDelete).toHaveBeenCalledWith(CustomerComment,     expect.objectContaining({ entity, ...scope }))
      expect(em.nativeDelete).toHaveBeenCalledWith(CustomerAddress,     expect.objectContaining({ entity, ...scope }))
      expect(em.nativeDelete).toHaveBeenCalledWith(CustomerTodoLink,    expect.objectContaining({ entity, ...scope }))
      expect(em.nativeDelete).toHaveBeenCalledWith(CustomerInteraction, expect.objectContaining({ entity, ...scope }))
    })

    it('does NOT add organizationId/tenantId scope to CustomerDealPersonLink in undo path', async () => {
      const entity = makeEntity()
      const em = makeEm(entity)
      const ctx = makeCtx(em)
      const handler = commandRegistry.get('customers.people.delete') as CommandHandler

      const before = {
        entity: {
          id: ENTITY_ID,
          organizationId: ORG_ID,
          tenantId: TENANT_ID,
          kind: 'person' as const,
          displayName: 'Test Person',
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
          isActive: true,
        },
        profile: {
          id: 'profile-1',
          firstName: 'Test',
          lastName: 'Person',
          preferredName: null,
          jobTitle: null,
          department: null,
          seniority: null,
          timezone: null,
          linkedInUrl: null,
          twitterUrl: null,
          companyEntityId: null,
        },
        deals: [],
        comments: [],
        addresses: [],
        tagIds: [],
        custom: {},
      }

      await handler.undo!({ input: undefined, logEntry: { commandPayload: { undo: { before } } } as any, ctx })

      const dealPersonLinkCalls = (em.nativeDelete as jest.Mock).mock.calls.filter(
        ([ctor]: [any]) => ctor === CustomerDealPersonLink,
      )
      expect(dealPersonLinkCalls).toHaveLength(1)
      expect(dealPersonLinkCalls[0][1]).not.toHaveProperty('organizationId')
      expect(dealPersonLinkCalls[0][1]).not.toHaveProperty('tenantId')
    })
  })
})
