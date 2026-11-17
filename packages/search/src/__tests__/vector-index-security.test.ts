import { VectorIndexService, type VectorIndexServiceOptions } from '../vector/services/vector-index.service'
import type { EmbeddingService } from '../vector/services/embedding'
import type { VectorDriver, VectorDriverDocument } from '../vector/types'
import type { VectorModuleConfig } from '@open-mercato/shared/modules/vector'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import type { EntityManager } from '@mikro-orm/postgresql'
import { searchConfig as customersSearchConfig } from '@open-mercato/core/modules/customers/search'
import { searchConfig as accountsSearchConfig } from '@open-mercato/core/modules/customer_accounts/search'
import { SearchIndexer } from '../indexer/search-indexer'
import { SearchService } from '../service'
import { VectorSearchStrategy } from '../strategies/vector.strategy'
import type { SearchStrategy } from '../types'
import { asValue, createContainer } from 'awilix'
import { registerSearchModule } from '../di'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ t: (_key: string, fallback: string) => fallback }),
}))
jest.mock('../fulltext/drivers', () => ({ createFulltextDriver: jest.fn() }))
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => mockReportError(...args) }),
}))

const mockReportError = jest.fn((..._args: unknown[]) => {})
type EncryptedCustomFieldKeysResolver = NonNullable<VectorIndexServiceOptions['encryptedCustomFieldKeysResolver']>

type CapturedEmbeddingInput = { value: string | string[] | null }

function createEmbeddingService(captured: CapturedEmbeddingInput): EmbeddingService {
  return {
    available: true,
    createEmbedding: async (input: string | string[]) => {
      captured.value = input
      return [0.1, 0.2, 0.3]
    },
  } as unknown as EmbeddingService
}

function createDriver(overrides: Partial<VectorDriver> = {}): VectorDriver & { upsertCalls: VectorDriverDocument[] } {
  const upsertCalls: VectorDriverDocument[] = []
  const driver = {
    id: 'pgvector' as const,
    ensureReady: async () => {},
    upsert: async (doc: VectorDriverDocument) => {
      upsertCalls.push(doc)
    },
    delete: async () => {},
    query: async () => [],
    getChecksum: async () => null,
    list: async () => [],
    upsertCalls,
    ...overrides,
  }
  return driver as VectorDriver & { upsertCalls: VectorDriverDocument[] }
}

function createQueryEngine(record: Record<string, unknown>): QueryEngine {
  return {
    query: async () => ({ items: [record], total: 1 }),
  } as unknown as QueryEngine
}

function createCustomerIndexer(args: {
  driver: VectorDriver
  embeddingService: EmbeddingService
  queryEngine: QueryEngine
  encryptionService?: Pick<TenantDataEncryptionService, 'getEncryptedFieldNames'>
  otherStrategy?: SearchStrategy
}): SearchIndexer {
  const container = createContainer()
  container.register({
    vectorDrivers: asValue([args.driver]),
    vectorEmbeddingService: asValue(args.embeddingService),
    queryEngine: asValue(args.queryEngine),
    tenantEncryptionService: asValue(args.encryptionService ?? { getEncryptedFieldNames: async () => [] }),
  })
  registerSearchModule(container, { skipTokens: true, skipFulltext: true, moduleConfigs: [customersSearchConfig, accountsSearchConfig] })
  if (args.otherStrategy) container.resolve<SearchService>('searchService').registerStrategy(args.otherStrategy)
  return container.resolve<SearchIndexer>('searchIndexer')
}

function createService(args: {
  driver: VectorDriver
  embeddingService: EmbeddingService
  queryEngine: QueryEngine
  moduleConfigs: VectorModuleConfig[]
  encryptionService?: TenantDataEncryptionService | null
  encryptedCustomFieldKeysResolver?: EncryptedCustomFieldKeysResolver | null
}): VectorIndexService {
  return new VectorIndexService({
    drivers: [args.driver],
    embeddingService: args.embeddingService,
    queryEngine: args.queryEngine,
    moduleConfigs: args.moduleConfigs,
    ...(args.encryptedCustomFieldKeysResolver === null
      ? {}
      : { encryptedCustomFieldKeysResolver: args.encryptedCustomFieldKeysResolver ?? (async () => new Set()) }),
    containerResolver: () => ({
      resolve: (name: string) => {
        if (name === 'tenantEncryptionService') {
          if (!args.encryptionService) throw new Error('not registered')
          return args.encryptionService
        }
        throw new Error(`unexpected resolve: ${name}`)
      },
    }),
  })
}

