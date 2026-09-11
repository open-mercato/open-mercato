jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (emInstance: EmLike, entity: unknown, filters: unknown, opts?: unknown) =>
    emInstance.find(entity, filters, opts),
  findOneWithDecryption: (emInstance: EmLike, entity: unknown, filters: unknown, opts?: unknown) =>
    emInstance.findOne(entity, filters, opts),
}))

import '@open-mercato/core/modules/customers/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { CustomerDeal, CustomerEntity, CustomerInteraction } from '../../data/entities'

type EmLike = {
  find: (...args: unknown[]) => Promise<unknown>
  findOne: (...args: unknown[]) => Promise<unknown>
}

type EmitCall = {
  event: string
  payload: Record<string, unknown>
}

const TENANT_ID = '99999999-9999-4999-8999-999999999999'
const ORG_ID = '88888888-8888-4888-8888-888888888888'
const INTERACTION_ID = '44444444-4444-4444-8444-444444444444'
const CURRENT_ENTITY_ID = '11111111-1111-4111-8111-111111111111'
const TARGET_ENTITY_ID = '22222222-2222-4222-8222-222222222222'
const DEAL_ENTITY_ID = '33333333-3333-4333-8333-333333333333'
const FOREIGN_ENTITY_ID = '55555555-5555-4555-8555-555555555555'

function createKyselyStub() {
  const chain: Record<string, unknown> = {}
  chain.select = jest.fn(() => chain)
  chain.selectAll = jest.fn(() => chain)
  chain.where = jest.fn(() => chain)
  chain.orderBy = jest.fn(() => chain)
  chain.limit = jest.fn(() => chain)
  chain.values = jest.fn(() => chain)
  chain.set = jest.fn(() => chain)
  chain.onConflict = jest.fn(() => chain)
  chain.returning = jest.fn(() => chain)
  chain.executeTakeFirst = jest.fn(async () => undefined)
  chain.execute = jest.fn(async () => [])
  return {
    selectFrom: jest.fn(() => chain),
    insertInto: jest.fn(() => chain),
    updateTable: jest.fn(() => chain),
    deleteFrom: jest.fn(() => chain),
  }
}

function createEntity(id: string, kind: string, organizationId = ORG_ID): CustomerEntity {
  return {
    id,
    kind,
    organizationId,
    tenantId: TENANT_ID,
    deletedAt: null,
  } as unknown as CustomerEntity
}

function createInteraction(entity: CustomerEntity): CustomerInteraction {
  return {
    id: INTERACTION_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    entity,
    interactionType: 'task',
    title: 'Follow up',
    body: null,
    status: 'planned',
    scheduledAt: new Date('2026-05-01T10:00:00.000Z'),
    occurredAt: null,
    priority: null,
    authorUserId: null,
    ownerUserId: null,
    dealId: null,
    source: null,
    appearanceIcon: null,
    appearanceColor: null,
    pinned: false,
    durationMinutes: null,
    location: null,
    allDay: null,
    recurrenceRule: null,
    recurrenceEnd: null,
    participants: null,
    reminderMinutes: null,
    visibility: null,
    linkedEntities: null,
    guestPermissions: null,
    createdAt: new Date('2026-04-10T08:00:00.000Z'),
    updatedAt: new Date('2026-04-10T08:00:00.000Z'),
    deletedAt: null,
  } as unknown as CustomerInteraction
}

function createHarness(interaction: CustomerInteraction, entities: CustomerEntity[]) {
  const emitCalls: EmitCall[] = []
  const recomputedEntityIds: string[] = []

  const kysely = createKyselyStub()
  const trackingKysely = {
    ...kysely,
    selectFrom: jest.fn((table: string) => {
      const chain = kysely.selectFrom(table) as Record<string, unknown>
      const where = chain.where as (...args: unknown[]) => unknown
      chain.where = jest.fn((column: string, op: string, value: unknown) => {
        if (table === 'customer_interactions' && column === 'entity_id' && typeof value === 'string') {
          recomputedEntityIds.push(value)
        }
        return where(column, op, value)
      })
      return chain
    }),
  }

  const em: Record<string, unknown> = {
    getKysely: jest.fn(() => trackingKysely),
    findOne: jest.fn(async (ctor: unknown, where: Record<string, unknown>) => {
      if (ctor === CustomerInteraction) {
        return where.id === interaction.id ? interaction : null
      }
      if (ctor === CustomerEntity) {
        return (
          entities.find(
            (candidate) =>
              candidate.id === where.id &&
              candidate.tenantId === where.tenantId &&
              candidate.organizationId === where.organizationId,
          ) ?? null
        )
      }
      if (ctor === CustomerDeal) {
        return where.id === DEAL_ENTITY_ID
          ? ({ id: DEAL_ENTITY_ID, tenantId: TENANT_ID, organizationId: ORG_ID, deletedAt: null } as unknown)
          : null
      }
      return null
    }),
    find: jest.fn(async () => []),
    nativeDelete: jest.fn(async () => {}),
    create: jest.fn((ctor: unknown, payload: Record<string, unknown>) => ({ __entity: ctor, ...payload })),
    persist: jest.fn(() => {}),
    flush: jest.fn(async () => {}),
    transactional: jest.fn(async (fn: (inner: unknown) => Promise<unknown>) => fn(em)),
    begin: jest.fn(async () => {}),
    commit: jest.fn(async () => {}),
    rollback: jest.fn(async () => {}),
    getReference: jest.fn(),
    remove: jest.fn(),
  }
  em.fork = jest.fn(() => em)

  const dataEngine: Pick<DataEngine, 'setCustomFields' | 'emitOrmEntityEvent'> & Record<string, unknown> = {
    setCustomFields: jest.fn(async () => {}),
    emitOrmEntityEvent: jest.fn(async () => {}),
  }
  dataEngine.markOrmEntityChange = jest.fn(() => {})
  dataEngine.flushOrmEntityChanges = jest.fn(async () => {})

  const eventBus = {
    emitEvent: jest.fn(async (event: string, payload: Record<string, unknown>) => {
      emitCalls.push({ event, payload })
    }),
  }

  const container = {
    resolve: (token: string) => {
      switch (token) {
        case 'em':
          return em
        case 'dataEngine':
          return dataEngine
        case 'eventBus':
          return eventBus
        default:
          throw new Error(`Unexpected dependency: ${token}`)
      }
    },
  }

  const ctx = {
    container,
    auth: { sub: null, tenantId: TENANT_ID, orgId: ORG_ID },
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: null,
    request: undefined,
  } as unknown as CommandRuntimeContext

  return { ctx, emitCalls, recomputedEntityIds }
}

