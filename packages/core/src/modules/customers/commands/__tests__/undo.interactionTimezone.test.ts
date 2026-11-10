jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (em: QueryManager, entity: unknown, filters: unknown, options?: unknown) =>
    em.find(entity, filters, options),
  findOneWithDecryption: (em: QueryManager, entity: unknown, filters: unknown, options?: unknown) =>
    em.findOne(entity, filters, options),
}))

import '@open-mercato/core/modules/customers/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext, CommandUndoLogEntry } from '@open-mercato/shared/lib/commands'
import {
  CustomerCompanyProfile,
  CustomerEntity,
  CustomerInteraction,
  CustomerPersonProfile,
} from '../../data/entities'

type Kind = 'person' | 'company'
type RecordValues = Record<string, unknown>
type QueryManager = {
  find: (entity: unknown, filters: unknown, options?: unknown) => Promise<RecordValues[]>
  findOne: (entity: unknown, filters: unknown, options?: unknown) => Promise<RecordValues | null>
}
type Snapshot = { interactions: RecordValues[] }

const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111'
const ENTITY_ID = '33333333-3333-4333-8333-333333333333'
const PROFILE_ID = '44444444-4444-4444-8444-444444444444'
const INTERACTION_ID = '55555555-5555-4555-8555-555555555555'
const SCHEDULED_AT = '2026-10-21T22:30:00.000Z'

function createManager(kind: Kind, timezone: string | null) {
  const entity: RecordValues = {
    id: ENTITY_ID,
    organizationId: ORGANIZATION_ID,
    tenantId: TENANT_ID,
    kind,
    displayName: 'Timezone parent',
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
    deletedAt: null,
  }
  const profile: RecordValues = {
    id: PROFILE_ID,
    entity,
    firstName: 'Timezone',
    lastName: 'Parent',
    company: null,
    timezone: null,
  }
  const interaction: RecordValues = {
    id: INTERACTION_ID,
    entity,
    organizationId: ORGANIZATION_ID,
    tenantId: TENANT_ID,
    interactionType: 'meeting',
    title: 'Sydney sync',
    status: 'planned',
    scheduledAt: new Date(SCHEDULED_AT),
    timezone,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
  }
  const profileConstructor = kind === 'person' ? CustomerPersonProfile : CustomerCompanyProfile
  const state = {
    entity: entity as RecordValues | null,
    profile: profile as RecordValues | null,
    interactions: [interaction],
  }
  const query: Record<string, jest.Mock> = {}
  for (const method of ['select', 'selectAll', 'where', 'orderBy', 'limit', 'offset', 'values', 'set', 'onConflict', 'returning', 'innerJoin', 'leftJoin']) {
    query[method] = jest.fn(() => query)
  }
  query.executeTakeFirst = jest.fn(async () => undefined)
  query.execute = jest.fn(async () => [])
  const manager = {
    fork: jest.fn(),
    findOne: jest.fn(async (constructor: unknown) => {
      if (constructor === CustomerEntity) return state.entity
      if (constructor === profileConstructor) return state.profile
      return null
    }),
    find: jest.fn(async (constructor: unknown) => constructor === CustomerInteraction ? state.interactions : []),
    count: jest.fn(async () => 0),
    create: jest.fn((constructor: unknown, values: RecordValues) => {
      const created = { ...values }
      if (constructor === CustomerEntity) state.entity = created
      if (constructor === profileConstructor) state.profile = created
      if (constructor === CustomerInteraction) state.interactions.push(created)
      return created
    }),
    persist: jest.fn(),
    remove: jest.fn(),
    nativeDelete: jest.fn(async (constructor: unknown) => {
      if (constructor === CustomerInteraction) state.interactions = []
      return 0
    }),
    nativeUpdate: jest.fn(async () => 0),
    getReference: jest.fn((_constructor: unknown, id: string) => ({ id })),
    flush: jest.fn(async () => undefined),
    begin: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
    transactional: jest.fn(),
    getKysely: () => ({
      selectFrom: jest.fn(() => query),
      insertInto: jest.fn(() => query),
      updateTable: jest.fn(() => query),
      deleteFrom: jest.fn(() => query),
    }),
  }
  manager.fork.mockReturnValue(manager)
  manager.transactional.mockImplementation(async (callback: (inner: unknown) => Promise<unknown>) => callback(manager))
  return { manager, state }
}