describe('VectorIndexService default source field protection (issue #2716)', () => {
  it('excludes snake_case scope and timestamp fields from the default embedding source', async () => {
    const captured: CapturedEmbeddingInput = { value: null }
    const record = {
      id: 'rec-1',
      tenant_id: 'tenant-secret',
      organization_id: 'org-secret',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
      deleted_at: null,
      name: 'Visible Name',
      description: 'Visible Description',
    }
    const service = createService({
      driver: createDriver(),
      embeddingService: createEmbeddingService(captured),
      queryEngine: createQueryEngine(record),
      moduleConfigs: [{ entities: [{ entityId: 'demo:item' }] }],
    })

    await service.indexRecord({ entityId: 'demo:item', recordId: 'rec-1', tenantId: 'tenant-secret' })

    const lines = Array.isArray(captured.value) ? captured.value.join('\n') : String(captured.value)
    expect(lines).toContain('name: Visible Name')
    expect(lines).toContain('description: Visible Description')
    expect(lines).not.toContain('tenant-secret')
    expect(lines).not.toContain('org-secret')
    expect(lines).not.toContain('tenant_id')
    expect(lines).not.toContain('organization_id')
    expect(lines).not.toContain('created_at')
    expect(lines).not.toContain('updated_at')
  })

  it('honors fieldPolicy.excluded/hashOnly and the searchable allowlist for record and custom fields', async () => {
    const captured: CapturedEmbeddingInput = { value: null }
    const record = {
      id: 'rec-2',
      tenant_id: 'tenant-1',
      name: 'Allowed Name',
      ssn: '123-45-6789',
      email: 'person@example.com',
      'cf:notes': 'Allowed note',
      'cf:secret_token': 'sk-should-not-leak',
    }
    const service = createService({
      driver: createDriver(),
      embeddingService: createEmbeddingService(captured),
      queryEngine: createQueryEngine(record),
      moduleConfigs: [
        {
          entities: [
            {
              entityId: 'demo:item',
              fieldPolicy: {
                searchable: ['name', 'notes'],
                hashOnly: ['email'],
                excluded: ['ssn', 'secret_token'],
              },
            },
          ],
        },
      ],
    })

    await service.indexRecord({ entityId: 'demo:item', recordId: 'rec-2', tenantId: 'tenant-1' })

    const lines = Array.isArray(captured.value) ? captured.value.join('\n') : String(captured.value)
    expect(lines).toContain('name: Allowed Name')
    expect(lines).toContain('custom.notes: Allowed note')
    expect(lines).not.toContain('123-45-6789')
    expect(lines).not.toContain('person@example.com')
    expect(lines).not.toContain('sk-should-not-leak')
  })
})