function nextInteractionTargets(emitCalls: EmitCall[]): string[] {
  return emitCalls
    .filter((call) => call.event === 'customers.next_interaction.updated')
    .map((call) => String(call.payload.entityId))
}

describe('customers.interactions.update — re-linking to a different CRM record (#5938)', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  function handler(): CommandHandler {
    const found = commandRegistry.get('customers.interactions.update') as CommandHandler
    expect(found).toBeDefined()
    return found
  }

  it('re-attaches the interaction to the requested person', async () => {
    const current = createEntity(CURRENT_ENTITY_ID, 'company')
    const target = createEntity(TARGET_ENTITY_ID, 'person')
    const interaction = createInteraction(current)
    const { ctx } = createHarness(interaction, [current, target])

    await handler().execute!(
      { id: INTERACTION_ID, tenantId: TENANT_ID, organizationId: ORG_ID, entityId: TARGET_ENTITY_ID },
      ctx,
    )

    expect(interaction.entity).toBe(target)
  })

  it('recomputes the next interaction for both the old and the new entity', async () => {
    const current = createEntity(CURRENT_ENTITY_ID, 'company')
    const target = createEntity(TARGET_ENTITY_ID, 'person')
    const interaction = createInteraction(current)
    const { ctx, emitCalls, recomputedEntityIds } = createHarness(interaction, [current, target])

    await handler().execute!(
      { id: INTERACTION_ID, tenantId: TENANT_ID, organizationId: ORG_ID, entityId: TARGET_ENTITY_ID },
      ctx,
    )

    expect(recomputedEntityIds).toEqual(expect.arrayContaining([CURRENT_ENTITY_ID, TARGET_ENTITY_ID]))
    expect(nextInteractionTargets(emitCalls).sort()).toEqual([CURRENT_ENTITY_ID, TARGET_ENTITY_ID].sort())
  })

  it('leaves the link untouched and recomputes once when entityId is omitted', async () => {
    const current = createEntity(CURRENT_ENTITY_ID, 'company')
    const interaction = createInteraction(current)
    const { ctx, emitCalls, recomputedEntityIds } = createHarness(interaction, [current])

    await handler().execute!(
      { id: INTERACTION_ID, tenantId: TENANT_ID, organizationId: ORG_ID, title: 'Renamed' },
      ctx,
    )

    expect(interaction.entity).toBe(current)
    expect(interaction.title).toBe('Renamed')
    expect(recomputedEntityIds).toEqual([CURRENT_ENTITY_ID])
    expect(nextInteractionTargets(emitCalls)).toEqual([CURRENT_ENTITY_ID])
  })

  it('treats re-sending the current entityId as a no-op', async () => {
    const current = createEntity(CURRENT_ENTITY_ID, 'company')
    const interaction = createInteraction(current)
    const { ctx, emitCalls } = createHarness(interaction, [current])

    await handler().execute!(
      { id: INTERACTION_ID, tenantId: TENANT_ID, organizationId: ORG_ID, entityId: CURRENT_ENTITY_ID },
      ctx,
    )

    expect(interaction.entity).toBe(current)
    expect(nextInteractionTargets(emitCalls)).toEqual([CURRENT_ENTITY_ID])
  })

  it('rejects an entity that belongs to another organization', async () => {
    const current = createEntity(CURRENT_ENTITY_ID, 'company')
    const foreign = createEntity(FOREIGN_ENTITY_ID, 'person', '77777777-7777-4777-8777-777777777777')
    const interaction = createInteraction(current)
    const { ctx } = createHarness(interaction, [current, foreign])

    await expect(
      handler().execute!(
        { id: INTERACTION_ID, tenantId: TENANT_ID, organizationId: ORG_ID, entityId: FOREIGN_ENTITY_ID },
        ctx,
      ),
    ).rejects.toBeDefined()
    expect(interaction.entity).toBe(current)
  })

  it('rejects re-linking to a deal instead of a person or company', async () => {
    const current = createEntity(CURRENT_ENTITY_ID, 'company')
    const interaction = createInteraction(current)
    const { ctx } = createHarness(interaction, [current])

    await expect(
      handler().execute!(
        { id: INTERACTION_ID, tenantId: TENANT_ID, organizationId: ORG_ID, entityId: DEAL_ENTITY_ID },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 422 })
    expect(interaction.entity).toBe(current)
  })
})
