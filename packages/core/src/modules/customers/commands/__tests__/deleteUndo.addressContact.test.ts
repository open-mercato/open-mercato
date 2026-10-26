jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

const mockFindWithDecryption = jest.fn(async (..._args: unknown[]): Promise<unknown[]> => [])
const mockFindOneWithDecryption = jest.fn(async (..._args: unknown[]): Promise<unknown> => null)

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

import '@open-mercato/core/modules/customers/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import {
  CustomerAddress,
  CustomerCompanyProfile,
  CustomerEntity,
  CustomerPersonProfile,
} from '../../data/entities'

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const ADDRESS_ID = '33333333-3333-4333-8333-333333333333'

function makeAddress(entity: unknown): Record<string, unknown> {
  return {
    id: ADDRESS_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    entity,
    name: 'HQ',
    recipientName: 'Alice Smith',
    phone: '+48 600 100 200',
    purpose: 'billing',
    companyName: 'Billing GmbH',
    addressLine1: 'Baker Street 10',
    addressLine2: null,
    city: 'London',
    region: null,
    postalCode: 'NW1',
    country: 'GB',
    latitude: null,
    longitude: null,
    isPrimary: true,
  }
}

function makeEntity(kind: 'person' | 'company', id: string): Record<string, unknown> {
  return {
    id,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    kind,
    displayName: kind === 'person' ? 'Jane Doe' : 'Acme Corp',
    description: null,
    ownerUserId: null,
    primaryEmail: null,
    primaryPhone: null,
    status: null,
    lifecycleStage: null,
    source: null,
    temperature: null,
    renewalQuarter: null,
    nextInteractionAt: null,
    nextInteractionName: null,
    nextInteractionRefId: null,
    nextInteractionIcon: null,
    nextInteractionColor: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  }
}

function makeProfile(kind: 'person' | 'company', entity: Record<string, unknown>): Record<string, unknown> {
  return kind === 'person'
    ? { id: 'profile-1', entity, firstName: 'Jane', lastName: 'Doe', company: null }
    : { id: 'profile-1', entity, legalName: 'Acme Corp Ltd' }
}

type Created = Array<{ ctor: unknown; data: Record<string, unknown> }>

function makeEm(entity: Record<string, unknown>, profile: Record<string, unknown>, address: Record<string, unknown> | null, created: Created) {
  const em: any = {
    fork: jest.fn().mockReturnThis(),
    findOne: jest.fn(async (ctor: unknown) => {
      if (ctor === CustomerEntity) return entity
      if (ctor === CustomerCompanyProfile) return profile
      return null
    }),
    find: jest.fn(async (ctor: unknown) => (ctor === CustomerAddress && address ? [address] : [])),
    count: jest.fn(async () => 0),
    nativeDelete: jest.fn(async () => undefined),
    nativeUpdate: jest.fn(async () => undefined),
    remove: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
    begin: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    transactional: jest.fn(async (fn: (em: unknown) => unknown) => fn(em)),
    create: jest.fn((ctor: unknown, data: Record<string, unknown>) => {
      created.push({ ctor, data })
      return { ...data }
    }),
    persist: jest.fn(),
    getReference: jest.fn((_ctor: unknown, id: string) => ({ id })),
  }
  return em
}

function makeCtx(em: unknown): CommandRuntimeContext {
  const dataEngine: any = {
    setCustomFields: jest.fn(async () => {}),
    emitOrmEntityEvent: jest.fn(async () => {}),
    markOrmEntityChange: jest.fn(),
    flushOrmEntityChanges: jest.fn(async () => {}),
  }
  return {
    container: {
      resolve: (token: string): unknown => {
        if (token === 'em') return em
        if (token === 'dataEngine') return dataEngine
        if (token === 'eventBus') return { emitEvent: jest.fn(async () => {}) }
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

describe.each([
  { kind: 'person' as const, commandId: 'customers.people.delete', id: '44444444-4444-4444-8444-444444444444' },
  { kind: 'company' as const, commandId: 'customers.companies.delete', id: '55555555-5555-4555-8555-555555555555' },
])('$commandId — address recipientName / phone / companyName survive delete → undo', ({ kind, commandId, id }) => {
  afterEach(() => jest.clearAllMocks())

  it('captures the three fields in the parent snapshot and restores them on undo', async () => {
    // Given a parent with one address carrying the contact fields
    const entity = makeEntity(kind, id)
    const profile = makeProfile(kind, entity)
    const address = makeAddress(entity)
    mockFindOneWithDecryption.mockImplementation(async (_em, ctor) => (ctor === CustomerPersonProfile ? profile : null))
    const created: Created = []
    const em = makeEm(entity, profile, address, created)
    const ctx = makeCtx(em)
    const handler = commandRegistry.get(commandId) as CommandHandler

    // When the parent is snapshotted for the delete log (what prepare + buildLog persist)
    const prepared = (await handler.prepare!({ body: { id } }, ctx)) as { before?: { addresses?: Array<Record<string, unknown>> } }
    const captured = prepared.before?.addresses?.[0]

    // Then the snapshot carries them
    expect(captured).toMatchObject({
      id: ADDRESS_ID,
      recipientName: 'Alice Smith',
      phone: '+48 600 100 200',
      companyName: 'Billing GmbH',
    })

    // And when the delete is undone from that snapshot
    created.length = 0
    await handler.undo!({
      input: { body: { id } },
      ctx,
      logEntry: { commandPayload: { undo: { before: prepared.before } } } as any,
    })

    // Then the re-created address row carries them again
    const restored = created.find((entry) => entry.ctor === CustomerAddress)
    expect(restored?.data).toMatchObject({
      id: ADDRESS_ID,
      recipientName: 'Alice Smith',
      phone: '+48 600 100 200',
      companyName: 'Billing GmbH',
    })
  })

  it('restores null for snapshots written before the columns existed', async () => {
    const entity = makeEntity(kind, id)
    const profile = makeProfile(kind, entity)
    const legacyAddress = makeAddress(entity)
    delete legacyAddress.recipientName
    delete legacyAddress.phone
    delete legacyAddress.companyName
    mockFindOneWithDecryption.mockImplementation(async (_em, ctor) => (ctor === CustomerPersonProfile ? profile : null))
    const created: Created = []
    const em = makeEm(entity, profile, legacyAddress, created)
    const ctx = makeCtx(em)
    const handler = commandRegistry.get(commandId) as CommandHandler

    const prepared = (await handler.prepare!({ body: { id } }, ctx)) as { before?: { addresses?: Array<Record<string, unknown>> } }
    const legacySnapshot = prepared.before!
    for (const entry of legacySnapshot.addresses ?? []) {
      delete entry.recipientName
      delete entry.phone
      delete entry.companyName
    }

    created.length = 0
    await handler.undo!({ input: { body: { id } }, ctx, logEntry: { commandPayload: { undo: { before: legacySnapshot } } } as any })

    const restored = created.find((entry) => entry.ctor === CustomerAddress)
    expect(restored?.data.recipientName).toBeNull()
    expect(restored?.data.phone).toBeNull()
    expect(restored?.data.companyName).toBeNull()
  })
})