describe('VectorIndexService encrypted custom-field callback boundaries (PR #8410)', () => {
  it('filters encrypted keys from every callback and hydrated custom-field source with tenant-aware lookups', async () => {
    const rawRecord = {
      id: 'callback-record',
      name: 'Visible Name',
      cf_secret: 'PRIVATE-RECORD',
      cf_note: 'Visible record note',
      'cf:secret': 'PRIVATE-CUSTOM',
      'cf:note': 'Visible custom note',
    }
    const originalRecord = { ...rawRecord }
    const callbackContexts: Array<{ record: Record<string, unknown>; customFields: Record<string, unknown> }> = []
    const hydratedRecords: Record<string, unknown>[] = []
    const queryEngine = {
      query: jest.fn(async (entityId: string, options?: Record<string, unknown>) => {
        if (entityId === 'demo:item') return { items: [rawRecord], total: 1 }
        expect(options).toEqual(expect.objectContaining({ tenantId: 'callback-tenant', skipAutoReindex: true }))
        return {
          items: [{
            id: 'related-record',
            'cf:related_secret': 'PRIVATE-RELATED',
            cf_source_secret: 'PRIVATE-SOURCE',
            'cf:related_note': 'Visible related note',
            cf_source_note: 'Visible source note',
          }],
          total: 1,
        }
      }),
    } as unknown as QueryEngine
    const resolver = jest.fn<ReturnType<EncryptedCustomFieldKeysResolver>, Parameters<EncryptedCustomFieldKeysResolver>>(async (entityId) => {
      if (entityId === 'demo:item') return new Set(['secret'])
      if (entityId === 'demo:related') return new Set(['related_secret'])
      return new Set(['source_secret'])
    })
    const captureContext = (context: { record: Record<string, unknown>; customFields: Record<string, unknown> }) => {
      callbackContexts.push({ record: { ...context.record }, customFields: { ...context.customFields } })
    }
    const service = createService({
      driver: createDriver(),
      embeddingService: createEmbeddingService({ value: null }),
      queryEngine,
      encryptedCustomFieldKeysResolver: resolver,
      moduleConfigs: [{ entities: [{
        entityId: 'demo:item',
        buildSource: async (context) => {
          captureContext(context)
          const hydrated = await context.queryEngine!.query('demo:related', {
            tenantId: 'callback-tenant',
            customFieldSources: [{
              entityId: 'demo:source',
              join: { fromField: 'id', toField: 'related_id' },
            }],
          })
          hydratedRecords.push(hydrated.items[0])
          return { input: 'Visible source' }
        },
        formatResult: (context) => {
          captureContext(context)
          return { title: 'Visible title' }
        },
        resolveLinks: (context) => {
          captureContext(context)
          return [{ href: '/visible', label: 'Visible' }]
        },
        resolveUrl: (context) => {
          captureContext(context)
          return '/visible'
        },
      }] }],
    })

    await service.indexRecord({ entityId: 'demo:item', recordId: 'callback-record', tenantId: 'outer-tenant' })

    expect(callbackContexts).toHaveLength(4)
    for (const context of callbackContexts) {
      expect(context.record).toEqual(expect.objectContaining({ name: 'Visible Name', cf_note: 'Visible record note' }))
      expect(context.record).not.toHaveProperty('cf_secret')
      expect(context.customFields).toEqual({ note: 'Visible custom note' })
    }
    expect(hydratedRecords).toEqual([expect.objectContaining({
      id: 'related-record',
      'cf:related_note': 'Visible related note',
      cf_source_note: 'Visible source note',
    })])
    expect(JSON.stringify(hydratedRecords)).not.toContain('PRIVATE-')
    expect(resolver).toHaveBeenCalledWith('demo:item', 'outer-tenant')
    expect(resolver).toHaveBeenCalledWith('demo:related', 'callback-tenant')
    expect(resolver).toHaveBeenCalledWith('demo:source', 'callback-tenant')
    expect(rawRecord).toEqual(originalRecord)
  })

  it('removes every custom field from callbacks and callback queries when the resolver is absent', async () => {
    const contexts: Array<{ record: Record<string, unknown>; customFields: Record<string, unknown> }> = []
    const hydratedRecords: Record<string, unknown>[] = []
    const queryEngine = {
      query: async (entityId: string) => entityId === 'demo:item'
        ? { items: [{ id: 'missing-resolver', name: 'Visible', cf_note: 'PRIVATE-ALIAS', 'cf:secret': 'PRIVATE-CUSTOM' }], total: 1 }
        : { items: [{ id: 'related', 'cf:secret': 'PRIVATE-RELATED', cf_note: 'PRIVATE-RELATED-ALIAS' }], total: 1 },
    } as unknown as QueryEngine
    const capture = (context: { record: Record<string, unknown>; customFields: Record<string, unknown> }) => {
      contexts.push({ record: { ...context.record }, customFields: { ...context.customFields } })
    }
    const service = createService({
      driver: createDriver(),
      embeddingService: createEmbeddingService({ value: null }),
      queryEngine,
      encryptedCustomFieldKeysResolver: null,
      moduleConfigs: [{ entities: [{
        entityId: 'demo:item',
        buildSource: async (context) => {
          capture(context)
          const hydrated = await context.queryEngine!.query('demo:related', { tenantId: 'tenant-closed' })
          hydratedRecords.push(hydrated.items[0])
          return { input: 'Visible source' }
        },
        formatResult: (context) => { capture(context); return { title: 'Visible' } },
        resolveLinks: (context) => { capture(context); return [] },
        resolveUrl: (context) => { capture(context); return null },
      }] }],
    })

    await service.indexRecord({ entityId: 'demo:item', recordId: 'missing-resolver', tenantId: 'tenant-closed' })

    expect(contexts).toHaveLength(4)
    for (const context of contexts) {
      expect(context.record).toEqual({ id: 'missing-resolver', name: 'Visible' })
      expect(context.customFields).toEqual({})
    }
    expect(hydratedRecords).toEqual([{ id: 'related' }])
  })

  it('memoizes normalized resolver failures for one reindex operation and retries on the next operation', async () => {
    mockReportError.mockClear()
    const records = [
      { id: 'first', title: 'First', 'cf:secret': 'PRIVATE-FIRST' },
      { id: 'second', title: 'Second', 'cf:secret': 'PRIVATE-SECOND' },
    ]
    const queryEngine = {
      query: async (entityId: string, options?: { page?: unknown; filters?: unknown }) => {
        if (entityId === 'demo:item') {
          return { items: options?.page ? records : [records[0]], total: options?.page ? 2 : 1 }
        }
        return { items: [{ id: 'related', 'cf:secret': 'PRIVATE-RELATED' }], total: 1 }
      },
    } as unknown as QueryEngine
    const resolver = jest.fn<ReturnType<EncryptedCustomFieldKeysResolver>, Parameters<EncryptedCustomFieldKeysResolver>>(() => {
      throw { secret: 'PRIVATE-REJECTION' }
    })
    const hydrate = async (context: { queryEngine?: QueryEngine }) => {
      const result = await context.queryEngine!.query('demo:related', {
        tenantId: 'tenant-failure',
        customFieldSources: [{
          entityId: 'demo:source',
          join: { fromField: 'id', toField: 'related_id' },
        }],
      })
      expect(result.items).toEqual([{ id: 'related' }])
    }
    const service = createService({
      driver: createDriver(),
      embeddingService: createEmbeddingService({ value: null }),
      queryEngine,
      encryptedCustomFieldKeysResolver: resolver,
      moduleConfigs: [{ entities: [{
        entityId: 'demo:item',
        buildSource: async (context) => { await hydrate(context); return { input: String(context.record.title) } },
        formatResult: async (context) => { await hydrate(context); return { title: String(context.record.title) } },
        resolveLinks: async (context) => { await hydrate(context); return [] },
        resolveUrl: async (context) => { await hydrate(context); return null },
      }] }],
    })

    await service.reindexEntity({ entityId: 'demo:item', tenantId: 'tenant-failure' })

    expect(resolver).toHaveBeenCalledTimes(3)
    expect(resolver.mock.calls).toEqual(expect.arrayContaining([
      ['demo:item', 'tenant-failure'],
      ['demo:related', 'tenant-failure'],
      ['demo:source', 'tenant-failure'],
    ]))
    expect(mockReportError).toHaveBeenCalledTimes(3)
    for (const [error, context] of mockReportError.mock.calls) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe('[internal] Encrypted custom-field resolver rejected with a non-Error value')
      expect((error as Error).message).not.toContain('PRIVATE-REJECTION')
      expect(context).toEqual(expect.objectContaining({ code: 'search.encrypted_custom_fields_unresolved' }))
    }

    await service.indexRecord({ entityId: 'demo:item', recordId: 'first', tenantId: 'tenant-failure' })

    expect(resolver).toHaveBeenCalledTimes(6)
    expect(mockReportError).toHaveBeenCalledTimes(6)
  })

  it('keeps encrypted metadata-like values in the checksum without embedding or storing them', async () => {
    let record = {
      id: 'checksum-record',
      public_label: 'Visible',
      'cf:title': 'PRIVATE-TITLE-FIRST',
      'cf:summary': 'PRIVATE-SUMMARY-FIRST',
    }
    const capturedInputs: string[] = []
    const driver = createDriver()
    const service = createService({
      driver,
      embeddingService: {
        available: true,
        createEmbedding: async (input: string | string[]) => {
          capturedInputs.push(Array.isArray(input) ? input.join('\n') : input)
          return [0.1, 0.2, 0.3]
        },
      } as EmbeddingService,
      queryEngine: { query: async () => ({ items: [record], total: 1 }) } as unknown as QueryEngine,
      encryptedCustomFieldKeysResolver: async () => new Set(['title', 'summary']),
      moduleConfigs: [{ entities: [{ entityId: 'demo:item' }] }],
    })

    await service.indexRecord({ entityId: 'demo:item', recordId: 'checksum-record', tenantId: 'tenant-checksum' })
    record = {
      ...record,
      'cf:title': 'PRIVATE-TITLE-SECOND',
      'cf:summary': 'PRIVATE-SUMMARY-SECOND',
    }
    await service.indexRecord({ entityId: 'demo:item', recordId: 'checksum-record', tenantId: 'tenant-checksum' })

    expect(capturedInputs).toHaveLength(2)
    expect(capturedInputs.join('\n')).not.toContain('PRIVATE-')
    expect(JSON.stringify(driver.upsertCalls)).not.toContain('PRIVATE-')
    expect(driver.upsertCalls[0].checksum).not.toBe(driver.upsertCalls[1].checksum)
  })
})

