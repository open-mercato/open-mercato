jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

import '@open-mercato/core/modules/customers/commands'
import { commandRegistry, registerCommand } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  CustomerEntity,
  CustomerPersonProfile,
  CustomerCompanyProfile,
  CustomerDeal,
  CustomerActivity,
  CustomerComment,
  CustomerAddress,
  CustomerTag,
  CustomerTagAssignment,
  CustomerTodoLink,
} from '../../data/entities'
// Todo type removed - example package no longer exists
type Todo = {
  id: string
  title: string
  isDone: boolean
  tenantId: string | null
  organizationId: string | null
}

const TEST_TENANT_ID = '00000000-0000-0000-0000-000000000000'
const TEST_ORG_ID = '123e4567-e89b-41d3-a456-426614174000'
const TEST_ENTITY_ID = '123e4567-e89b-41d3-a456-426614174001'

function createMockContext(deps: {
  em: Record<string, unknown>
  dataEngine: Pick<DataEngine, 'setCustomFields' | 'emitOrmEntityEvent'>
  tenantId?: string
  organizationId?: string
}): CommandRuntimeContext {
  const engine = deps.dataEngine as unknown as Record<string, any>
  if (typeof engine.markOrmEntityChange !== 'function' || typeof engine.flushOrmEntityChanges !== 'function') {
    const queue: any[] = []
    engine.markOrmEntityChange = jest.fn((entry: any) => {
      if (!entry || !entry.entity) return
      queue.push(entry)
    })
    engine.flushOrmEntityChanges = jest.fn(async () => {
      while (queue.length > 0) {
        const next = queue.shift()
        await engine.emitOrmEntityEvent(next)
      }
    })
  }
  const container = {
    resolve: (token: string) => {
      switch (token) {
        case 'em':
          return deps.em
        case 'dataEngine':
          return engine
        default:
          throw new Error(`Unexpected dependency: ${token}`)
      }
    },
  }

  return {
    container: container as any,
    auth: {
      sub: 'actor-user',
      tenantId: deps.tenantId ?? 'tenant-1',
      orgId: deps.organizationId ?? 'org-1',
    } as any,
    selectedOrganizationId: deps.organizationId ?? 'org-1',
    organizationScope: null,
    organizationIds: null,
    request: undefined as any,
  }
}

