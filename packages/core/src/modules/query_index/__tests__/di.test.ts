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

import type { EntityManager } from '@mikro-orm/postgresql'
import { CRUD_QUERY_INDEX_MANAGED_PAYLOAD_KEY } from '@open-mercato/shared/lib/crud/types'
import { registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { QueryIndexScopeError } from '../lib/subscriber-scope'
import { register } from '../di'

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