describe('Customer vector privacy at provider and storage boundaries (issue #7826)', () => {
  it.each(['true', 'false'].flatMap((toggle) => ['single', 'by-id', 'batch', 'bulk'].map((mode) => ({ toggle, mode }))))(
    'protects real-service live declarations with encryption $toggle through $mode indexing', async ({ toggle, mode }) => {
      const previousToggle = process.env.TENANT_DATA_ENCRYPTION
      try {
        process.env.TENANT_DATA_ENCRYPTION = 'true'
        const execute = jest.fn(async (_sql: string, params?: readonly unknown[]) => [{
          entity_id: params?.[0], tenant_id: 'tenant-privacy', organization_id: 'org-privacy',
          fields_json: [{ field: params?.[0] === 'customers:customer_company_profile' ? 'size_bucket' : 'status' }],
        }])
        const encryptionService = new TenantDataEncryptionService({ execute } as unknown as EntityManager, {
          kms: { isHealthy: () => false, getTenantDek: async () => null, createTenantDek: async () => null },
        })
        await expect(encryptionService.getEncryptedFieldNames('customers:customer_company_profile', 'tenant-privacy', 'org-privacy', { ignoreRuntimeHealth: true })).resolves.toEqual(['size_bucket'])
        execute.mockClear()
        process.env.TENANT_DATA_ENCRYPTION = toggle
        const driver = createDriver()
        const captured: CapturedEmbeddingInput = { value: null }
        const otherIndex = jest.fn(async () => {})
        const record = { id: 'real-policy-company', entity_id: 'real-policy-entity', size_bucket: 'private-size' }
        const indexer = createCustomerIndexer({
          driver, embeddingService: createEmbeddingService(captured), encryptionService,
          queryEngine: { query: async (entityId: string) => ({ items: [entityId === 'customers:customer_entity' ? { id: 'real-policy-entity', status: 'private-status' } : record], total: 1 }) } as QueryEngine,
          otherStrategy: { id: 'fulltext', name: 'Fake fulltext', priority: 1, ensureReady: async () => {}, isAvailable: async () => true, search: async () => [], index: otherIndex, delete: async () => {} },
        })
        const params = { entityId: 'customers:customer_company_profile', recordId: record.id, tenantId: 'tenant-privacy', organizationId: 'org-privacy' }
        if (mode === 'single') await indexer.indexRecord({ ...params, record })
        if (mode === 'by-id') await indexer.indexRecordById(params)
        if (mode === 'batch') await indexer.indexRecordsById({ ...params, items: [params] })
        if (mode === 'bulk') await indexer.bulkIndexRecords([{ ...params, record }])
        if (toggle === 'false') {
          expect(captured.value).toBeNull()
          expect(driver.upsertCalls).toHaveLength(0)
          expect(execute).not.toHaveBeenCalled()
        } else {
          expect(captured.value).not.toBeNull()
          expect(driver.upsertCalls).toHaveLength(1)
          expect(JSON.stringify(captured.value)).not.toContain('private-')
          expect(execute).toHaveBeenCalled()
          for (const [, policyParams] of execute.mock.calls) expect(policyParams).toEqual(expect.arrayContaining(['tenant-privacy', 'org-privacy']))
        }
        expect(otherIndex).toHaveBeenCalledTimes(1)
      } finally {
        if (previousToggle === undefined) delete process.env.TENANT_DATA_ENCRYPTION
        else process.env.TENANT_DATA_ENCRYPTION = previousToggle
      }
    },
  )

  it.each(['protected-scope', 'other-scope', 'tenant-wide', 'related-scope'])('applies live profile and related-entity declarations for the trusted %s', async (scope) => {
    const driver = createDriver()
    const captured: CapturedEmbeddingInput = { value: null }
    const getEncryptedFieldNames = jest.fn(async (entityId: string, tenantId: string | null | undefined, organizationId?: string | null) => {
      if (tenantId !== 'tenant-privacy' || organizationId !== 'protected-scope') return []
      return entityId === 'customers:customer_company_profile' ? ['cf:sizeBucket'] : ['status', 'lifecycleStage']
    })
    const organizationId = scope === 'tenant-wide' || scope === 'related-scope' ? undefined : scope
    const record = { id: 'live-company', entity_id: 'live-entity', tenant_id: 'untrusted-tenant', organization_id: scope === 'tenant-wide' ? 'protected-scope' : scope === 'related-scope' ? undefined : 'untrusted-org', sizeBucket: 'private-size', 'cf:size_bucket': 'private-custom-size' }
    const queryEngine = { query: async (entityId: string) => ({ items: [
      entityId === 'customers:customer_entity'
        ? { id: 'live-entity', organization_id: scope === 'related-scope' ? 'protected-scope' : undefined, status: 'private-status', lifecycleStage: 'private-stage' }
        : record,
    ], total: 1 }) } as QueryEngine
    const indexer = createCustomerIndexer({ driver, embeddingService: createEmbeddingService(captured), queryEngine, encryptionService: { getEncryptedFieldNames } })
    await indexer.indexRecordById({ entityId: 'customers:customer_company_profile', recordId: record.id, tenantId: 'tenant-privacy', organizationId })
    expect(driver.upsertCalls).toHaveLength(1)
    if (scope === 'other-scope') {
      expect(JSON.stringify(captured.value)).toContain('private-size')
      expect(JSON.stringify(captured.value)).not.toContain('private-custom-size')
    } else {
      expect(JSON.stringify(captured.value)).not.toContain('private-')
    }
    for (const entityId of ['customers:customer_company_profile', 'customers:customer_entity']) {
      expect(getEncryptedFieldNames).toHaveBeenCalledWith(entityId, 'tenant-privacy', organizationId, { ignoreRuntimeHealth: true })
    }
  })

  it('does not send decrypted fields when live encryption policy lookup fails', async () => {
    const driver = createDriver()
    const captured: CapturedEmbeddingInput = { value: null }
    const indexer = createCustomerIndexer({
      driver, embeddingService: createEmbeddingService(captured),
      queryEngine: createQueryEngine({ id: 'policy-failure', size_bucket: 'private-size' }),
      encryptionService: { getEncryptedFieldNames: async () => { throw new Error('[internal] Policy unavailable') } },
    })
    await indexer.indexRecordById({ entityId: 'customers:customer_company_profile', recordId: 'policy-failure', tenantId: 'tenant-privacy', organizationId: 'org-privacy' })
    expect(captured.value).toBeNull()
    expect(driver.upsertCalls).toHaveLength(0)
  })

  it.each(['missing-container', 'missing-service'])('does not embed customer fields with %s', async (failure) => {
    const driver = createDriver()
    const captured: CapturedEmbeddingInput = { value: null }
    const company = customersSearchConfig.entities.find((entity) => entity.entityId === 'customers:customer_company_profile')!
    const indexer = new SearchIndexer(new SearchService({ strategies: [new VectorSearchStrategy(createEmbeddingService(captured), driver)] }), [{ entities: [{
      ...company,
      buildSource: (ctx) => company.buildSource!({ ...ctx, container: failure === 'missing-service' ? { resolve: () => undefined } : undefined }),
    }] }])
    await indexer.indexRecord({ entityId: company.entityId, recordId: 'missing-policy', tenantId: 'tenant-privacy', record: { size_bucket: 'private-size' } })
    expect(captured.value).toBeNull()
    expect(driver.upsertCalls).toHaveLength(0)
  })

  it.each(['throw', 'null', 'empty-string', 'empty-array', 'whitespace'].flatMap((failure) =>
    ['single', 'by-id', 'batch', 'bulk'].map((mode) => ({ failure, mode })),
  ))('fails closed for $failure sources through $mode indexing without blocking other strategies', async ({ failure, mode }) => {
    const captured: CapturedEmbeddingInput = { value: null }
    const driver = createDriver()
    const otherIndex = jest.fn(async () => {})
    const otherStrategy: SearchStrategy = {
      id: 'fulltext', name: 'Fake fulltext', priority: 1,
      isAvailable: async () => true, ensureReady: async () => {}, search: async () => [],
      index: otherIndex, delete: async () => {},
    }
    const record = { id: 'source-failure', email: 'private-email@example.com', password_hash: 'private-password-hash' }
    const indexer = new SearchIndexer(new SearchService({ strategies: [
      new VectorSearchStrategy(createEmbeddingService(captured), driver), otherStrategy,
    ] }), [{ entities: [{
      entityId: 'customer_accounts:customer_user',
      buildSource: () => {
        if (failure === 'throw') throw new Error('[internal] Injected source failure')
        if (failure === 'null') return null
        return { text: failure === 'empty-string' ? '' : failure === 'whitespace' ? ' \n ' : [] }
      },
    }] }], { queryEngine: createQueryEngine(record) })
    const params = { entityId: 'customer_accounts:customer_user', recordId: record.id, tenantId: 'tenant-privacy', organizationId: 'org-privacy' }
    if (mode === 'single') await indexer.indexRecord({ ...params, record })
    if (mode === 'by-id') await indexer.indexRecordById(params)
    if (mode === 'batch') await indexer.indexRecordsById({ ...params, items: [params] })
    if (mode === 'bulk') await indexer.bulkIndexRecords([{ ...params, record }])
    expect(captured.value).toBeNull()
    expect(driver.upsertCalls).toHaveLength(0)
    expect(otherIndex).toHaveBeenCalledTimes(1)
    expect(otherIndex).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-privacy', organizationId: 'org-privacy' }))
  })

  it('keeps protected fields out of a generated presenter when a custom source omits its presenter', async () => {
    const driver = createDriver()
    const service = createService({
      driver,
      embeddingService: createEmbeddingService({ value: null }),
      queryEngine: createQueryEngine({
        id: 'fallback-record',
        title: 'private-title',
        description: 'private-description',
        'cf:summary': 'private-summary',
      }),
      moduleConfigs: [{ entities: [{
        entityId: 'demo:item',
        fieldPolicy: { searchable: ['title', 'description', 'summary'], hashOnly: ['title'], excluded: ['description', 'summary'] },
        buildSource: () => ({ input: 'Safe source', checksumSource: 'safe-checksum' }),
      }] }],
    })

    await service.indexRecord({ entityId: 'demo:item', recordId: 'fallback-record', tenantId: 'tenant-privacy' })
    expect(driver.upsertCalls).toHaveLength(1)
    expect(JSON.stringify(driver.upsertCalls[0])).not.toContain('private-')
    expect(driver.upsertCalls[0].resultTitle).toBe('fallback-record')
  })

  const customerIndexingCases = [
    'customers:customer_person_profile',
    'customers:customer_company_profile',
    'customer_accounts:customer_user',
  ].flatMap((entityId) => ['by-id', 'single', 'bulk'].map((mode) => ({ entityId, mode })))
  it.each(customerIndexingCases)('keeps contact and excluded custom values out of $entityId $mode embeddings and stored metadata', async ({ entityId, mode }) => {
    const driver = createDriver()
    const captured: CapturedEmbeddingInput = { value: null }
    const record = {
      id: `record-${entityId}`,
      entity_id: `entity-${entityId}`,
      display_name: 'Permitted Presenter Name',
      email: 'private-account@example.com',
      primary_email: 'private-profile@example.com',
      primary_phone: '+48-555-030-7826',
      password_hash: 'private-password-hash',
      'cf:personal_email': 'private-custom@example.com',
      cf_government_id: 'private-government-id',
      'cf:bank_account': 'private-bank-account',
      'cf:summary': 'private-summary',
      cf_unknown: 'private-unknown',
    }
    const related = {
      id: `entity-${entityId}`,
      display_name: 'Permitted Customer Name',
      primary_email: 'private-related@example.com',
      primary_phone: '+48-555-040-7826',
      status: 'active',
      'cf:government_id': 'private-related-government',
      cf_personal_email: 'private-related-custom@example.com',
    }
    const query = jest.fn(async (queriedEntity: string, _options: unknown) => ({
      items: [queriedEntity === 'customers:customer_entity' ? related : record],
      total: 1,
    }))
    const indexer = createCustomerIndexer({ driver, embeddingService: createEmbeddingService(captured), queryEngine: { query } as unknown as QueryEngine })

    const params = {
      entityId,
      recordId: record.id,
      tenantId: 'tenant-privacy',
      organizationId: 'org-privacy',
    }
    if (mode === 'by-id') {
      await indexer.indexRecordById(params)
    } else {
      const recordParams = { ...params, record, customFields: { personal_email: 'private-separate@example.com' } }
      if (mode === 'bulk') {
        await indexer.bulkIndexRecords([recordParams])
      } else {
        await indexer.indexRecord(recordParams)
      }
    }

    expect(captured.value).not.toBeNull()
    expect(driver.upsertCalls).toHaveLength(1)
    const serialized = JSON.stringify({ input: captured.value, document: driver.upsertCalls[0] })
    expect(serialized).not.toContain('private-')
    expect(serialized).not.toContain('+48-555-')
    expect(JSON.stringify(captured.value)).not.toContain('Permitted')
    expect(driver.upsertCalls[0].tenantId).toBe('tenant-privacy')
    expect(driver.upsertCalls[0].organizationId).toBe('org-privacy')
    for (const [, options] of query.mock.calls) {
      expect(options).toEqual(expect.objectContaining({ tenantId: 'tenant-privacy', organizationId: 'org-privacy' }))
    }
  })

  it.each(['excluded', 'hashOnly', 'unlisted'] as const)('does not restore a %s custom summary through vector snapshot fallback', async (protection) => {
    const driver = createDriver()
    const service = createService({
      driver,
      embeddingService: createEmbeddingService({ value: null }),
      queryEngine: createQueryEngine({ id: 'snapshot-record', name: 'Safe name', 'cf:summary': 'private-snapshot' }),
      moduleConfigs: [{ entities: [{
        entityId: 'demo:item',
        fieldPolicy: {
          searchable: protection === 'unlisted' ? ['name'] : ['name', 'summary'],
          hashOnly: protection === 'hashOnly' ? ['summary'] : [],
          excluded: protection === 'excluded' ? ['summary'] : [],
        },
        buildSource: () => ({ input: 'Safe source', presenter: { title: 'Safe name' }, checksumSource: 'safe-checksum' }),
      }] }],
    })

    await service.indexRecord({ entityId: 'demo:item', recordId: 'snapshot-record', tenantId: 'tenant-privacy' })
    expect(driver.upsertCalls).toHaveLength(1)
    expect(JSON.stringify(driver.upsertCalls[0])).not.toContain('private-snapshot')
  })
})

