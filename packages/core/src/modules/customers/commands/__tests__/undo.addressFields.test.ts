jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

import '@open-mercato/core/modules/customers/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext, CommandUndoLogEntry } from '@open-mercato/shared/lib/commands'
import {
  CustomerAddress,
  CustomerCompanyProfile,
  CustomerComment,
  CustomerInteraction,
  CustomerEntity,
  CustomerPersonProfile,
} from '../../data/entities'

import { encryptWithAesGcm, decryptWithAesGcm, generateDek } from '@open-mercato/shared/lib/encryption/aes'
import { registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import * as encryptionServices from '@open-mercato/shared/lib/encryption/customFieldValues'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { defaultEncryptionMaps } from '../../encryption'

type Kind = 'person' | 'company'
type RecordValues = Record<string, unknown>
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

function createManager(kind: Kind, populated: boolean, encrypted = false) {
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
  const comment: RecordValues = { id: 'comment-1', entity, body: 'Private note', tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }
  const interaction: RecordValues = { id: 'interaction-1', entity, interactionType: 'call', title: 'Private call', body: 'Call notes', status: 'completed', tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }
  const profileConstructor = kind === 'person' ? CustomerPersonProfile : CustomerCompanyProfile
  const fieldMaps = new Map(defaultEncryptionMaps.map((map) => [map.entityId, map.fields]))
  const key = generateDek()
  const records: Array<[RecordValues, string, string]> = [
    [entity, 'CustomerEntity', 'customers:customer_entity'],
    [profile, profileConstructor.name, kind === 'person' ? 'customers:customer_person_profile' : 'customers:customer_company_profile'],
    [address, 'CustomerAddress', 'customers:customer_address'],
    [comment, 'CustomerComment', 'customers:customer_comment'],
    [interaction, 'CustomerInteraction', 'customers:customer_interaction'],
  ]
  for (const [record, className, entityId] of records) {
    Object.defineProperty(record, '__meta', { value: { className, properties: {} } })
    if (!encrypted) continue
    for (const { field } of fieldMaps.get(entityId) ?? []) {
      const property = field.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase())
      if (typeof record[property] === 'string') record[property] = encryptWithAesGcm(record[property], key).value
    }
  }
  const decryptEntityPayload = jest.fn(async (entityId: string, target: RecordValues) => {
    const decrypted: RecordValues = {}
    for (const { field } of fieldMaps.get(entityId) ?? []) {
      const property = field.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase())
      if (typeof target[property] === 'string') decrypted[property] = decryptWithAesGcm(target[property], key) ?? target[property]
    }
    return decrypted
  })
  jest.spyOn(encryptionServices, 'resolveTenantEncryptionService').mockReturnValue({
    isEnabled: () => true,
    decryptEntityPayload,
  } as unknown as TenantDataEncryptionService)
  const state = {
    entity: entity as RecordValues | null,
    profile: profile as RecordValues | null,
    addresses: [address],
    comments: encrypted ? [comment] : [],
    interactions: encrypted ? [interaction] : [],
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
    find: jest.fn(async (constructor: unknown) => {
      if (constructor === CustomerAddress) return state.addresses
      if (constructor === CustomerComment) return state.comments
      if (constructor === CustomerInteraction) return state.interactions
      return []
    }),
    count: jest.fn(async () => 0),
    create: jest.fn((constructor: unknown, values: RecordValues) => {
      const created = { ...values }
      if (constructor === CustomerEntity) state.entity = created
      if (constructor === profileConstructor) state.profile = created
      if (constructor === CustomerAddress) state.addresses.push(created)
      if (constructor === CustomerComment) state.comments.push(created)
      if (constructor === CustomerInteraction) state.interactions.push(created)
      return created
    }),
    persist: jest.fn(),
    remove: jest.fn((record: unknown) => {
      if (record === state.entity) state.entity = null
      if (record === state.profile) state.profile = null
    }),
    nativeDelete: jest.fn(async (constructor: unknown) => {
      if (constructor === CustomerAddress) state.addresses = []
      if (constructor === CustomerComment) state.comments = []
      if (constructor === CustomerInteraction) state.interactions = []
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
  return { manager, state, deliveryFields, decryptEntityPayload }
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

async function deleteParent(kind: Kind, populated: boolean, encrypted = false) {
  const { manager, state, deliveryFields, decryptEntityPayload } = createManager(kind, populated, encrypted)
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
  return { handler, input, context, state, deliveryFields, logEntry, decryptEntityPayload }
}

describe.each<Kind>(['person', 'company'])('customers %s delete undo preserves address fields (#7854)', (kind) => {
  const originalEncryption = process.env.TENANT_DATA_ENCRYPTION

  beforeEach(() => {
    process.env.TENANT_DATA_ENCRYPTION = 'true'
    registerEntityIds({ customers: Object.fromEntries(defaultEncryptionMaps.map((map) => [map.entityId.split(':')[1], map.entityId])) })
  })

  afterEach(() => {
    jest.restoreAllMocks()
    if (originalEncryption === undefined) delete process.env.TENANT_DATA_ENCRYPTION
    else process.env.TENANT_DATA_ENCRYPTION = originalEncryption
  })

  it.each(['tenant', 'organization'])('refuses a foreign %s before decrypting child snapshots (#2115)', async (foreignScope) => {
    const { manager, decryptEntityPayload } = createManager(kind, true, true)
    const context = createContext(manager)
    if (foreignScope === 'tenant') {
      context.auth = { ...context.auth, tenantId: '99999999-9999-4999-8999-999999999999' } as CommandRuntimeContext['auth']
    } else {
      context.selectedOrganizationId = '88888888-8888-4888-8888-888888888888'
    }
    const handler = commandRegistry.get(`customers.${kind === 'person' ? 'people' : 'companies'}.delete`) as CommandHandler

    await expect(handler.prepare!({ body: { id: ENTITY_ID } }, context)).rejects.toMatchObject({ status: 403 })

    expect(decryptEntityPayload.mock.calls.some(([entityId]) => entityId !== 'customers:customer_entity')).toBe(false)
  })

  it('restores plaintext addresses from an encrypted delete snapshot without an ORM subscriber (#2115)', async () => {
    const { handler, input, context, state, logEntry, decryptEntityPayload } = await deleteParent(kind, true, true)
    const snapshot = logEntry.snapshotBefore as Snapshot & { entity: { displayName: string } }
    expect(snapshot.entity.displayName).toBe('Address parent')
    expect(logEntry.snapshotBefore).toMatchObject({ comments: [{ body: 'Private note' }], interactions: [{ title: 'Private call', body: 'Call notes' }] })
    expect(snapshot.addresses).toEqual([{ ...ADDRESS_FIELDS, companyName: 'Delivery Ltd', buildingNumber: '42', flatNumber: '7' }])
    expect(decryptEntityPayload).toHaveBeenCalledWith('customers:customer_address', expect.anything(), TENANT_ID, ORGANIZATION_ID, expect.anything())

    await handler.undo!({ input, ctx: context, logEntry })

    expect(state.addresses[0]).toMatchObject({ addressLine1: 'Delivery Street', companyName: 'Delivery Ltd', buildingNumber: '42', flatNumber: '7' })
    expect(state.entity?.displayName).toBe('Address parent')
    expect(state.comments).toMatchObject([{ body: 'Private note' }])
    expect(state.interactions).toMatchObject([{ title: 'Private call', body: 'Call notes' }])
  })

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