function createContext(manager: unknown): CommandRuntimeContext {
  const dataEngine = {
    setCustomFields: jest.fn(async () => undefined),
    emitOrmEntityEvent: jest.fn(async () => undefined),
    markOrmEntityChange: jest.fn(),
    flushOrmEntityChanges: jest.fn(async () => undefined),
  }
  return {
    container: {
      resolve: (key: string) => {
        if (key === 'em') return manager
        if (key === 'dataEngine') return dataEngine
        if (key === 'eventBus') return { emitEvent: jest.fn(async () => undefined) }
        throw new Error(`[internal] Unexpected dependency ${key}`)
      },
    } as unknown as CommandRuntimeContext['container'],
    auth: { sub: 'actor-user', tenantId: TENANT_ID, orgId: ORGANIZATION_ID } as CommandRuntimeContext['auth'],
    selectedOrganizationId: ORGANIZATION_ID,
    organizationScope: null,
    organizationIds: null,
    request: undefined,
  }
}

async function prepareDelete(kind: Kind, timezone: string | null) {
  const { manager, state } = createManager(kind, timezone)
  const context = createContext(manager)
  const commandId = `customers.${kind === 'person' ? 'people' : 'companies'}.delete`
  const handler = commandRegistry.get(commandId) as CommandHandler
  const input = { body: { id: ENTITY_ID } }
  const snapshots = await handler.prepare!(input, context)
  expect(snapshots?.before).toBeDefined()
  const log = await handler.buildLog!({ input, result: undefined, ctx: context, snapshots: snapshots! })
  expect(log).toBeTruthy()
  const logEntry = JSON.parse(JSON.stringify({
    resourceId: log!.resourceId,
    commandPayload: log!.payload,
    snapshotBefore: log!.snapshotBefore,
  })) as CommandUndoLogEntry
  state.entity = null
  state.profile = null
  state.interactions = []
  return { handler, input, context, state, logEntry }
}

function expectRestoredInteraction(interactions: RecordValues[], timezone: string | null) {
  expect(interactions).toEqual([expect.objectContaining({ id: INTERACTION_ID, timezone })])
  const scheduledAt = interactions[0].scheduledAt
  const scheduledInstant = scheduledAt instanceof Date ? scheduledAt : new Date(String(scheduledAt))
  expect(scheduledInstant.toISOString()).toBe(SCHEDULED_AT)
}

describe.each<Kind>(['person', 'company'])('customers %s delete undo preserves interaction timezone (#7313)', (kind) => {
  afterEach(() => jest.clearAllMocks())

  it.each(['Australia/Sydney', null])('round-trips timezone %s through the persisted delete snapshot', async (timezone) => {
    const { handler, input, context, state, logEntry } = await prepareDelete(kind, timezone)
    await handler.undo!({ input, ctx: context, logEntry })

    const snapshot = logEntry.snapshotBefore as Snapshot
    expect(snapshot.interactions).toEqual([expect.objectContaining({
      id: INTERACTION_ID,
      scheduledAt: SCHEDULED_AT,
      timezone,
    })])
    expectRestoredInteraction(state.interactions, timezone)
  })

  it('restores historical interaction snapshots without timezone as null', async () => {
    const { handler, input, context, state, logEntry } = await prepareDelete(kind, null)
    const payload = logEntry.commandPayload as { undo: { before: Snapshot } }
    delete payload.undo.before.interactions[0].timezone
    delete (logEntry.snapshotBefore as Snapshot).interactions[0].timezone

    await handler.undo!({ input, ctx: context, logEntry })

    expectRestoredInteraction(state.interactions, null)
  })
})
