/** @jest-environment node */

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (emInstance: any, entity: unknown, filters: unknown, opts?: unknown) =>
    emInstance.find(entity, filters, opts),
  findOneWithDecryption: (emInstance: any, entity: unknown, filters: unknown, opts?: unknown) =>
    emInstance.findOne(entity, filters, opts),
}))

import '@open-mercato/core/modules/customers/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import {
  CustomerCompanyProfile,
  CustomerEntity,
  CustomerPersonProfile,
} from '../../data/entities'

const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const ORG_ID = '11111111-1111-4111-8111-111111111111'
const ENTITY_ID = '33333333-3333-4333-8333-333333333333'
const PROFILE_ID = '44444444-4444-4444-8444-444444444444'
const INTERACTION_ID = '55555555-5555-4555-8555-555555555555'
const NEXT_AT_ISO = '2026-10-04T09:30:00.000Z'

const ENTITY_DATE_PROPS = ['nextInteractionAt', 'createdAt', 'updatedAt', 'deletedAt'] as const

type Kind = 'person' | 'company'

function makeEntity(kind: Kind, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ENTITY_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    kind,
    displayName: 'Current Name',
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
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  }
}

function makeProfile(kind: Kind, entity: Record<string, unknown>): Record<string, unknown> {
  return kind === 'person'
    ? {
        id: PROFILE_ID,
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        entity,
        firstName: 'Current',
        lastName: 'Name',
        preferredName: null,
        jobTitle: null,
        department: null,
        seniority: null,
        timezone: null,
        linkedInUrl: null,
        twitterUrl: null,
        company: null,
      }
    : {
        id: PROFILE_ID,
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        entity,
        legalName: null,
        brandName: null,
        domain: null,
        websiteUrl: null,
        industry: null,
        sizeBucket: null,
        annualRevenue: null,
      }
}

function makeSnapshot(kind: Kind, nextInteractionAt: string | null) {
  const entity = makeEntity(kind, {
    displayName: 'Snapshot Name',
    nextInteractionAt,
    nextInteractionName: nextInteractionAt ? 'Follow-up call' : null,
    nextInteractionRefId: nextInteractionAt ? INTERACTION_ID : null,
  })
  delete entity.kind
  delete entity.createdAt
  delete entity.updatedAt
  delete entity.deletedAt
  if (kind === 'person') {
    delete entity.temperature
    delete entity.renewalQuarter
  }
  const profile = makeProfile(kind, {})
  delete profile.entity
  delete profile.organizationId
  delete profile.tenantId
  delete profile.company
  return {
    entity,
    profile: kind === 'person' ? { ...profile, companyEntityId: null } : profile,
    ...(kind === 'person' ? { companies: [] } : { members: [] }),
    tagIds: [],
    addresses: [],
    comments: [],
    deals: [],
    activities: [],
    todos: [],
    interactions: [],
    custom: {},
  }
}

function roundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function undoLogEntry(before: unknown, after: unknown) {
  return roundTrip({ resourceId: ENTITY_ID, commandPayload: { undo: { before, after } } })
}

function hydrateDates(data: Record<string, unknown>): Record<string, unknown> {
  const hydrated = { ...data }
  for (const prop of ENTITY_DATE_PROPS) {
    const value = hydrated[prop]
    if (typeof value === 'string') hydrated[prop] = new Date(value)
  }
  return hydrated
}

function assertOrmDateTypes(entity: Record<string, unknown>) {
  for (const prop of ENTITY_DATE_PROPS) {
    const value = entity[prop]
    if (value != null && !(value instanceof Date)) {
      throw new Error(
        `ValidationError: Trying to set CustomerEntity.${prop} of type 'Date' to '${String(value)}' of type '${typeof value}'`,
      )
    }
  }
}

