import { SearchIndexer } from '../indexer/search-indexer'
import type { SearchBuildContext, SearchModuleConfig } from '../types'
import type { QueryEngine, QueryResult } from '@open-mercato/shared/lib/query/types'
import { registerTelemetryRuntime, type TelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

describe('SearchIndexer encrypted custom fields', () => {
  const companyEntityId = 'customers:customer_company_profile'
  const parentEntityId = 'customers:customer_entity'

  function setup(options: {
    resolver?: (entityId: string, tenantId?: string | null) => Promise<Set<string>>
    parentRecord?: Record<string, unknown>
    loadParent?: boolean
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
              if (options.loadParent !== false) {
                const engine = ctx.queryEngine as QueryEngine | undefined
                const parent = await engine?.query(parentEntityId, { tenantId: 'tenant-1', filters: { id: 'entity-1' } })
                hydrated.push(parent?.items[0] as Record<string, unknown> | undefined)
              }
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
    const resolver = jest.fn(encryptedTaxNumber)
    const { indexer, hydrated, record } = setup({
      resolver,
      parentRecord: { id: 'entity-1', display_name: 'Acme', 'cf:tax_number': 'GB123456', 'cf:segment': 'B2B' },
    })

    await indexer.indexRecord({
      entityId: companyEntityId,
      recordId: record.id,
      tenantId: 'tenant-1',
      record: { ...record },
    })

    expect(hydrated[0]).toEqual({ id: 'entity-1', display_name: 'Acme', 'cf:segment': 'B2B' })
    expect(resolver.mock.calls).toEqual([
      [companyEntityId, 'tenant-1'],
      [parentEntityId, 'tenant-1'],
    ])
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

  it('excludes encrypted keys passed with a cf: or cf_ prefix in customFields', async () => {
    const { indexer, contexts, record } = setup({ resolver: encryptedTaxNumber })

    await indexer.indexRecord({
      entityId: companyEntityId,
      recordId: record.id,
      tenantId: 'tenant-1',
      record: { ...record },
      customFields: { 'cf:tax_number': 'GB123456', cf_tax_number: 'GB123456', 'cf:industry_note': 'Wholesale' },
    })

    expect(contexts[0].customFields).toEqual({ 'cf:industry_note': 'Wholesale' })
  })

  it('memoizes a failed definition lookup for the batch and normalizes non-Error failures', async () => {
    const rejectedValue = { credentials: 'must-not-reach-telemetry' }
    const resolver = jest.fn().mockRejectedValue(rejectedValue)
    const reportError = jest.fn()
    const unregister = registerTelemetryRuntime({ reportError } as unknown as TelemetryRuntime)
    try {
      const { indexer, contexts, record } = setup({ resolver, loadParent: false })
      const records = ['profile-1', 'profile-2'].map((id) => ({ ...record, id }))
      ;(indexer as unknown as { queryEngine: QueryEngine }).queryEngine = {
        query: jest.fn(async (_entity, opts) => {
          const wantedId = (opts?.filters as { id?: string } | undefined)?.id
          const items = records.filter((candidate) => candidate.id === wantedId)
          return { items, total: items.length, page: 1, pageSize: 1 } as QueryResult
        }),
      }

      await indexer.indexRecordsById({
        items: records.map((candidate) => ({ entityId: companyEntityId, recordId: candidate.id })),
        tenantId: 'tenant-1',
      })

      const customFieldKeys = contexts.map((ctx) => Object.keys(ctx.record).filter((key) => key.startsWith('cf')))
      expect(customFieldKeys).toEqual([[], []])
      expect(resolver).toHaveBeenCalledTimes(1)
      expect(reportError).toHaveBeenCalledTimes(1)
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({ message: '[internal] Encrypted custom-field resolver rejected with a non-Error value' }),
        {
          module: 'search',
          code: 'search.encrypted_custom_fields_unresolved',
          attributes: { entityId: companyEntityId },
        },
      )
      expect(reportError.mock.calls[0][0]).not.toBe(rejectedValue)
    } finally {
      unregister()
    }
  })

  it('memoizes a failed definition lookup across a direct vector reindex operation', async () => {
    const resolver = jest.fn().mockRejectedValue(new Error('database unavailable'))
    const reportError = jest.fn()
    const unregister = registerTelemetryRuntime({ reportError } as unknown as TelemetryRuntime)
    try {
      const { indexer, contexts, record } = setup({ resolver, loadParent: false })
      const records = ['profile-1', 'profile-2'].map((id) => ({ ...record, id }))
      ;(indexer as unknown as { queryEngine: QueryEngine }).queryEngine = {
        query: jest.fn(async (_entity, opts) => {
          const wantedId = (opts?.filters as { id?: string } | undefined)?.id
          const items = wantedId
            ? records.filter((candidate) => candidate.id === wantedId)
            : records
          return { items, total: items.length, page: 1, pageSize: 200 } as QueryResult
        }),
      }

      const result = await indexer.reindexEntityToVector({
        entityId: companyEntityId,
        tenantId: 'tenant-1',
        useQueue: false,
      })

      expect(result).toEqual(expect.objectContaining({ success: true, recordsIndexed: 2 }))
      expect(contexts).toHaveLength(2)
      expect(contexts.map((ctx) => Object.keys(ctx.record).filter((key) => key.startsWith('cf')))).toEqual([[], []])
      expect(resolver).toHaveBeenCalledTimes(1)
      expect(reportError).toHaveBeenCalledTimes(1)
    } finally {
      unregister()
    }
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

  it('excludes every custom field when the resolver throws synchronously', async () => {
    const { indexer, contexts, record } = setup({
      resolver: () => {
        throw new Error('resolver misconfigured')
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
  })

  it('excludes every custom field and reports it when constructed without a resolver', async () => {
    const reportError = jest.fn()
    const unregister = registerTelemetryRuntime({ reportError } as unknown as TelemetryRuntime)
    try {
      const { indexer, searchService, contexts, hydrated, record } = setup({
        parentRecord: { id: 'entity-1', display_name: 'Acme', 'cf:vat_id': 'PL555', cf_vat_id: 'PL555' },
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
      expect(hydrated[0]).toEqual({ id: 'entity-1', display_name: 'Acme' })
      expect(searchService.index.mock.calls[0][0].text).not.toContain('GB123456')
      expect(searchService.index.mock.calls[0][0].fields['cf:tax_number']).toBe('GB123456')
      expect(reportError).toHaveBeenCalledWith(expect.any(Error), {
        module: 'search',
        code: 'search.encrypted_custom_fields_resolver_missing',
      })
    } finally {
      unregister()
    }
  })
})