describe('customers commands undo custom fields', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('people.update undo restores custom fields', async () => {
    const handler = commandRegistry.get('customers.people.update') as CommandHandler
    expect(handler).toBeDefined()

    const existingEntity: CustomerEntity = {
      id: 'person-1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      kind: 'person',
      displayName: 'After Name',
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
    }
    const existingProfile: CustomerPersonProfile = {
      id: 'profile-1',
      entity: existingEntity,
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      firstName: 'After',
      lastName: 'User',
      preferredName: null,
      jobTitle: null,
      department: null,
      seniority: null,
      timezone: null,
      linkedInUrl: null,
      twitterUrl: null,
      company: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    existingEntity.personProfile = existingProfile

    const em = {
      fork: () => em,
      findOne: jest.fn(async (ctor, where: any) => {
        if (ctor === CustomerEntity) {
          if ('id' in where && where.id === existingEntity.id) return existingEntity
          return null
        }
        if (ctor === CustomerPersonProfile) {
          if (where.entity === existingEntity) return existingProfile
        }
        return null
      }),
      find: jest.fn(async () => []),
      nativeDelete: jest.fn(async () => {}),
      create: jest.fn((_ctor, data) => data),
      persist: jest.fn(() => {}),
      flush: jest.fn(async () => {}),
      getReference: jest.fn((_ctor, id) => ({ id })),
      remove: jest.fn(() => {}),
    }

    const setCustomFields = jest.fn(async () => {})
    const dataEngine: Pick<DataEngine, 'setCustomFields' | 'emitOrmEntityEvent'> = {
      setCustomFields,
      emitOrmEntityEvent: jest.fn(async () => {}),
    }

    const ctx = createMockContext({
      em,
      dataEngine,
    })

    const logEntry = {
      commandPayload: {
        undo: {
          before: {
            entity: {
              id: 'person-1',
              organizationId: 'org-1',
              tenantId: 'tenant-1',
              displayName: 'Before Name',
              description: 'before',
              ownerUserId: 'user-2',
              primaryEmail: 'before@example.com',
              primaryPhone: null,
              status: 'lead',
              lifecycleStage: null,
              source: 'import',
              nextInteractionAt: null,
              nextInteractionName: null,
              nextInteractionRefId: null,
              isActive: true,
            },
            profile: {
              id: 'profile-1',
              firstName: 'Before',
              lastName: 'User',
              preferredName: null,
              jobTitle: 'Developer',
              department: null,
              seniority: null,
              timezone: null,
              linkedInUrl: null,
              twitterUrl: null,
              companyEntityId: null,
            },
            tagIds: [],
            custom: { priority: 'high' },
          },
          after: {
            entity: {
              id: 'person-1',
              organizationId: 'org-1',
              tenantId: 'tenant-1',
              displayName: 'After Name',
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
              firstName: 'After',
              lastName: 'User',
              preferredName: null,
              jobTitle: null,
              department: null,
              seniority: null,
              timezone: null,
              linkedInUrl: null,
              twitterUrl: null,
              companyEntityId: null,
            },
            tagIds: [],
            custom: { priority: 'low', rating: 'gold' },
          },
        },
      },
    }

    await handler.undo!({ input: undefined, logEntry, ctx })

    expect(setCustomFields).toHaveBeenCalledWith(
      expect.objectContaining({
        recordId: 'profile-1',
        entityId: 'customers:customer_person_profile',
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        values: { priority: 'high', rating: null },
        notify: true,
      })
    )
    expect(existingEntity.displayName).toBe('Before Name')
  })

  it('companies.update undo restores custom fields', async () => {
    const handler = commandRegistry.get('customers.companies.update') as CommandHandler
    expect(handler).toBeDefined()

    const existingEntity: CustomerEntity = {
      id: 'company-1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      kind: 'company',
      displayName: 'After Co',
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
    }
    const existingProfile: CustomerCompanyProfile = {
      id: 'company-profile-1',
      entity: existingEntity,
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      legalName: 'After Co LLC',
      brandName: 'After',
      domain: 'after.com',
      websiteUrl: 'https://after.com',
      industry: 'SaaS',
      sizeBucket: '100-500',
      annualRevenue: '2000000',
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    existingEntity.companyProfile = existingProfile

    const em = {
      fork: () => em,
      findOne: jest.fn(async (ctor, where: any) => {
        if (ctor === CustomerEntity && where.id === existingEntity.id) return existingEntity
        if (ctor === CustomerCompanyProfile && where.entity === existingEntity) return existingProfile
        return null
      }),
      find: jest.fn(async () => []),
      nativeDelete: jest.fn(async () => {}),
      create: jest.fn((_ctor, data) => data),
      persist: jest.fn(() => {}),
      flush: jest.fn(async () => {}),
      getReference: jest.fn((_ctor, id) => ({ id })),
    }

    const setCustomFields = jest.fn(async () => {})
    const dataEngine: Pick<DataEngine, 'setCustomFields' | 'emitOrmEntityEvent'> = {
      setCustomFields,
      emitOrmEntityEvent: jest.fn(async () => {}),
    }

    const tenantId = 'tenant-1'
    const organizationId = 'org-1'
    const ctx = createMockContext({ em, dataEngine })

    const logEntry = {
      commandPayload: {
        undo: {
          before: {
            entity: {
              id: 'company-1',
              organizationId: 'org-1',
              tenantId: 'tenant-1',
              displayName: 'Before Co',
              description: 'legacy description',
              ownerUserId: 'user-5',
              primaryEmail: 'info@before.com',
              primaryPhone: null,
              status: 'customer',
              lifecycleStage: 'paying',
              source: 'import',
              nextInteractionAt: null,
              nextInteractionName: null,
              nextInteractionRefId: null,
              isActive: true,
            },
            profile: {
              id: 'company-profile-1',
              legalName: 'Before Co LTD',
              brandName: 'Before',
              domain: 'before.com',
              websiteUrl: 'https://before.com',
              industry: 'Retail',
              sizeBucket: '10-50',
              annualRevenue: '500000',
            },
            tagIds: [],
            custom: { tier: 'gold' },
          },
          after: {
            entity: {
              id: 'company-1',
              organizationId: 'org-1',
              tenantId: 'tenant-1',
              displayName: 'After Co',
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
              id: 'company-profile-1',
              legalName: 'After Co LLC',
              brandName: 'After',
              domain: 'after.com',
              websiteUrl: 'https://after.com',
              industry: 'SaaS',
              sizeBucket: '100-500',
              annualRevenue: '2000000',
            },
            tagIds: [],
            custom: { tier: 'silver', account_manager: 'user-9' },
          },
        },
      },
    }

    await handler.undo!({ input: undefined, logEntry, ctx })

    expect(setCustomFields).toHaveBeenCalledWith(
      expect.objectContaining({
        recordId: 'company-profile-1',
        entityId: 'customers:customer_company_profile',
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        values: { tier: 'gold', account_manager: null },
        notify: false,
      })
    )
    expect(existingEntity.displayName).toBe('Before Co')
  })

  it('deals.update undo restores custom fields', async () => {
    const handler = commandRegistry.get('customers.deals.update') as CommandHandler
    expect(handler).toBeDefined()
    const tenantId = TEST_TENANT_ID
    const organizationId = TEST_ORG_ID

    const personEntity: CustomerEntity = {
      id: 'person-1',
      organizationId,
      tenantId,
      kind: 'person',
      displayName: 'Person',
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
    }

    const companyEntity: CustomerEntity = {
      ...personEntity,
      id: 'company-1',
      kind: 'company',
      displayName: 'Company',
    }

    const existingDeal: CustomerDeal = {
      id: 'deal-1',
      organizationId,
      tenantId,
      title: 'After Deal',
      description: null,
      status: 'won',
      pipelineStage: 'closed',
      valueAmount: '5000',
      valueCurrency: 'USD',
      probability: 90,
      expectedCloseAt: new Date('2024-01-01'),
      ownerUserId: 'user-10',
      source: 'referral',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      people: [] as any,
      companies: [] as any,
      activities: [] as any,
      comments: [] as any,
    }

    const em = {
      fork: () => em,
      findOne: jest.fn(async (ctor, where: any) => {
        if (ctor === CustomerDeal && where.id === existingDeal.id) return existingDeal
        if (ctor === CustomerEntity) {
          if (where.id === personEntity.id) return personEntity
          if (where.id === companyEntity.id) return companyEntity
        }
        return null
      }),
      find: jest.fn(async () => []),
      nativeDelete: jest.fn(async () => {}),
      create: jest.fn((_ctor, data) => data),
      persist: jest.fn(() => {}),
      flush: jest.fn(async () => {}),
    }

    const setCustomFields = jest.fn(async () => {})
    const dataEngine: Pick<DataEngine, 'setCustomFields' | 'emitOrmEntityEvent'> = {
      setCustomFields,
      emitOrmEntityEvent: jest.fn(async () => {}),
    }

    const ctx = createMockContext({ em, dataEngine, tenantId, organizationId })
    if (!ctx.auth) {
      throw new Error('Expected auth context in mock command runtime')
    }
    ctx.auth.tenantId = tenantId
    ctx.auth.orgId = organizationId
    ctx.selectedOrganizationId = organizationId

    const logEntry = {
      commandPayload: {
        undo: {
          before: {
            deal: {
              id: 'deal-1',
              organizationId: 'org-1',
              tenantId: 'tenant-1',
              title: 'Before Deal',
              description: 'Initial deal',
              status: 'open',
              pipelineStage: 'prospecting',
              valueAmount: '1000',
              valueCurrency: 'USD',
              probability: 20,
              expectedCloseAt: null,
              ownerUserId: 'user-8',
              source: 'event',
            },
            people: ['person-1'],
            companies: ['company-1'],
            custom: { priority: 'high' },
          },
          after: {
            deal: {
              id: 'deal-1',
              organizationId: 'org-1',
              tenantId: 'tenant-1',
              title: 'After Deal',
              description: null,
              status: 'won',
              pipelineStage: 'closed',
              valueAmount: '5000',
              valueCurrency: 'USD',
              probability: 90,
              expectedCloseAt: new Date('2024-01-01'),
              ownerUserId: 'user-10',
              source: 'referral',
            },
            people: ['person-1', 'person-2'],
            companies: ['company-1'],
            custom: { priority: 'low', segment: 'enterprise' },
          },
        },
      },
    }

    await handler.undo!({ input: undefined, logEntry, ctx })

    expect(setCustomFields).toHaveBeenCalledWith(
      expect.objectContaining({
        recordId: 'deal-1',
        entityId: 'customers:customer_deal',
        organizationId,
        tenantId,
        values: { priority: 'high', segment: null },
        notify: false,
      })
    )
    expect(existingDeal.title).toBe('Before Deal')
  })

  it('activities.update undo restores custom fields', async () => {
    const handler = commandRegistry.get('customers.activities.update') as CommandHandler
    expect(handler).toBeDefined()

    const entity: CustomerEntity = {
      id: 'person-1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      kind: 'person',
      displayName: 'Person',
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
    }

    const deal: CustomerDeal = {
      id: 'deal-1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      title: 'Deal',
      description: null,
      status: 'open',
      pipelineStage: null,
      valueAmount: null,
      valueCurrency: null,
      probability: null,
      expectedCloseAt: null,
      ownerUserId: null,
      source: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      people: [] as any,
      companies: [] as any,
      activities: [] as any,
      comments: [] as any,
    }

    const em = {
      fork: () => em,
      findOne: jest.fn(async (ctor, where: any) => {
        if (ctor === CustomerEntity && where.id === entity.id) return entity
        if (ctor === CustomerDeal && where.id === deal.id) return deal
        if (ctor === CustomerActivity && where.id === 'activity-1') {
          return {
            id: 'activity-1',
            organizationId: 'org-1',
            tenantId: 'tenant-1',
            entity,
            deal,
            activityType: 'call',
            subject: 'After',
            body: 'After body',
            occurredAt: new Date('2024-02-01'),
            authorUserId: 'user-2',
          } as any
        }
        return null
      }),
      create: jest.fn((_ctor, data) => data),
      persist: jest.fn(() => {}),
      flush: jest.fn(async () => {}),
      remove: jest.fn(() => {}),
    }

    const setCustomFields = jest.fn(async () => {})
    const dataEngine: Pick<DataEngine, 'setCustomFields' | 'emitOrmEntityEvent'> = {
      setCustomFields,
      emitOrmEntityEvent: jest.fn(async () => {}),
    }

    const ctx = createMockContext({ em, dataEngine })

    const logEntry = {
      commandPayload: {
        undo: {
          before: {
            activity: {
              id: 'activity-1',
              organizationId: 'org-1',
              tenantId: 'tenant-1',
              entityId: 'person-1',
              dealId: 'deal-1',
              activityType: 'meeting',
              subject: 'Before subject',
              body: 'Before body',
              occurredAt: new Date('2024-01-01'),
              authorUserId: 'user-1',
            },
            custom: { notes: 'important' },
          },
          after: {
            activity: {
              id: 'activity-1',
              organizationId: 'org-1',
              tenantId: 'tenant-1',
              entityId: 'person-1',
              dealId: 'deal-1',
              activityType: 'call',
              subject: 'After',
              body: 'After body',
              occurredAt: new Date('2024-02-01'),
              authorUserId: 'user-2',
            },
            custom: { notes: 'follow up', outcome: 'positive' },
          },
        },
      },
    }

    await handler.undo!({ input: undefined, logEntry, ctx })

    expect(setCustomFields).toHaveBeenCalledWith(
      expect.objectContaining({
        recordId: 'activity-1',
        entityId: 'customers:customer_activity',
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        values: { notes: 'important', outcome: null },
        notify: false,
      })
    )
  })

  it('comments.delete undo recreates comment', async () => {
    const handler = commandRegistry.get('customers.comments.delete') as CommandHandler
    expect(handler).toBeDefined()

    const entity: CustomerEntity = {
      id: 'person-1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      kind: 'person',
      displayName: 'Person',
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
    }

    const em = {
      fork: () => em,
      findOne: jest.fn(async (ctor, where: any) => {
        if (ctor === CustomerEntity && where.id === entity.id) return entity
        if (ctor === CustomerComment && where.id === 'comment-1') return null
        return null
      }),
      create: jest.fn((_ctor, data) => data),
      persist: jest.fn(() => {}),
      flush: jest.fn(async () => {}),
    }

    const dataEngine: Pick<DataEngine, 'setCustomFields' | 'emitOrmEntityEvent'> = {
      setCustomFields: jest.fn(async () => {}),
      emitOrmEntityEvent: jest.fn(async () => {}),
    }

    const ctx = createMockContext({ em, dataEngine })

    const logEntry = {
      commandPayload: {
        undo: {
          before: {
            id: 'comment-1',
            organizationId: 'org-1',
            tenantId: 'tenant-1',
            entityId: 'person-1',
            dealId: null,
            body: 'Note body',
            authorUserId: 'user-1',
          },
        },
      },
    }

    await handler.undo!({ input: undefined, logEntry, ctx })

    expect(em.create).toHaveBeenCalledWith(
      CustomerComment,
      expect.objectContaining({ id: 'comment-1', body: 'Note body' })
    )
  })

  it('addresses.delete undo recreates address and clears other primaries', async () => {
    const handler = commandRegistry.get('customers.addresses.delete') as CommandHandler
    expect(handler).toBeDefined()

    const entity: CustomerEntity = {
      id: 'person-1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      kind: 'person',
      displayName: 'Person',
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
    }

    const nativeUpdate = jest.fn(async () => {})
    const em = {
      fork: () => em,
      findOne: jest.fn(async (ctor, where: any) => {
        if (ctor === CustomerEntity && where.id === entity.id) return entity
        if (ctor === CustomerAddress && where.id === 'address-1') return null
        return null
      }),
      create: jest.fn((_ctor, data) => data),
      persist: jest.fn(() => {}),
      flush: jest.fn(async () => {}),
      nativeUpdate,
    }

    const dataEngine: Pick<DataEngine, 'setCustomFields' | 'emitOrmEntityEvent'> = {
      setCustomFields: jest.fn(async () => {}),
      emitOrmEntityEvent: jest.fn(async () => {}),
    }

    const ctx = createMockContext({ em, dataEngine })

    const logEntry = {
      commandPayload: {
        undo: {
          before: {
            id: 'address-1',
            organizationId: 'org-1',
            tenantId: 'tenant-1',
            entityId: 'person-1',
            name: 'HQ',
            purpose: 'billing',
            addressLine1: 'Street 1',
            addressLine2: null,
            city: 'City',
            region: null,
            postalCode: '00-001',
            country: 'PL',
            latitude: null,
            longitude: null,
            isPrimary: true,
          },
        },
      },
    }

    await handler.undo!({ input: undefined, logEntry, ctx })

    expect(em.create).toHaveBeenCalledWith(
      CustomerAddress,
      expect.objectContaining({ id: 'address-1', name: 'HQ', isPrimary: true })
    )
    expect(nativeUpdate).toHaveBeenCalled()
  })

  it('tags.unassign undo re-creates tag assignment', async () => {
    const handler = commandRegistry.get('customers.tags.unassign') as CommandHandler
    expect(handler).toBeDefined()

    const tag: CustomerTag = {
      id: 'tag-1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      slug: 'vip',
      label: 'VIP',
      color: null,
      description: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      assignments: [] as any,
    }

    const entity: CustomerEntity = {
      id: 'person-1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      kind: 'person',
      displayName: 'Person',
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
    }

    const findOne = jest.fn(async (ctor, where: any) => {
      if (ctor === CustomerTag && where.id === tag.id) return tag
      if (ctor === CustomerEntity && where.id === entity.id) return entity
      if (ctor === CustomerTagAssignment) return null
      return null
    })

    const em = {
      fork: () => em,
      findOne,
      create: jest.fn((_ctor, data) => data),
      persist: jest.fn(() => {}),
      flush: jest.fn(async () => {}),
    }

    const dataEngine: Pick<DataEngine, 'setCustomFields' | 'emitOrmEntityEvent'> = {
      setCustomFields: jest.fn(async () => {}),
      emitOrmEntityEvent: jest.fn(async () => {}),
    }

    const ctx = createMockContext({ em, dataEngine })

    const logEntry = {
      commandPayload: {
        undo: {
          before: {
            tagId: 'tag-1',
            entityId: 'person-1',
            organizationId: 'org-1',
            tenantId: 'tenant-1',
          },
        },
      },
    }

    await handler.undo!({ input: undefined, logEntry, ctx })

    expect(em.create).toHaveBeenCalledWith(
      CustomerTagAssignment,
      expect.objectContaining({
        tag,
        entity,
      })
    )
  })

  it('todos.unlink undo re-creates todo link', async () => {
    const handler = commandRegistry.get('customers.todos.unlink') as CommandHandler
    expect(handler).toBeDefined()

    const entity: CustomerEntity = {
      id: 'person-1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      kind: 'person',
      displayName: 'Person',
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
    }

    const findOne = jest.fn(async (ctor, where: any) => {
      if (ctor === CustomerEntity && where.id === entity.id) return entity
      if (ctor === CustomerTodoLink && where.id === 'link-1') return null
      return null
    })

    const em = {
      fork: () => em,
      findOne,
      create: jest.fn((_ctor, data) => data),
      persist: jest.fn(() => {}),
      flush: jest.fn(async () => {}),
      nativeDelete: jest.fn(async () => {}),
    }

    const dataEngine: Pick<DataEngine, 'setCustomFields' | 'emitOrmEntityEvent'> = {
      setCustomFields: jest.fn(async () => {}),
      emitOrmEntityEvent: jest.fn(async () => {}),
    }

    const ctx = createMockContext({ em, dataEngine })

    const logEntry = {
      commandPayload: {
        undo: {
          link: {
            id: 'link-1',
            entityId: 'person-1',
            organizationId: 'org-1',
            tenantId: 'tenant-1',
            todoId: 'todo-1',
            todoSource: 'example:todo',
            createdByUserId: 'user-1',
          },
        },
      },
    }

    await handler.undo!({ input: undefined, logEntry, ctx })

    expect(em.create).toHaveBeenCalledWith(
      CustomerTodoLink,
      expect.objectContaining({ id: 'link-1', todoId: 'todo-1' })
    )
  })

  it('todos.create undo removes link and calls example undo', async () => {
    // example package no longer exists, so we just register a mock handler
    const originalHandler = commandRegistry.get('example.todos.create') as CommandHandler | null
    const tenantId = TEST_TENANT_ID
    const organizationId = TEST_ORG_ID
    const entityId = TEST_ENTITY_ID

    const fakeTodo = {
      id: 'todo-created',
      title: 'Follow up',
      isDone: false,
      tenantId,
      organizationId,
    } as unknown as Todo

    const executeMock = jest.fn(async (payload: Record<string, unknown>) => fakeTodo)
    const captureAfterMock = jest.fn(async () => ({
      id: 'todo-created',
      title: 'Follow up',
      is_done: false,
      tenantId,
      organizationId,
    }))
    const undoMock = jest.fn(async () => {})

    commandRegistry.unregister('example.todos.create')
    registerCommand({
      id: 'example.todos.create',
      execute: executeMock,
      captureAfter: captureAfterMock,
      undo: undoMock,
    } as CommandHandler)

    const em = {
      fork: () => em,
      findOne: jest.fn(async (ctor, where: any) => {
        if (ctor === CustomerEntity && where.id === entityId) {
          return {
            id: entityId,
            organizationId,
            tenantId,
            kind: 'person',
          } as CustomerEntity
        }
        if (ctor === CustomerTodoLink && where.id === 'link-1') return null
        return null
      }),
      create: jest.fn((_ctor, data) => ({ id: data.id ?? 'link-1', ...data })),
      persist: jest.fn(() => {}),
      flush: jest.fn(async () => {}),
      nativeDelete: jest.fn(async () => {}),
    }

    const dataEngine: Pick<DataEngine, 'setCustomFields' | 'emitOrmEntityEvent'> = {
      setCustomFields: jest.fn(async () => {}),
      emitOrmEntityEvent: jest.fn(async () => {}),
    }

    const ctx = createMockContext({ em, dataEngine, tenantId, organizationId })
    if (!ctx.auth) {
      throw new Error('Expected auth context in mock command runtime')
    }
    ctx.auth = { ...ctx.auth, tenantId, orgId: organizationId } as any
    ctx.selectedOrganizationId = organizationId

    const handler = commandRegistry.get('customers.todos.create') as CommandHandler
    expect(handler).toBeDefined()

    const input = {
      tenantId,
      organizationId,
      entityId,
      title: 'Follow up',
      todoCustom: { priority: 'high' },
    }

    expect(ctx.auth!.tenantId).toBe(tenantId)
    expect(ctx.auth!.orgId).toBe(organizationId)

    const result = await handler.execute(input, ctx) as { linkId: string }
    expect(executeMock).toHaveBeenCalled()
    const firstExecuteCall = executeMock.mock.calls[0] as [Record<string, unknown>]
    expect(firstExecuteCall[0]).toMatchObject({
      title: 'Follow up',
      is_done: false,
      custom: { priority: 'high' },
    })
    expect(em.persist).toHaveBeenCalled()

    const log = await handler.buildLog?.({ input, result, ctx, snapshots: {} as any })
    expect(log).toBeTruthy()

    await handler.undo?.({
      input: undefined,
      ctx,
      logEntry: {
        commandPayload: log?.payload ?? null,
      } as any,
    })

    expect(undoMock).toHaveBeenCalled()

    commandRegistry.unregister('example.todos.create')
    if (originalHandler) registerCommand(originalHandler)
  })
})