function createFakeEm(kind: Kind, existing: { entity: Record<string, unknown> | null }) {
  const profileCtor = kind === 'person' ? CustomerPersonProfile : CustomerCompanyProfile
  const state = {
    entity: existing.entity,
    profile: existing.entity ? makeProfile(kind, existing.entity) : null,
    flushedEntity: null as Record<string, unknown> | null,
  }
  const em: any = {
    fork: () => em,
    findOne: jest.fn(async (ctor: unknown, where: Record<string, unknown>) => {
      if (ctor === CustomerEntity) {
        return state.entity && where?.id === state.entity.id ? state.entity : null
      }
      if (ctor === profileCtor) return state.profile
      return null
    }),
    find: jest.fn(async () => []),
    count: jest.fn(async () => 0),
    create: jest.fn((ctor: unknown, data: Record<string, unknown>) => {
      const created = ctor === CustomerEntity ? hydrateDates(data) : { ...data }
      if (ctor === CustomerEntity) state.entity = created
      if (ctor === profileCtor) state.profile = created
      return created
    }),
    persist: jest.fn(),
    remove: jest.fn(),
    nativeDelete: jest.fn(async () => 0),
    nativeUpdate: jest.fn(async () => 0),
    getReference: jest.fn((_ctor: unknown, id: string) => ({ id })),
    flush: jest.fn(async () => {
      if (state.entity) {
        assertOrmDateTypes(state.entity)
        state.flushedEntity = { ...state.entity }
      }
    }),
    begin: jest.fn(async () => undefined),
    commit: jest.fn(async () => {
      if (state.entity) assertOrmDateTypes(state.entity)
    }),
    rollback: jest.fn(async () => undefined),
    transactional: jest.fn(async (fn: (inner: unknown) => unknown) => fn(em)),
    getKysely: () => {
      const chain: any = {}
      for (const method of ['select', 'selectAll', 'where', 'orderBy', 'limit', 'offset', 'values', 'set', 'onConflict', 'returning', 'innerJoin', 'leftJoin']) {
        chain[method] = jest.fn(() => chain)
      }
      chain.executeTakeFirst = jest.fn(async () => undefined)
      chain.execute = jest.fn(async () => [])
      return {
        selectFrom: jest.fn(() => chain),
        insertInto: jest.fn(() => chain),
        updateTable: jest.fn(() => chain),
        deleteFrom: jest.fn(() => chain),
      }
    },
  }
  return { em, state }
}

function createCtx(em: unknown): CommandRuntimeContext {
  const queue: unknown[] = []
  const dataEngine = {
    setCustomFields: jest.fn(async () => undefined),
    emitOrmEntityEvent: jest.fn(async () => undefined),
    markOrmEntityChange: jest.fn((entry: unknown) => queue.push(entry)),
    flushOrmEntityChanges: jest.fn(async () => {
      queue.length = 0
    }),
  }
  return {
    container: {
      resolve: (token: string) => {
        if (token === 'em') return em
        if (token === 'dataEngine') return dataEngine
        if (token === 'eventBus') return { emitEvent: jest.fn(async () => undefined) }
        throw new Error(`Unexpected dependency: ${token}`)
      },
    } as unknown as CommandRuntimeContext['container'],
    auth: { sub: 'actor-user', tenantId: TENANT_ID, orgId: ORG_ID } as unknown as CommandRuntimeContext['auth'],
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: null,
    request: undefined as unknown as CommandRuntimeContext['request'],
  }
}

function commandFor(kind: Kind, action: 'create' | 'update' | 'delete'): CommandHandler {
  const id = `customers.${kind === 'person' ? 'people' : 'companies'}.${action}`
  const handler = commandRegistry.get(id) as CommandHandler | undefined
  if (!handler) throw new Error(`[internal] command ${id} not registered`)
  return handler
}

