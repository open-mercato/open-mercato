const mockRecordIndexerError = jest.fn(async () => undefined)

jest.mock('@open-mercato/shared/lib/indexers/error-log', () => ({
  recordIndexerError: (...args: unknown[]) => mockRecordIndexerError(...args),
}))

jest.mock('@open-mercato/shared/lib/query/engine', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/query/engine')
  return {
    ...actual,
    BasicQueryEngine: jest.fn().mockImplementation(() => ({})),
  }
})

import type { SubscriberHandler } from '@open-mercato/events'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CRUD_QUERY_INDEX_MANAGED_PAYLOAD_KEY } from '@open-mercato/shared/lib/crud/types'
import { registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { QueryIndexScopeError } from '../lib/subscriber-scope'
import { register, setupQueryIndexCrudBridge } from '../di'
import { getProcessDiRegistrar, runProcessEventSetups } from '@open-mercato/shared/lib/di/process-registrar'
import { asValue, createContainer } from 'awilix'

type MetadataShape = {
  className: string
  tableName: string
  properties: Record<string, { fieldNames: string[] }>
}

function createMetadata(input: {
  className: string
  tableName: string
  organizationColumn?: string
  tenantColumn?: string
}): MetadataShape {
  const properties: MetadataShape['properties'] = {}
  if (input.organizationColumn) properties.organizationId = { fieldNames: [input.organizationColumn] }
  if (input.tenantColumn) properties.tenantId = { fieldNames: [input.tenantColumn] }
  return { className: input.className, tableName: input.tableName, properties }
}

function makeBuilder(manyResult: unknown[] = [], oneResult?: unknown) {
  const builder: Record<string, jest.Mock> = {
    select: jest.fn(() => builder),
    distinct: jest.fn(() => builder),
    where: jest.fn(() => builder),
    execute: jest.fn(async () => manyResult),
    executeTakeFirst: jest.fn(async () => oneResult),
  }
  return builder
}

async function flushRegistration() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function createBridgeHarness(input: {
  entityType: string
  metadata?: MetadataShape
  sourceRow?: Record<string, string | null>
  hasCustomField?: boolean
  customEntity?: boolean
  indexed?: boolean
}) {
  const handlers = new Map<string, (payload: unknown, ctx: unknown) => Promise<void>>()
  const emitEvent = jest.fn(async () => {})
  const eventBus = {
    on: jest.fn((event: string, handler: (payload: unknown, ctx: unknown) => Promise<void>) => {
      handlers.set(event, handler)
    }),
    emitEvent,
  }
  const customFieldBuilder = makeBuilder(
    [{ entity_id: input.entityType }],
    input.hasCustomField === false ? undefined : { id: 'field-1' },
  )
  const sourceBuilder = makeBuilder([], input.sourceRow)
  const db = {
    selectFrom: jest.fn((table: string) => {
      if (table === 'custom_entities') return makeBuilder([], input.customEntity ? { id: 'custom' } : undefined)
      if (table === 'entity_indexes') return makeBuilder([], input.indexed ? { id: 'index' } : undefined)
      if (table === 'custom_field_defs') return customFieldBuilder
      if (table === input.metadata?.tableName) return sourceBuilder
      throw new Error(`Unexpected table: ${table}`)
    }),
  }
  const metadata = input.metadata ? [input.metadata] : []
  const em = {
    getKysely: () => db,
    getMetadata: () => ({
      find: (className: string) => metadata.find((candidate) => candidate.className === className),
      getAll: () => metadata,
    }),
  } as unknown as EntityManager
  const container = {
    resolve: jest.fn((name: string) => {
      if (name === 'em') return em
      if (name === 'eventBus') return eventBus
      return null
    }),
    register: jest.fn(),
  }
  return { handlers, emitEvent, db, sourceBuilder, em, container }
}

const globalMetadata = createMetadata({
  className: 'FeatureToggle',
  tableName: 'feature_toggles',
})

const scopedMetadata = createMetadata({
  className: 'CustomerPerson',
  tableName: 'customer_people',
  organizationColumn: 'organization_id',
  tenantColumn: 'tenant_id',
})

describe('query_index DI CRUD bridge', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    registerEntityIds({
      feature_toggles: { feature_toggle: 'feature_toggles:feature_toggle' },
      customers: { customer_person: 'customers:customer_person' },
    })
  })

  afterAll(() => {
    registerEntityIds({})
  })

  it('does not duplicate upsert or delete work owned by the data engine', async () => {
    const entityType = 'customers:customer_person'
    const { handlers, emitEvent, container } = createBridgeHarness({
      entityType,
      metadata: scopedMetadata,
      sourceRow: { organization_id: 'org-1', tenant_id: 'tenant-1' },
    })

    register(container as never)
    await flushRegistration()

    for (const eventName of ['customers.customer_person.created', 'customers.customer_person.deleted']) {
      const handler = handlers.get(eventName)
      expect(handler).toBeDefined()
      await handler!({
        id: 'person-1',
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        [CRUD_QUERY_INDEX_MANAGED_PAYLOAD_KEY]: true,
      }, {
        resolve: container.resolve,
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      })
    }

    expect(emitEvent).not.toHaveBeenCalled()
    expect(mockRecordIndexerError).not.toHaveBeenCalled()
  })

  it('fills omitted delete scope from the source row instead of actor context', async () => {
    const entityType = 'customers:customer_person'
    const { handlers, emitEvent, container } = createBridgeHarness({
      entityType,
      metadata: scopedMetadata,
      sourceRow: { organization_id: 'row-org', tenant_id: 'row-tenant' },
    })
    register(container as never)
    await flushRegistration()

    const handler = handlers.get('customers.customer_person.deleted')
    expect(handler).toBeDefined()
    await handler!({ id: 'person-1' }, {
      resolve: container.resolve,
      tenantId: 'actor-tenant',
      organizationId: 'actor-org',
    })

    expect(emitEvent).toHaveBeenCalledWith('query_index.delete_one', {
      entityType,
      recordId: 'person-1',
      organizationId: 'row-org',
      tenantId: 'row-tenant',
    })
  })

  it.each([
    ['created', 'upsert_one'],
    ['deleted', 'delete_one'],
  ])('forwards complete payload scope for %s events without duplicating the downstream source lookup', async (action, targetEvent) => {
    const entityType = 'customers:customer_person'
    const { handlers, emitEvent, sourceBuilder, container } = createBridgeHarness({
      entityType,
      metadata: scopedMetadata,
    })
    register(container as never)
    await flushRegistration()

    const handler = handlers.get(`customers.customer_person.${action}`)
    expect(handler).toBeDefined()
    await handler!({ id: 'person-1', organizationId: 'payload-org', tenantId: 'payload-tenant' }, {
      resolve: container.resolve,
      tenantId: 'actor-tenant',
      organizationId: 'actor-org',
    })

    expect(sourceBuilder.select).not.toHaveBeenCalled()
    expect(emitEvent).toHaveBeenCalledWith(`query_index.${targetEvent}`, {
      entityType,
      recordId: 'person-1',
      organizationId: 'payload-org',
      tenantId: 'payload-tenant',
    })
  })

  it.each([
    [
      'a mismatched complete payload',
      { organization_id: 'row-org', tenant_id: 'row-tenant' },
      { organizationId: 'other-org', tenantId: 'other-tenant' },
    ],
    [
      'a missing source row with complete payload scope',
      undefined,
      { organizationId: 'payload-org', tenantId: 'payload-tenant' },
    ],
  ])('validates %s before returning when no scoped custom field exists', async (_label, sourceRow, scope) => {
    const entityType = 'customers:customer_person'
    const { handlers, emitEvent, container } = createBridgeHarness({
      entityType,
      metadata: scopedMetadata,
      sourceRow,
      hasCustomField: false,
    })
    register(container as never)
    await flushRegistration()

    const handler = handlers.get('customers.customer_person.created')
    expect(handler).toBeDefined()
    await handler!({ id: 'person-1', ...scope }, {
      resolve: container.resolve,
      tenantId: 'actor-tenant',
      organizationId: 'actor-org',
    })

    expect(emitEvent).not.toHaveBeenCalled()
    expect(mockRecordIndexerError).toHaveBeenCalledWith(
      expect.objectContaining({ em: expect.anything() }),
      expect.objectContaining({
        handler: 'event:query_index.crud_bridge.upsert',
        error: expect.any(QueryIndexScopeError),
        entityType,
        recordId: 'person-1',
      }),
    )
  })

  it.each([
    ['created', 'upsert_one'],
    ['deleted', 'delete_one'],
  ])('uses global source metadata for %s events without reading nonexistent scope columns', async (action, targetEvent) => {
    const entityType = 'feature_toggles:feature_toggle'
    const { handlers, emitEvent, db, container } = createBridgeHarness({ entityType, metadata: globalMetadata })
    register(container as never)
    await flushRegistration()

    const handler = handlers.get(`feature_toggles.feature_toggle.${action}`)
    expect(handler).toBeDefined()
    await handler!({ id: 'toggle-1' }, {
      resolve: container.resolve,
      tenantId: 'actor-tenant',
      organizationId: 'actor-org',
    })

    expect(db.selectFrom).not.toHaveBeenCalledWith('feature_toggles')
    expect(emitEvent).toHaveBeenCalledWith(`query_index.${targetEvent}`, {
      entityType,
      recordId: 'toggle-1',
      organizationId: null,
      tenantId: null,
    })
    expect(mockRecordIndexerError).not.toHaveBeenCalled()
  })

  it.each([
    ['created', 'upsert', { organizationId: 'org-1' }],
    ['deleted', 'delete', { tenantId: 'tenant-1' }],
  ])('rejects partial non-null global scope on %s events', async (action, handlerName, scope) => {
    const entityType = 'feature_toggles:feature_toggle'
    const { handlers, emitEvent, container } = createBridgeHarness({ entityType, metadata: globalMetadata })
    register(container as never)
    await flushRegistration()

    const handler = handlers.get(`feature_toggles.feature_toggle.${action}`)
    expect(handler).toBeDefined()
    await handler!({ id: 'toggle-1', ...scope }, {
      resolve: container.resolve,
      tenantId: null,
      organizationId: null,
    })

    expect(emitEvent).not.toHaveBeenCalled()
    expect(mockRecordIndexerError).toHaveBeenCalledWith(
      expect.objectContaining({ em: expect.anything() }),
      expect.objectContaining({
        handler: `event:query_index.crud_bridge.${handlerName}`,
        error: expect.any(QueryIndexScopeError),
        entityType,
        recordId: 'toggle-1',
      }),
    )
  })

  it('treats malformed payload scope as absent and derives scoped rows from metadata', async () => {
    const entityType = 'customers:customer_person'
    const { handlers, emitEvent, sourceBuilder, container } = createBridgeHarness({
      entityType,
      metadata: scopedMetadata,
      sourceRow: { organization_id: 'row-org', tenant_id: 'row-tenant' },
    })
    register(container as never)
    await flushRegistration()

    const handler = handlers.get('customers.customer_person.created')
    expect(handler).toBeDefined()
    await handler!({ id: 'person-1', organizationId: '   ', tenantId: { malformed: true } }, {
      resolve: container.resolve,
      tenantId: 'actor-tenant',
      organizationId: 'actor-org',
    })

    expect(sourceBuilder.select).toHaveBeenCalledWith(['organization_id', 'tenant_id'])
    expect(emitEvent).toHaveBeenCalledWith('query_index.upsert_one', {
      entityType,
      recordId: 'person-1',
      organizationId: 'row-org',
      tenantId: 'row-tenant',
    })
  })

  it('does not use event context when an upsert source row is missing', async () => {
    const entityType = 'customers:customer_person'
    const { handlers, emitEvent, container } = createBridgeHarness({
      entityType,
      metadata: scopedMetadata,
    })
    register(container as never)
    await flushRegistration()

    const handler = handlers.get('customers.customer_person.created')
    expect(handler).toBeDefined()
    await handler!({ id: 'person-1' }, {
      resolve: container.resolve,
      tenantId: 'actor-tenant',
      organizationId: 'actor-org',
    })

    expect(emitEvent).not.toHaveBeenCalled()
    expect(mockRecordIndexerError).toHaveBeenCalledWith(
      expect.objectContaining({ em: expect.anything() }),
      expect.objectContaining({
        handler: 'event:query_index.crud_bridge.upsert',
        error: expect.any(QueryIndexScopeError),
        entityType,
        recordId: 'person-1',
      }),
    )
  })

  it('does not treat default null event context as explicit scope for a missing delete row', async () => {
    const entityType = 'customers:customer_person'
    const { handlers, emitEvent, container } = createBridgeHarness({
      entityType,
      metadata: scopedMetadata,
    })
    register(container as never)
    await flushRegistration()

    const handler = handlers.get('customers.customer_person.deleted')
    expect(handler).toBeDefined()
    await handler!({ id: 'person-1' }, {
      resolve: container.resolve,
      tenantId: null,
      organizationId: null,
    })

    expect(emitEvent).not.toHaveBeenCalled()
    expect(mockRecordIndexerError).toHaveBeenCalledWith(
      expect.objectContaining({ em: expect.anything() }),
      expect.objectContaining({
        handler: 'event:query_index.crud_bridge.delete',
        error: expect.any(QueryIndexScopeError),
        entityType,
        recordId: 'person-1',
      }),
    )
  })

  it('records scope resolution failures instead of silently dropping them', async () => {
    const entityType = 'custom:virtual_entity'
    const { handlers, emitEvent, container } = createBridgeHarness({ entityType })
    register(container as never)
    await flushRegistration()

    const handler = handlers.get('custom.virtual_entity.created')
    expect(handler).toBeDefined()
    await handler!({ id: 'virtual-1' }, {
      resolve: container.resolve,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })

    expect(emitEvent).not.toHaveBeenCalled()
    expect(mockRecordIndexerError).toHaveBeenCalledWith(
      expect.objectContaining({ em: expect.anything() }),
      expect.objectContaining({
        source: 'query_index',
        handler: 'event:query_index.crud_bridge.upsert',
        error: expect.any(QueryIndexScopeError),
        entityType,
        recordId: 'virtual-1',
      }),
    )
  })
})


