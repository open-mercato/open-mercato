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
import { CustomerEntity, CustomerPersonProfile } from '../../data/entities'

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const PERSON_ID = '44444444-4444-4444-8444-444444444444'
const LOADED_VERSION = new Date('2026-01-01T10:00:00.000Z')

function makePerson(): CustomerEntity {
  return {
    id: PERSON_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    kind: 'person',
    displayName: 'Jane Doe',
    isActive: true,
    createdAt: LOADED_VERSION,
    updatedAt: LOADED_VERSION,
    deletedAt: null,
  } as unknown as CustomerEntity
}

function makeProfile(): CustomerPersonProfile {
  return {
    id: 'profile-1',
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    firstName: 'Jane',
    lastName: 'Doe',
    preferredName: null,
    jobTitle: null,
    department: null,
    seniority: null,
    timezone: null,
    linkedInUrl: null,
    twitterUrl: null,
  } as unknown as CustomerPersonProfile
}

function makeEm(person: CustomerEntity, profile: CustomerPersonProfile) {
  const em: Record<string, unknown> = {
    fork: jest.fn(() => em),
    findOne: jest.fn(async (ctor: unknown) => {
      if (ctor === CustomerEntity) return person
      if (ctor === CustomerPersonProfile) return profile
      return null
    }),
    find: jest.fn(async () => []),
    flush: jest.fn(async () => undefined),
    transactional: jest.fn(async (fn: (inner: unknown) => unknown) => fn(em)),
    begin: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
    persist: jest.fn(),
    remove: jest.fn(),
    nativeDelete: jest.fn(async () => 0),
    getReference: jest.fn((_ctor: unknown, id: string) => ({ id })),
  }
  return em
}

function makeCtx(em: Record<string, unknown>): CommandRuntimeContext {
  const dataEngine = {
    setCustomFields: jest.fn(async () => undefined),
    emitOrmEntityEvent: jest.fn(async () => undefined),
    markOrmEntityChange: jest.fn(),
    flushOrmEntityChanges: jest.fn(async () => undefined),
  }
  return {
    container: {
      resolve: (token: string): unknown => {
        if (token === 'em') return em
        if (token === 'dataEngine') return dataEngine
        if (token === 'eventBus') return { emitEvent: jest.fn(async () => undefined) }
        throw new Error(`Unexpected DI token: ${token}`)
      },
    },
    auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID },
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: null,
  } as unknown as CommandRuntimeContext
}

async function runUpdate(input: Record<string, unknown>) {
  const person = makePerson()
  const profile = makeProfile()
  const ctx = makeCtx(makeEm(person, profile))
  const handler = commandRegistry.get('customers.people.update') as CommandHandler
  const result = (await handler.execute({ id: PERSON_ID, ...input }, ctx)) as { updatedAt: Date }
  return { person, profile, result }
}

describe('customers.people.update — optimistic-lock version (#8643)', () => {
  it('advances updatedAt when only profile fields change', async () => {
    const { person, profile } = await runUpdate({ department: 'Engineering' })

    expect(profile.department).toBe('Engineering')
    expect(person.updatedAt.getTime()).toBeGreaterThan(LOADED_VERSION.getTime())
  })

  it('advances updatedAt when only custom fields change', async () => {
    const { person } = await runUpdate({ cf_priority: 'high' })

    expect(person.updatedAt.getTime()).toBeGreaterThan(LOADED_VERSION.getTime())
  })

  it('advances updatedAt when only tags change', async () => {
    const { person } = await runUpdate({ tags: [] })

    expect(person.updatedAt.getTime()).toBeGreaterThan(LOADED_VERSION.getTime())
  })

  it('leaves updatedAt alone when no profile, custom field, or tag is submitted', async () => {
    const { person } = await runUpdate({})

    expect(person.updatedAt).toBe(LOADED_VERSION)
  })
})