describe('VectorIndexService encryption fail-closed (issue #2716)', () => {
  const enabledEncryptionThatThrows = (): TenantDataEncryptionService =>
    ({
      isEnabled: () => true,
      encryptEntityPayload: async () => {
        throw new Error('KMS outage')
      },
      decryptEntityPayload: async () => {
        throw new Error('KMS outage')
      },
    }) as unknown as TenantDataEncryptionService

  it('does not persist plaintext when encryption is enabled but encryption throws', async () => {
    const driver = createDriver()
    const captured: CapturedEmbeddingInput = { value: null }
    const record = { id: 'rec-3', tenant_id: 'tenant-1', name: 'Sensitive Title' }
    const service = createService({
      driver,
      embeddingService: createEmbeddingService(captured),
      queryEngine: createQueryEngine(record),
      moduleConfigs: [{ entities: [{ entityId: 'demo:item' }] }],
      encryptionService: enabledEncryptionThatThrows(),
    })

    await expect(
      service.indexRecord({ entityId: 'demo:item', recordId: 'rec-3', tenantId: 'tenant-1' }),
    ).rejects.toThrow('KMS outage')
    expect(driver.upsertCalls).toHaveLength(0)
  })

  it('fails closed on decrypt when encryption is enabled but decryption throws', async () => {
    const driver = createDriver({
      query: async () => [
        {
          entityId: 'demo:item',
          recordId: 'rec-4',
          organizationId: null,
          score: 0.9,
          checksum: 'abc',
          resultTitle: 'cipher-title',
          resultSubtitle: null,
          resultIcon: null,
          resultBadge: null,
          resultSnapshot: null,
          primaryLinkHref: null,
          primaryLinkLabel: null,
          links: null,
          payload: null,
        },
      ],
    })
    const captured: CapturedEmbeddingInput = { value: null }
    const service = createService({
      driver,
      embeddingService: createEmbeddingService(captured),
      queryEngine: createQueryEngine({ id: 'rec-4' }),
      moduleConfigs: [{ entities: [{ entityId: 'demo:item' }] }],
      encryptionService: enabledEncryptionThatThrows(),
    })

    await expect(
      service.search({ tenantId: 'tenant-1', query: 'anything' }),
    ).rejects.toThrow('KMS outage')
  })

  it('falls back to plaintext when encryption is explicitly disabled', async () => {
    const driver = createDriver()
    const captured: CapturedEmbeddingInput = { value: null }
    const record = { id: 'rec-5', tenant_id: 'tenant-1', name: 'Title' }
    const disabledEncryption = {
      isEnabled: () => false,
      encryptEntityPayload: async () => {
        throw new Error('should not be called when disabled')
      },
    } as unknown as TenantDataEncryptionService
    const service = createService({
      driver,
      embeddingService: createEmbeddingService(captured),
      queryEngine: createQueryEngine(record),
      moduleConfigs: [{ entities: [{ entityId: 'demo:item' }] }],
      encryptionService: disabledEncryption,
    })

    await service.indexRecord({ entityId: 'demo:item', recordId: 'rec-5', tenantId: 'tenant-1' })
    expect(driver.upsertCalls).toHaveLength(1)
    expect(driver.upsertCalls[0].resultTitle).toBe('Title')
  })
})

