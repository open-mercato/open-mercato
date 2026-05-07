jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
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
import {
  CustomerEntity,
  CustomerPersonProfile,
} from '../../data/entities'

const ORG_ID = '00000000-0000-4000-8000-0000000000a1'
const TENANT_ID = '00000000-0000-4000-8000-0000000000b1'
const ENTITY_ID = '00000000-0000-4000-8000-0000000000c1'

function makeFixtures(initial: { displayName: string; firstName: string; lastName: string }) {
  const entity: CustomerEntity = {
    id: ENTITY_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    kind: 'person',
    displayName: initial.displayName,
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

  const profile: CustomerPersonProfile = {
    id: 'profile-1',
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    entity,
    firstName: initial.firstName,
    lastName: initial.lastName,
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
  } as unknown as CustomerPersonProfile

  return { entity, profile }
}

function makeEm(entity: CustomerEntity, profile: CustomerPersonProfile) {
  const em: any = {
    fork: () => em,
    findOne: jest.fn(async (ctor: any) => {
      if (ctor === CustomerEntity) return entity
      if (ctor === CustomerPersonProfile) return profile
      return null
    }),
    find: jest.fn(async () => []),
    count: jest.fn(async () => 0),
    nativeUpdate: jest.fn(async () => 1),
    nativeDelete: jest.fn(async () => 1),
    remove: jest.fn().mockReturnValue(undefined),
    flush: jest.fn().mockResolvedValue(undefined),
    transactional: jest.fn(async (fn: any) => fn(em)),
    begin: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
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

describe('customers.people.update — display name derivation', () => {
  afterEach(() => jest.clearAllMocks())

  it('re-derives display name when first/last change and current value was derived', async () => {
    const { entity, profile } = makeFixtures({ displayName: 'John Doe', firstName: 'John', lastName: 'Doe' })
    const em = makeEm(entity, profile)
    const ctx = makeCtx(em)
    const handler = commandRegistry.get('customers.people.update') as CommandHandler

    await handler.execute({
      id: ENTITY_ID,
      firstName: 'Janina',
    }, ctx)

    expect(entity.displayName).toBe('Janina Doe')
  })

  it('preserves a manually-customized display name when first/last change', async () => {
    const { entity, profile } = makeFixtures({ displayName: 'Dr. K. Doe Jr.', firstName: 'John', lastName: 'Doe' })
    const em = makeEm(entity, profile)
    const ctx = makeCtx(em)
    const handler = commandRegistry.get('customers.people.update') as CommandHandler

    await handler.execute({
      id: ENTITY_ID,
      firstName: 'Kacper',
    }, ctx)

    expect(entity.displayName).toBe('Dr. K. Doe Jr.')
  })

  it('does not derive when an explicit displayName is in the patch', async () => {
    const { entity, profile } = makeFixtures({ displayName: 'John Doe', firstName: 'John', lastName: 'Doe' })
    const em = makeEm(entity, profile)
    const ctx = makeCtx(em)
    const handler = commandRegistry.get('customers.people.update') as CommandHandler

    await handler.execute({
      id: ENTITY_ID,
      firstName: 'Janina',
      displayName: 'Janina (Janie) Doe',
    }, ctx)

    expect(entity.displayName).toBe('Janina (Janie) Doe')
  })

  it('leaves displayName untouched when only an unrelated field changes', async () => {
    const { entity, profile } = makeFixtures({ displayName: 'John Doe', firstName: 'John', lastName: 'Doe' })
    const em = makeEm(entity, profile)
    const ctx = makeCtx(em)
    const handler = commandRegistry.get('customers.people.update') as CommandHandler

    await handler.execute({
      id: ENTITY_ID,
      primaryEmail: 'john.doe@example.com',
    }, ctx)

    expect(entity.displayName).toBe('John Doe')
  })
})