describe('query_index process registrations', () => {
  beforeEach(() => mockRecordIndexerError.mockClear())
  it('registers without resolving services, polling for a bus, or querying custom fields', async () => {
    const root = createContainer()
    const resolve = jest.spyOn(root, 'resolve')
    const timer = jest.spyOn(global, 'setTimeout')
    const handlers = jest.fn()
    try {
      await getProcessDiRegistrar(register)!(root)
      expect(resolve).not.toHaveBeenCalled()
      expect(timer).not.toHaveBeenCalled()
      await runProcessEventSetups(root, { on: handlers } as never)
      expect(handlers.mock.calls.map(([pattern]) => pattern)).toEqual([
        '*.*.created', '*.*.updated', '*.*.deleted',
      ])
    } finally {
      resolve.mockRestore()
      timer.mockRestore()
    }
  })

  it('resolves a separate query engine from each caller EntityManager', async () => {
    const root = createContainer()
    await getProcessDiRegistrar(register)!(root)
    const first = root.createScope()
    const second = root.createScope()
    const firstEm = { label: 'first' }
    const secondEm = { label: 'second' }
    first.register({ em: asValue(firstEm) })
    second.register({ em: asValue(secondEm) })
    const firstEngine = first.resolve('queryEngine')
    const secondEngine = second.resolve('queryEngine')
    expect(firstEngine).not.toBe(secondEngine)
    expect(first.resolve('queryEngine')).toBe(firstEngine)
    const { BasicQueryEngine } = await import('@open-mercato/shared/lib/query/engine')
    expect(BasicQueryEngine).toHaveBeenCalledWith(firstEm, undefined, expect.any(Function))
    expect(BasicQueryEngine).toHaveBeenCalledWith(secondEm, undefined, expect.any(Function))
  })

  it('covers new custom-field entities after startup and resolves the emitting caller', async () => {
    const first = createBridgeHarness({ entityType: 'customers:customer_person', metadata: scopedMetadata })
    const second = createBridgeHarness({ entityType: 'future:record', customEntity: true })
    const subscriptions = new Map<string, (payload: unknown, context: unknown) => Promise<void>>()
    setupQueryIndexCrudBridge({
      on: (pattern: string, handler: SubscriberHandler) => { subscriptions.set(pattern, handler as never) },
    } as never)
    registerEntityIds({ customers: { customer_person: 'customers:customer_person' } })
    const created = subscriptions.get('*.*.created')!
    const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
    await created({ id: 'person-1', ...scope }, { resolve: first.container.resolve, eventName: 'customers.customer_person.created' })
    await created({ id: 'record-1', ...scope }, { resolve: second.container.resolve, eventName: 'future.record.created' })
    expect(first.emitEvent).toHaveBeenCalledWith('query_index.upsert_one', expect.objectContaining({ recordId: 'person-1' }))
    expect(second.emitEvent).toHaveBeenCalledWith('query_index.upsert_one', expect.objectContaining({ recordId: 'record-1' }))
    expect(first.emitEvent).toHaveBeenCalledTimes(1)
    expect(second.emitEvent).toHaveBeenCalledTimes(1)
    expect(first.db.selectFrom).toHaveBeenCalledTimes(1)
    expect(second.db.selectFrom).toHaveBeenCalledTimes(2)
  })

  it('deletes runtime custom-entity index rows even after their field definitions are removed', async () => {
    const harness = createBridgeHarness({ entityType: 'custom:runtime_record', indexed: true })
    const subscriptions = new Map<string, SubscriberHandler>()
    setupQueryIndexCrudBridge({
      on: (pattern: string, handler: SubscriberHandler) => { subscriptions.set(pattern, handler) },
    } as never)
    await subscriptions.get('*.*.deleted')!({
      id: 'custom-1', tenantId: 'tenant-1', organizationId: 'org-1',
    }, { resolve: harness.container.resolve, eventName: 'custom.runtime_record.deleted' } as never)
    expect(harness.emitEvent).toHaveBeenCalledWith('query_index.delete_one', {
      entityType: 'custom:runtime_record', recordId: 'custom-1', tenantId: 'tenant-1', organizationId: 'org-1',
    })
    expect(harness.db.selectFrom).not.toHaveBeenCalledWith('custom_field_defs')
  })

  it('ignores domain event aliases that are neither registered nor runtime custom entities', async () => {
    const harness = createBridgeHarness({ entityType: 'catalog:product' })
    const subscriptions = new Map<string, SubscriberHandler>()
    setupQueryIndexCrudBridge({
      on: (pattern: string, handler: SubscriberHandler) => { subscriptions.set(pattern, handler) },
    } as never)
    await subscriptions.get('*.*.created')!({ id: 'product-1', tenantId: 'tenant-1', organizationId: 'org-1' }, {
      resolve: harness.container.resolve, eventName: 'catalog.product.created',
    } as never)
    expect(harness.emitEvent).not.toHaveBeenCalled()
    expect(mockRecordIndexerError).not.toHaveBeenCalled()
  })

  it('ignores non-entity CRUD events and already managed payloads without resolving services', async () => {
    registerEntityIds({ customers: { customer_person: 'customers:customer_person' } })
    const subscriptions = new Map<string, (payload: unknown, context: unknown) => Promise<void>>()
    setupQueryIndexCrudBridge({
      on: (pattern: string, handler: SubscriberHandler) => { subscriptions.set(pattern, handler as never) },
    } as never)
    const resolve = jest.fn()
    const created = subscriptions.get('*.*.created')!
    await created({ status: 'complete' }, { resolve, eventName: 'unknown.event.created' })
    await created({ id: 'person', [CRUD_QUERY_INDEX_MANAGED_PAYLOAD_KEY]: true }, {
      resolve, eventName: 'customers.customer_person.created',
    })
    expect(resolve).not.toHaveBeenCalled()
  })
})
