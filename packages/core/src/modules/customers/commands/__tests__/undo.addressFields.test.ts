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
  CustomerAddress,
  CustomerCompanyProfile,
  CustomerEntity,
  CustomerPersonProfile,
} from '../../data/entities'

type Kind = 'person' | 'company'
type RecordValues = Record<string, unknown>
type QueryManager = {
  find: (entity: unknown, filters: unknown, options?: unknown) => Promise<RecordValues[]>
  findOne: (entity: unknown, filters: unknown, options?: unknown) => Promise<RecordValues | null>
}
type Snapshot = { addresses: RecordValues[] }

const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111'
const ENTITY_ID = '33333333-3333-4333-8333-333333333333'
const PROFILE_ID = '44444444-4444-4444-8444-444444444444'
const ADDRESS_ID = '55555555-5555-4555-8555-555555555555'
const DELIVERY_KEYS = ['companyName', 'buildingNumber', 'flatNumber'] as const
const ADDRESS_FIELDS = {
  id: ADDRESS_ID,
  name: 'Warehouse',
  purpose: 'shipping',
  addressLine1: 'Delivery Street',
  addressLine2: 'North entrance',
  city: 'Warsaw',
  region: 'Mazowieckie',
  postalCode: '00-001',
  country: 'PL',
  latitude: 52.23,
  longitude: 21.01,
  isPrimary: true,
}

function createManager(kind: Kind, populated: boolean) {
  const entity: RecordValues = {
    id: ENTITY_ID,
    organizationId: ORGANIZATION_ID,
    tenantId: TENANT_ID,
    kind,
    displayName: 'Address parent',
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
    firstName: 'Address',
    lastName: 'Parent',
    company: null,
    timezone: null,
  }
  const deliveryFields = {
    companyName: populated ? 'Delivery Ltd' : null,
    buildingNumber: populated ? '42' : null,
    flatNumber: populated ? '7' : null,
  }
  const address: RecordValues = {
    ...ADDRESS_FIELDS,
    ...deliveryFields,
    entity,
    organizationId: ORGANIZATION_ID,
    tenantId: TENANT_ID,
  }
  const profileConstructor = kind === 'person' ? CustomerPersonProfile : CustomerCompanyProfile
  const state = {
    entity: entity as RecordValues | null,
    profile: profile as RecordValues | null,
    addresses: [address],
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
    find: jest.fn(async (constructor: unknown) => constructor === CustomerAddress ? state.addresses : []),
    count: jest.fn(async () => 0),
    create: jest.fn((constructor: unknown, values: RecordValues) => {
      const created = { ...values }
      if (constructor === CustomerEntity) state.entity = created
      if (constructor === profileConstructor) state.profile = created
      if (constructor === CustomerAddress) state.addresses.push(created)
      return created
    }),
    persist: jest.fn(),
    remove: jest.fn((record: unknown) => {
      if (record === state.entity) state.entity = null
      if (record === state.profile) state.profile = null
    }),
    nativeDelete: jest.fn(async (constructor: unknown) => {
      if (constructor === CustomerAddress) state.addresses = []
      if (constructor === profileConstructor) state.profile = null
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
  return { manager, state, deliveryFields }
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

async function deleteParent(kind: Kind, populated: boolean) {
  const { manager, state, deliveryFields } = createManager(kind, populated)
  const context = createContext(manager)
  const commandId = `customers.${kind === 'person' ? 'people' : 'companies'}.delete`
  const handler = commandRegistry.get(commandId) as CommandHandler
  const input = { body: { id: ENTITY_ID } }
  const snapshots = await handler.prepare!(input, context)
  expect(snapshots?.before).toBeDefined()
  const result = await handler.execute(input, context)
  expect(state.entity).toBeNull()
  expect(state.addresses).toEqual([])
  const log = await handler.buildLog!({ input, result, ctx: context, snapshots: snapshots! })
  expect(log).toBeTruthy()
  const logEntry = JSON.parse(JSON.stringify({
    resourceId: log!.resourceId,
    commandPayload: log!.payload,
    snapshotBefore: log!.snapshotBefore,
  })) as CommandUndoLogEntry
  return { handler, input, context, state, deliveryFields, logEntry }
}

describe.each<Kind>(['person', 'company'])('customers %s delete undo preserves address fields (#7854)', (kind) => {
  afterEach(() => jest.clearAllMocks())

  it.each([true, false])('round-trips populated delivery fields: %s through the persisted delete snapshot', async (populated) => {
    const { handler, input, context, state, deliveryFields, logEntry } = await deleteParent(kind, populated)
    const snapshot = logEntry.snapshotBefore as Snapshot
    expect(snapshot.addresses).toEqual([{ ...ADDRESS_FIELDS, ...deliveryFields }])

    await handler.undo!({ input, ctx: context, logEntry })

    expect(state.addresses).toEqual([{
      ...ADDRESS_FIELDS,
      ...deliveryFields,
      organizationId: ORGANIZATION_ID,
      tenantId: TENANT_ID,
      entity: state.entity,
    }])
  })

  it('restores historical address snapshots without delivery fields as null', async () => {
    const { handler, input, context, state, logEntry } = await deleteParent(kind, false)
    const payload = logEntry.commandPayload as { undo: { before: Snapshot } }
    for (const key of DELIVERY_KEYS) {
      delete payload.undo.before.addresses[0][key]
      delete (logEntry.snapshotBefore as Snapshot).addresses[0][key]
    }

    await handler.undo!({ input, ctx: context, logEntry })

    expect(state.addresses).toEqual([{
      ...ADDRESS_FIELDS,
      companyName: null,
      buildingNumber: null,
      flatNumber: null,
      organizationId: ORGANIZATION_ID,
      tenantId: TENANT_ID,
      entity: state.entity,
    }])
  })
})