describe.each<Kind>(['person', 'company'])('customers %s undo/redo restore nextInteractionAt as a Date (#6336)', (kind) => {
  afterEach(() => jest.clearAllMocks())

  it('undoes a delete of a record that had an upcoming interaction', async () => {
    const { em, state } = createFakeEm(kind, { entity: null })
    const handler = commandFor(kind, 'delete')

    await handler.undo!({ logEntry: undoLogEntry(makeSnapshot(kind, NEXT_AT_ISO), null), ctx: createCtx(em) } as never)

    expect(state.flushedEntity).not.toBeNull()
    expect(state.flushedEntity!.nextInteractionAt).toBeInstanceOf(Date)
    expect((state.flushedEntity!.nextInteractionAt as Date).toISOString()).toBe(NEXT_AT_ISO)
    expect(state.flushedEntity!.nextInteractionName).toBe('Follow-up call')
    expect(state.flushedEntity!.nextInteractionRefId).toBe(INTERACTION_ID)
  })

  it('undoes an update of a record that had an upcoming interaction', async () => {
    const existing = makeEntity(kind, {
      displayName: 'Renamed',
      nextInteractionAt: new Date(NEXT_AT_ISO),
      nextInteractionName: 'Follow-up call',
      nextInteractionRefId: INTERACTION_ID,
    })
    const { em, state } = createFakeEm(kind, { entity: existing })
    const handler = commandFor(kind, 'update')
    const before = makeSnapshot(kind, NEXT_AT_ISO)
    const after = { ...makeSnapshot(kind, NEXT_AT_ISO), entity: { ...makeSnapshot(kind, NEXT_AT_ISO).entity, displayName: 'Renamed' } }

    await handler.undo!({ logEntry: undoLogEntry(before, after), ctx: createCtx(em) } as never)

    expect(state.flushedEntity).not.toBeNull()
    expect(state.flushedEntity!.displayName).toBe('Snapshot Name')
    expect(state.flushedEntity!.nextInteractionAt).toBeInstanceOf(Date)
    expect((state.flushedEntity!.nextInteractionAt as Date).toISOString()).toBe(NEXT_AT_ISO)
  })

  it('keeps a null nextInteractionAt null when undoing a delete', async () => {
    const { em, state } = createFakeEm(kind, { entity: null })
    const handler = commandFor(kind, 'delete')

    await handler.undo!({ logEntry: undoLogEntry(makeSnapshot(kind, null), null), ctx: createCtx(em) } as never)

    expect(state.flushedEntity).not.toBeNull()
    expect(state.flushedEntity!.nextInteractionAt).toBeNull()
  })

  it('rejects an unparsable snapshot date before writing anything', async () => {
    const { em, state } = createFakeEm(kind, { entity: null })
    const handler = commandFor(kind, 'delete')

    await expect(
      handler.undo!({ logEntry: undoLogEntry(makeSnapshot(kind, 'not-a-date'), null), ctx: createCtx(em) } as never),
    ).rejects.toThrow('Invalid nextInteractionAt snapshot date')
    expect(em.flush).not.toHaveBeenCalled()
    expect(state.flushedEntity).toBeNull()
  })
})

describe('customers create redo restores nextInteractionAt as a Date (#6336)', () => {
  afterEach(() => jest.clearAllMocks())

  it('redoes a company create whose snapshot carries a next interaction', async () => {
    const { em, state } = createFakeEm('company', { entity: null })
    const handler = commandFor('company', 'create')

    await handler.redo!({ logEntry: undoLogEntry(null, makeSnapshot('company', NEXT_AT_ISO)), ctx: createCtx(em) } as never)

    expect(state.flushedEntity).not.toBeNull()
    expect(state.flushedEntity!.nextInteractionAt).toBeInstanceOf(Date)
    expect((state.flushedEntity!.nextInteractionAt as Date).toISOString()).toBe(NEXT_AT_ISO)
  })

  it('keeps person create redo hydrating the date through the re-create branch (create undo hard-deletes)', async () => {
    const { em, state } = createFakeEm('person', { entity: null })
    const handler = commandFor('person', 'create')

    await handler.redo!({ logEntry: undoLogEntry(null, makeSnapshot('person', NEXT_AT_ISO)), ctx: createCtx(em) } as never)

    expect(state.flushedEntity).not.toBeNull()
    expect(state.flushedEntity!.nextInteractionAt).toBeInstanceOf(Date)
    expect((state.flushedEntity!.nextInteractionAt as Date).toISOString()).toBe(NEXT_AT_ISO)
  })
})
