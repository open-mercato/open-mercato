import { SearchIndexer } from '../indexer/search-indexer'
import type { SearchBuildContext, SearchModuleConfig } from '../types'
import type { QueryEngine, QueryResult } from '@open-mercato/shared/lib/query/types'

describe('SearchIndexer encrypted custom fields', () => {
  const companyEntityId = 'customers:customer_company_profile'
  const parentEntityId = 'customers:customer_entity'

  function setup(options: {
    resolver?: (entityId: string) => Promise<Set<string>>
    parentRecord?: Record<string, unknown>
  } = {}) {
    const contexts: SearchBuildContext[] = []
    const hydrated: Array<Record<string, unknown> | undefined> = []
    const moduleConfigs: SearchModuleConfig[] = [
      {
        entities: [
          {
            entityId: companyEntityId,
            enabled: true,
            buildSource: async (ctx) => {
              contexts.push(ctx)
              const engine = ctx.queryEngine as QueryEngine | undefined
              const parent = await engine?.query(parentEntityId, { tenantId: 'tenant-1', filters: { id: 'entity-1' } })
              hydrated.push(parent?.items[0] as Record<string, unknown> | undefined)
              ctx.record.entity_id = 'entity-1'
              return { text: JSON.stringify({ record: ctx.record, customFields: ctx.customFields }) }
            },
          },
        ],
      },
    ]
    const record = {
      id: 'profile-1',
      legal_name: 'Acme Ltd',
      entity_id: null,
      'cf:tax_number': 'GB123456',
      cf_tax_number: 'GB123456',
      'cf:industry_note': 'Wholesale',
    }
    const queryEngine: QueryEngine = {
      query: jest.fn(async (entity, opts) => {
        const filters = opts?.filters as { id?: string } | undefined
        if (entity === parentEntityId) {
          const items = options.parentRecord ? [options.parentRecord] : []
          return { items, total: items.length, page: 1, pageSize: 1 } as QueryResult
        }
        const items = filters?.id === record.id ? [{ ...record }] : []
        return { items, total: items.length, page: 1, pageSize: 1 } as QueryResult
      }),
    }
    const searchService = {
      index: jest.fn().mockResolvedValue(undefined),
      bulkIndex: jest.fn().mockResolvedValue(undefined),
    }
    const indexer = new SearchIndexer(searchService as never, moduleConfigs, {
      queryEngine,
      encryptedCustomFieldKeysResolver: options.resolver,
    })
    return { indexer, searchService, contexts, hydrated, record }
  }

  const encryptedTaxNumber = async (entityId: string) =>
    new Set(entityId === companyEntityId || entityId === parentEntityId ? ['tax_number'] : [])

  it('keeps encrypted custom fields out of the build context and its text', async () => {
    const { indexer, searchService, contexts, record } = setup({ resolver: encryptedTaxNumber })

    await indexer.indexRecord({
      entityId: companyEntityId,
      recordId: record.id,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      record: { ...record },
      customFields: { tax_number: 'GB123456', industry_note: 'Wholesale' },
    })

    expect(contexts[0].customFields).toEqual({ industry_note: 'Wholesale' })
    expect(contexts[0].record).not.toHaveProperty('cf:tax_number')
    expect(contexts[0].record).not.toHaveProperty('cf_tax_number')
    expect(contexts[0].record['cf:industry_note']).toBe('Wholesale')
    const indexed = searchService.index.mock.calls[0][0]
    expect(indexed.text).not.toContain('GB123456')
    expect(indexed.text).toContain('Wholesale')
  })

  it('keeps encrypted values in the indexed fields and applies record changes made while building', async () => {
    const { indexer, searchService, record } = setup({ resolver: encryptedTaxNumber })

    await indexer.indexRecord({
      entityId: companyEntityId,
      recordId: record.id,
      tenantId: 'tenant-1',
      record: { ...record },
      customFields: { tax_number: 'GB123456' },
    })

    const indexed = searchService.index.mock.calls[0][0]
    expect(indexed.fields['cf:tax_number']).toBe('GB123456')
    expect(indexed.fields.entity_id).toBe('entity-1')
    expect(Object.keys(indexed.fields)).toEqual(Object.keys(record))
  })

  it('removes encrypted custom fields from records hydrated through the build query engine', async () => {
    const { indexer, hydrated, record } = setup({
      resolver: encryptedTaxNumber,
      parentRecord: { id: 'entity-1', display_name: 'Acme', 'cf:tax_number': 'GB123456', 'cf:segment': 'B2B' },
    })

    await indexer.indexRecord({
      entityId: companyEntityId,
      recordId: record.id,
      tenantId: 'tenant-1',
      record: { ...record },
    })

    expect(hydrated[0]).toEqual({ id: 'entity-1', display_name: 'Acme', 'cf:segment': 'B2B' })
  })

  it('removes encrypted custom fields joined in from customFieldSources of another entity', async () => {
    const contexts: SearchBuildContext[] = []
    const hydrated: Array<Record<string, unknown> | undefined> = []
    const queryEngine: QueryEngine = {
      query: jest.fn(async () => ({
        items: [{ id: 'entity-1', 'cf:tax_number': 'GB123456', 'cf:segment': 'B2B' }],
        total: 1,
        page: 1,
        pageSize: 1,
      }) as QueryResult),
    }
    const indexer = new SearchIndexer({ index: jest.fn().mockResolvedValue(undefined) } as never, [
      {
        entities: [
          {
            entityId: companyEntityId,
            enabled: true,
            buildSource: async (ctx) => {
              contexts.push(ctx)
              const parent = await (ctx.queryEngine as QueryEngine).query(parentEntityId, {
                tenantId: 'tenant-1',
                includeCustomFields: true,
                customFieldSources: [{ entityId: companyEntityId, table: 'customer_companies' }],
              })
              hydrated.push(parent.items[0] as Record<string, unknown>)
              return { text: 'Acme' }
            },
          },
        ],
      },
    ], {
      queryEngine,
      encryptedCustomFieldKeysResolver: async (entityId) => new Set(entityId === companyEntityId ? ['tax_number'] : []),
    })

    await indexer.indexRecord({ entityId: companyEntityId, recordId: 'profile-1', tenantId: 'tenant-1', record: { id: 'profile-1' } })

    expect(contexts).toHaveLength(1)
    expect(hydrated[0]).toEqual({ id: 'entity-1', 'cf:segment': 'B2B' })
  })

  it('applies the same exclusion when records are built in a batch', async () => {
    const { indexer, searchService, contexts, record } = setup({ resolver: encryptedTaxNumber })

    await indexer.indexRecordsById({
      items: [{ entityId: companyEntityId, recordId: record.id }],
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })

    expect(contexts[0].customFields).toEqual({ industry_note: 'Wholesale' })
    expect(contexts[0].record).not.toHaveProperty('cf:tax_number')
    const [indexed] = searchService.bulkIndex.mock.calls[0][0]
    expect(indexed.text).not.toContain('GB123456')
    expect(indexed.fields['cf:tax_number']).toBe('GB123456')
    expect(indexed.fields.entity_id).toBe('entity-1')
  })

  it('resolves the encrypted definitions once per entity for a whole indexRecordsById batch', async () => {
    const resolver = jest.fn(encryptedTaxNumber)
    const { indexer, searchService, record } = setup({ resolver })
    const records = ['profile-1', 'profile-2', 'profile-3'].map((id) => ({ ...record, id }))
    ;(indexer as unknown as { queryEngine: QueryEngine }).queryEngine = {
      query: jest.fn(async (entity, opts) => {
        if (entity === parentEntityId) return { items: [], total: 0, page: 1, pageSize: 1 } as QueryResult
        const wantedId = (opts?.filters as { id?: string } | undefined)?.id
        const items = records.filter((candidate) => candidate.id === wantedId)
        return { items, total: items.length, page: 1, pageSize: 1 } as QueryResult
      }),
    }

    await indexer.indexRecordsById({
      items: records.map((candidate) => ({ entityId: companyEntityId, recordId: candidate.id })),
      tenantId: 'tenant-1',
    })

    expect(searchService.bulkIndex.mock.calls[0][0]).toHaveLength(3)
    expect(resolver.mock.calls.filter(([entityId]) => entityId === companyEntityId)).toHaveLength(1)
  })

  it('excludes a custom field whose query engine alias sanitizes its key', async () => {
    const { indexer, contexts, record } = setup({ resolver: async () => new Set(['order-ref', 'order_ref']) })

    await indexer.indexRecord({
      entityId: companyEntityId,
      recordId: record.id,
      tenantId: 'tenant-1',
      record: { ...record, cf_order_ref: 'REF-SECRET' },
    })

    expect(contexts[0].record).not.toHaveProperty('cf_order_ref')
  })

  it('applies keys a build callback deletes from a filtered record to the indexed fields', async () => {
    const { indexer, searchService, record } = setup({ resolver: encryptedTaxNumber })
    const config = (indexer as unknown as { entityConfigMap: Map<string, { buildSource?: (ctx: SearchBuildContext) => Promise<unknown> }> }).entityConfigMap.get(companyEntityId)
    const originalBuildSource = config?.buildSource
    if (config) {
      config.buildSource = async (ctx) => {
        delete ctx.record.legal_name
        return originalBuildSource?.(ctx)
      }
    }

    await indexer.indexRecord({
      entityId: companyEntityId,
      recordId: record.id,
      tenantId: 'tenant-1',
      record: { ...record },
    })

    const indexed = searchService.index.mock.calls[0][0]
    expect(indexed.fields).not.toHaveProperty('legal_name')
    expect(indexed.fields['cf:tax_number']).toBe('GB123456')
  })

  it('excludes every custom field when the encrypted definitions cannot be resolved', async () => {
    const { indexer, searchService, contexts, record } = setup({
      resolver: async () => {
        throw new Error('database unavailable')
      },
    })

    await indexer.indexRecord({
      entityId: companyEntityId,
      recordId: record.id,
      tenantId: 'tenant-1',
      record: { ...record },
      customFields: { tax_number: 'GB123456', industry_note: 'Wholesale' },
    })

    expect(contexts[0].customFields).toEqual({})
    expect(Object.keys(contexts[0].record).filter((key) => key.startsWith('cf'))).toEqual([])
    expect(searchService.index.mock.calls[0][0].text).not.toContain('GB123456')
  })

  it('leaves the build context unchanged without a resolver', async () => {
    const { indexer, contexts, record } = setup()
    const indexedRecord = { ...record }

    await indexer.indexRecord({
      entityId: companyEntityId,
      recordId: record.id,
      tenantId: 'tenant-1',
      record: indexedRecord,
      customFields: { tax_number: 'GB123456' },
    })

    expect(contexts[0].record).toBe(indexedRecord)
    expect(contexts[0].customFields).toEqual({ tax_number: 'GB123456' })
  })
})
