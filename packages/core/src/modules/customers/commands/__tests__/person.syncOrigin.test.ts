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
import type { CrudEmitContext, CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import {
  CustomerEntity,
  CustomerPersonProfile,
} from '../../data/entities'

const ORG_ID = '00000000-0000-4000-8000-0000000000a1'
const TENANT_ID = '00000000-0000-4000-8000-0000000000b1'
const ENTITY_ID = '00000000-0000-4000-8000-0000000000c1'
const ACTOR_USER_ID = '00000000-0000-4000-8000-0000000000d1'
const SYNC_ORIGIN = 'projection:om-crm-person'

type QueuedSideEffect = CrudEmitContext<CustomerEntity> & { events?: CrudEventsConfig<CustomerEntity> }

function makeFixtures() {
  const entity = {
    id: ENTITY_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    kind: 'person',
    displayName: 'John Doe',
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

  const profile = {
    id: 'profile-1',
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    entity,
    firstName: 'John',
    lastName: 'Doe',
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

function makeCtx(em: any, syncOrigin?: string | null) {
  const queue: QueuedSideEffect[] = []
  const dataEngine: any = {
    setCustomFields: jest.fn(async () => {}),
    emitOrmEntityEvent: jest.fn(async () => {}),
    markOrmEntityChange: jest.fn((entry: QueuedSideEffect) => { if (entry?.entity) queue.push(entry) }),
    flushOrmEntityChanges: jest.fn(async () => {}),
  }
  const ctx: CommandRuntimeContext = {
    container: {
      resolve: (token: string): any => {
        if (token === 'em') return em
        if (token === 'dataEngine') return dataEngine
        if (token === 'eventBus') return { emitEvent: jest.fn(async () => {}) }
        throw new Error(`Unexpected DI token: ${token}`)
      },
    } as any,
    auth: { sub: ACTOR_USER_ID, tenantId: TENANT_ID, orgId: ORG_ID } as any,
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: null,
    request: undefined as any,
    syncOrigin,
  }
  return { ctx, queue }
}

async function runCommand(commandId: string, input: Record<string, unknown>, syncOrigin?: string | null) {
  const { entity, profile } = makeFixtures()
  const em = makeEm(entity, profile)
  const { ctx, queue } = makeCtx(em, syncOrigin)
  const handler = commandRegistry.get(commandId) as CommandHandler

  await handler.execute(input, ctx)

  const sideEffect = queue.find((entry) => entry.events?.entity === 'person')
  if (!sideEffect) throw new Error(`[internal] ${commandId} queued no person CRUD side effect`)
  return sideEffect
}

const runUpdate = (syncOrigin?: string | null) =>
  runCommand('customers.people.update', { id: ENTITY_ID, firstName: 'Janina' }, syncOrigin)

const runCreate = (syncOrigin?: string | null) =>
  runCommand('customers.people.create', {
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    firstName: 'Janina',
    lastName: 'Kowalska',
  }, syncOrigin)

const runDelete = (syncOrigin?: string | null) =>
  runCommand('customers.people.delete', { body: { id: ENTITY_ID } }, syncOrigin)

describe('customers.people.update — syncOrigin provenance (#5750)', () => {
  afterEach(() => jest.clearAllMocks())

  it('forwards ctx.syncOrigin to the queued CRUD side effect', async () => {
    const sideEffect = await runUpdate(SYNC_ORIGIN)

    expect(sideEffect.syncOrigin).toBe(SYNC_ORIGIN)
  })

  it('keeps syncOrigin in the persistent event payload built by personCrudEvents', async () => {
    const sideEffect = await runUpdate(SYNC_ORIGIN)

    const payload = sideEffect.events?.buildPayload?.(sideEffect) as Record<string, unknown>
    expect(payload).toMatchObject({
      id: 'profile-1',
      entityId: ENTITY_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      syncOrigin: SYNC_ORIGIN,
    })
  })

  it('forwards the authenticated actor as actorUserId', async () => {
    const sideEffect = await runUpdate(SYNC_ORIGIN)

    expect(sideEffect.actorUserId).toBe(ACTOR_USER_ID)
  })

  it('omits syncOrigin from the payload when the caller supplies none', async () => {
    const sideEffect = await runUpdate(undefined)

    const payload = sideEffect.events?.buildPayload?.(sideEffect) as Record<string, unknown>
    expect(payload).not.toHaveProperty('syncOrigin')
  })
})

describe('customers.people create/delete — syncOrigin provenance (#5750)', () => {
  afterEach(() => jest.clearAllMocks())

  it('forwards syncOrigin and actorUserId from customers.people.create', async () => {
    const sideEffect = await runCreate(SYNC_ORIGIN)

    expect(sideEffect.action).toBe('created')
    expect(sideEffect.syncOrigin).toBe(SYNC_ORIGIN)
    expect(sideEffect.actorUserId).toBe(ACTOR_USER_ID)
    expect(sideEffect.events?.buildPayload?.(sideEffect)).toMatchObject({ syncOrigin: SYNC_ORIGIN })
  })

  it('forwards syncOrigin and actorUserId from customers.people.delete', async () => {
    const sideEffect = await runDelete(SYNC_ORIGIN)

    expect(sideEffect.action).toBe('deleted')
    expect(sideEffect.syncOrigin).toBe(SYNC_ORIGIN)
    expect(sideEffect.actorUserId).toBe(ACTOR_USER_ID)
    expect(sideEffect.events?.buildPayload?.(sideEffect)).toMatchObject({ syncOrigin: SYNC_ORIGIN })
  })
})