describe('VectorIndexService decrypted result parse-back (issue #5789)', () => {
  const passthroughEncryptionService = (): TenantDataEncryptionService =>
    ({
      isEnabled: () => true,
      decryptEntityPayload: async (_entityId: string, payload: Record<string, unknown>) => payload,
    }) as unknown as TenantDataEncryptionService

  it('parses links/payload back to objects when decryptEntityPayload returns sealed JSON strings', async () => {
    const driver = createDriver({
      query: async () => [
        {
          entityId: 'demo:item',
          recordId: 'rec-6',
          organizationId: null,
          score: 0.9,
          checksum: 'abc',
          resultTitle: 'Visible Title',
          resultSubtitle: null,
          resultIcon: null,
          resultBadge: null,
          resultSnapshot: null,
          primaryLinkHref: null,
          primaryLinkLabel: null,
          links: '[{"href":"/backend/demo/rec-6","label":"View","kind":"primary"}]',
          payload: '{"foo":"bar"}',
        },
      ],
    })
    const captured: CapturedEmbeddingInput = { value: null }
    const service = createService({
      driver,
      embeddingService: createEmbeddingService(captured),
      queryEngine: createQueryEngine({ id: 'rec-6' }),
      moduleConfigs: [{ entities: [{ entityId: 'demo:item' }] }],
      encryptionService: passthroughEncryptionService(),
    })

    const results = await service.search({ tenantId: 'tenant-1', query: 'anything' })

    expect(results).toHaveLength(1)
    expect(results[0].links).toEqual([{ href: '/backend/demo/rec-6', label: 'View', kind: 'primary' }])
    expect(results[0].metadata).toEqual({ foo: 'bar' })
  })
})

jest.mock('@open-mercato/core/modules/query_index/lib/search-scope', () => ({
  buildQueryIndexSearchScopePredicate: () => jest.requireActual('kysely').sql`true`,
  filterQueryIndexSearchRecords: async (_database: unknown, _scope: unknown, records: unknown[]) => records,
  resolveQueryIndexSearchScope: async () => ({
    blockedEntityTypes: [],
    tenantGlobalEntityTypes: jest.requireActual('@open-mercato/core/modules/query_index/lib/tenant-global').listTenantGlobalEntityTypes(),
  }),
}))
