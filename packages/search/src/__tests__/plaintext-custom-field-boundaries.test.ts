import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { Kysely, SqliteDialect } from 'kysely'
import { createEncryptedCustomFieldKeysResolver, type CustomFieldDefinitionsDatabase } from '../lib/encrypted-custom-field-resolver'
import { SearchService } from '../service'
import { SearchIndexer } from '../indexer/search-indexer'
import { FullTextSearchStrategy } from '../strategies/fulltext.strategy'
import { VectorSearchStrategy } from '../strategies/vector.strategy'
import { TokenSearchStrategy } from '../strategies/token.strategy'
import type { FullTextSearchDriver, FullTextSearchDocument } from '../fulltext/types'
import type { VectorDriver } from '../vector/types'
import type { SearchEntityConfig, IndexableRecord } from '../types'
import type { QueryEngine, QueryResult } from '@open-mercato/shared/lib/query/types'
import type { EncryptedCustomFieldKeysResolver } from '../lib/encrypted-custom-field-resolver'
import { replaceSearchTokensForRecord, replaceSearchTokensForBatch } from '@open-mercato/core/modules/query_index/lib/search-tokens'
jest.mock('@open-mercato/core/modules/query_index/lib/search-tokens', () => ({
  replaceSearchTokensForRecord: jest.fn(async () => {}),
  replaceSearchTokensForBatch: jest.fn(async () => {}),
}))

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => mockReportError(...args) }),
}))

const mockReportError = jest.fn((..._args: unknown[]) => {})
const entityId = 'example:todo'

function makeFields(id = 'record-1') {
  return {
    id,
    title: 'Public title',
    organization_id: null,
    cf_secret: 'PRIVATE-ALIAS',
    'cf:secret': 'PRIVATE-CANONICAL',
    cf_order_ref: 'PRIVATE-SANITIZED',
    'cf:order-ref': 'PRIVATE-PUNCTUATED',
    cf_note: 'Visible custom note',
  }
}

function createHarness(options: {
  resolver?: EncryptedCustomFieldKeysResolver | null
  buildSource?: SearchEntityConfig['buildSource']
  records?: Record<string, unknown>[]
  bulkDriver?: boolean
} = {}) {
  const documents: FullTextSearchDocument[] = []
  const embeddings: string[] = []
  const driver: FullTextSearchDriver = {
    id: 'capture',
    ensureReady: async () => {},
    isHealthy: async () => true,
    search: async () => [],
    index: async (document) => { documents.push(document) },
    delete: async () => {},
    ...(options.bulkDriver === false ? {} : {
      bulkIndex: async (batch: FullTextSearchDocument[]) => { documents.push(...batch) },
    }),
  }
  const vectorDriver: VectorDriver = {
    id: 'pgvector',
    ensureReady: async () => {},
    upsert: async () => {},
    query: async () => [],
    delete: async () => {},
    getChecksum: async () => null,
  }
  const embeddingService = {
    available: true,
    createEmbedding: async (text: string) => { embeddings.push(text); return [0.1] },
  }
  const service = new SearchService({
    strategies: [new FullTextSearchStrategy(driver), new VectorSearchStrategy(embeddingService, vectorDriver), new TokenSearchStrategy({} as Kysely<unknown>)],
    defaultStrategies: ['fulltext', 'vector', 'tokens'],
  })
  const resolver = options.resolver === undefined
    ? jest.fn(async () => new Set(['secret', 'order-ref', 'order_ref']))
    : options.resolver
  const queryEngine: QueryEngine = {
    query: async (_entity, query) => {
      const id = (query?.filters as { id?: string } | undefined)?.id
      const rows = options.records ?? [makeFields()]
      const items = id ? rows.filter((row) => row.id === id) : rows
      return { items, total: items.length } as QueryResult
    },
  }
  const indexer = new SearchIndexer(service, [{ entities: [{ entityId, buildSource: options.buildSource }] }], {
    queryEngine,
    ...(resolver ? { encryptedCustomFieldKeysResolver: resolver } : {}),
  })
  return { indexer, service, documents, embeddings, resolver }
}

function expectPlaintextSafe(harness: ReturnType<typeof createHarness>, count = 1) {
  expect(harness.documents).toHaveLength(count)
  expect(harness.embeddings).toHaveLength(count)
  for (const document of harness.documents) {
    expect(document.fields).toEqual(expect.objectContaining({ title: 'Public title', cf_note: 'Visible custom note' }))
    expect(JSON.stringify(document)).not.toContain('PRIVATE-')
  }
  for (const text of harness.embeddings) {
    expect(text).toContain('Public title')
    expect(text).toContain('Visible custom note')
    expect(text).not.toContain('PRIVATE-')
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('plaintext custom-field boundaries (#7894)', () => {
  it.each(['direct', 'bulk', 'by-id', 'by-ids', 'reindex'] as const)('resolves organization policy from tenant-loaded rows through %s with real SQL', async (entryPoint) => {
    const sqlite = new DatabaseSync(':memory:')
    sqlite.exec(`create table custom_field_defs (
      entity_id text, key text, config_json text, deleted_at text, tenant_id text, organization_id text
    )`)
    const insert = sqlite.prepare('insert into custom_field_defs values (?, ?, ?, null, ?, ?)')
    insert.run(entityId, 'secret', JSON.stringify({ encrypted: true }), 'tenant-1', 'org-1')
    insert.run(entityId, 'note', JSON.stringify({ encrypted: true }), 'tenant-2', 'org-2')
    const database = new Kysely<CustomFieldDefinitionsDatabase>({
      dialect: new SqliteDialect({ database: {
        close: () => sqlite.close(),
        prepare: (query) => {
          const statement = sqlite.prepare(query)
          const values = (parameters: readonly unknown[]) => parameters as readonly SQLInputValue[]
          return {
            reader: statement.columns().length > 0,
            all: (parameters) => statement.all(...values(parameters)),
            run: (parameters) => statement.run(...values(parameters)),
            iterate: (parameters) => statement.iterate(...values(parameters)),
          }
        },
      } }),
    })
    try {
      const rows = [
        { ...makeFields('first'), organization_id: 'org-1', cf_secret: 'ORG-SECRET', 'cf:secret': 'ORG-SECRET' },
        { ...makeFields('second'), organization_id: 'org-2', cf_secret: 'Public second', 'cf:secret': 'Public second' },
      ]
      const harness = createHarness({ resolver: createEncryptedCustomFieldKeysResolver(database), records: rows })
      const params = rows.map((record) => ({ entityId, recordId: record.id, tenantId: 'tenant-1', record }))
      if (entryPoint === 'direct') {
        for (const param of params) await harness.indexer.indexRecord(param)
      } else if (entryPoint === 'bulk') {
        await harness.indexer.bulkIndexRecords(params)
      } else if (entryPoint === 'by-id') {
        for (const param of params) await harness.indexer.indexRecordById(param)
      } else if (entryPoint === 'by-ids') {
        await harness.indexer.indexRecordsById({ tenantId: 'tenant-1', items: params })
      } else {
        expect((await harness.indexer.reindexEntity({ entityId, tenantId: 'tenant-1' })).success).toBe(true)
      }
      expect(harness.documents).toHaveLength(2)
      expect(harness.documents[0].fields).not.toHaveProperty('cf_secret')
      expect(harness.documents[0].fields).not.toHaveProperty('cf:secret')
      expect(harness.embeddings[0]).not.toContain('ORG-SECRET')
      expect(harness.documents[1].fields.cf_secret).toBe('Public second')
      expect(harness.documents[1].fields.cf_note).toBe('Visible custom note')
      const tokenDocuments = [
        ...jest.mocked(replaceSearchTokensForRecord).mock.calls.map((call) => call[1].doc),
        ...jest.mocked(replaceSearchTokensForBatch).mock.calls.flatMap((call) => call[1].map((record) => record.doc)),
      ]
      expect(tokenDocuments).toHaveLength(2)
      expect(tokenDocuments[0]['cf:secret']).toBe('ORG-SECRET')
    } finally {
      await database.destroy()
    }
  })

  it('denies plaintext custom fields when neither operation nor row proves organization scope', async () => {
    const resolver = jest.fn(async () => new Set<string>())
    const harness = createHarness({ resolver })
    const { organization_id: _organizationId, ...record } = makeFields()
    await harness.indexer.indexRecord({ entityId, recordId: 'record-1', tenantId: 'tenant-1', record })
    expect(harness.documents[0].fields).toEqual({ id: 'record-1', title: 'Public title' })
    expect(resolver).not.toHaveBeenCalled()
  })

  it('isolates exclusion cache entries by trusted tenant and organization', async () => {
    const resolver = jest.fn(async () => new Set(['secret', 'order-ref', 'order_ref']))
    const harness = createHarness({ resolver })
    await harness.indexer.bulkIndexRecords([
      { entityId, recordId: 'first', tenantId: 'tenant-1', organizationId: 'org-1', record: makeFields('first') },
      { entityId, recordId: 'second', tenantId: 'tenant-2', organizationId: 'org-1', record: makeFields('second') },
      { entityId, recordId: 'third', tenantId: 'tenant-1', organizationId: 'org-2', record: makeFields('third') },
    ])
    expect(resolver.mock.calls).toEqual([
      [entityId, { tenantId: 'tenant-1', organizationId: 'org-1' }],
      [entityId, { tenantId: 'tenant-2', organizationId: 'org-1' }],
      [entityId, { tenantId: 'tenant-1', organizationId: 'org-2' }],
    ])
    expectPlaintextSafe(harness, 3)
  })

  it('filters canonical, aliased and sanitized keys before real fulltext/vector strategies, retaining token input and the original record', async () => {
    const harness = createHarness()
    const fields = makeFields()
    const original = { ...fields }

    await harness.indexer.indexRecord({ entityId, recordId: 'record-1', tenantId: 'tenant-1', record: fields })

    expectPlaintextSafe(harness)
    expect(jest.mocked(replaceSearchTokensForRecord).mock.calls[0][1].doc).toEqual(expect.objectContaining({
      'cf:secret': 'PRIVATE-CANONICAL', 'cf:order_ref': 'PRIVATE-SANITIZED', 'cf:order-ref': 'PRIVATE-PUNCTUATED',
    }))
    expect(fields).toEqual(original)
  })

  it.each([true, false])('protects bulk indexing with native driver bulk=%s and shares one entity lookup', async (bulkDriver) => {
    const resolver = jest.fn(async () => new Set(['secret', 'order-ref', 'order_ref']))
    const harness = createHarness({ resolver, bulkDriver })
    const rows = [makeFields('first'), makeFields('second')]

    await harness.indexer.bulkIndexRecords(rows.map((record) => ({ entityId, recordId: record.id, tenantId: 'tenant-1', record })))

    expectPlaintextSafe(harness, 2)
    expect(resolver).toHaveBeenCalledTimes(1)
    const payloads = jest.mocked(replaceSearchTokensForBatch).mock.calls[0][1]
    expect(payloads.map((record) => record.doc['cf:secret'])).toEqual(['PRIVATE-CANONICAL', 'PRIVATE-CANONICAL'])
  })

  it('protects ID-loaded batches used by queue workers with one lookup per entity', async () => {
    const resolver = jest.fn(async () => new Set(['secret', 'order-ref', 'order_ref']))
    const rows = [makeFields('first'), makeFields('second')]
    const harness = createHarness({ resolver, records: rows })

    await harness.indexer.indexRecordsById({ items: rows.map((record) => ({ entityId, recordId: record.id })), tenantId: 'tenant-1' })

    expectPlaintextSafe(harness, 2)
    expect(resolver).toHaveBeenCalledTimes(1)
  })

  it('protects the reindex builder as well as direct and ID-loaded indexing', async () => {
    const harness = createHarness()

    const result = await harness.indexer.reindexEntity({ entityId, tenantId: 'tenant-1' })

    expect(result.success).toBe(true)
    expectPlaintextSafe(harness)
  })

  it.each(['by-id', 'bulk', 'reindex'] as const)('keeps fulltext exclusions and skips vector fallback when buildSource throws through %s', async (entryPoint) => {
    const harness = createHarness({ buildSource: async () => { throw new Error('[internal] Source unavailable') } })

    if (entryPoint === 'by-id') {
      await harness.indexer.indexRecordById({ entityId, recordId: 'record-1', tenantId: 'tenant-1' })
    } else if (entryPoint === 'bulk') {
      await harness.indexer.bulkIndexRecords([{ entityId, recordId: 'record-1', tenantId: 'tenant-1', record: makeFields() }])
    } else {
      const result = await harness.indexer.reindexEntity({ entityId, tenantId: 'tenant-1' })
      expect(result.success).toBe(true)
    }

    expect(harness.documents).toHaveLength(1)
    expect(harness.documents[0].fields).toEqual({ id: 'record-1', organization_id: null, title: 'Public title', cf_note: 'Visible custom note' })
    expect(JSON.stringify(harness.documents[0])).not.toContain('PRIVATE-')
    expect(harness.embeddings).toEqual([])
    const tokenDocuments = [
      ...jest.mocked(replaceSearchTokensForRecord).mock.calls.map((call) => call[1].doc),
      ...jest.mocked(replaceSearchTokensForBatch).mock.calls.flatMap((call) => call[1].map((record) => record.doc)),
    ]
    expect(tokenDocuments).toHaveLength(1)
    expect(tokenDocuments[0]).toEqual(expect.objectContaining({ 'cf:secret': 'PRIVATE-CANONICAL', 'cf:note': 'Visible custom note' }))
  })

  it.each(['async', 'sync'] as const)('fails closed for all custom fields on a %s resolver error while token inputs remain unchanged', async (kind) => {
    const error = new Error('[internal] Definition lookup unavailable')
    const resolver: EncryptedCustomFieldKeysResolver = kind === 'async'
      ? async () => { throw error }
      : () => { throw error }
    const harness = createHarness({ resolver })

    await harness.indexer.indexRecord({ entityId, recordId: 'record-1', tenantId: 'tenant-1', record: makeFields() })

    expect(harness.documents[0].fields).toEqual({ id: 'record-1', organization_id: null, title: 'Public title' })
    expect(harness.embeddings[0]).toBe('record-1 Public title')
    expect(jest.mocked(replaceSearchTokensForRecord).mock.calls[0][1].doc).toEqual(expect.objectContaining({ 'cf:secret': 'PRIVATE-CANONICAL', 'cf:note': 'Visible custom note' }))
    expect(mockReportError).toHaveBeenCalledWith(error, expect.objectContaining({ code: 'search.encrypted_custom_fields_unresolved' }))
  })

  it('refreshes definitions on each indexing call instead of reusing an older positive policy', async () => {
    const resolver = jest.fn<ReturnType<EncryptedCustomFieldKeysResolver>, Parameters<EncryptedCustomFieldKeysResolver>>()
      .mockResolvedValueOnce(new Set()).mockResolvedValueOnce(new Set(['secret', 'order-ref', 'order_ref']))
    const harness = createHarness({ resolver })
    const params = { entityId, recordId: 'record-1', tenantId: 'tenant-1', record: makeFields() }

    await harness.indexer.indexRecord(params)
    await harness.indexer.indexRecord(params)

    expect(harness.documents[0].fields.cf_secret).toBe('PRIVATE-ALIAS')
    expect(JSON.stringify(harness.documents[1])).not.toContain('PRIVATE-')
    expect(resolver).toHaveBeenCalledTimes(2)
  })

  it('preserves explicit source text but denies custom fields without metadata', async () => {
    const harness = createHarness({ resolver: null, buildSource: async () => ({ text: 'Explicit source text' }) })

    await harness.indexer.indexRecord({ entityId, recordId: 'record-1', tenantId: 'tenant-1', record: makeFields() })

    expect(harness.embeddings).toEqual(['Explicit source text'])
    expect(harness.documents[0].fields).toEqual({ id: 'record-1', organization_id: null, title: 'Public title' })
  })

  it('fails closed for direct service clients without exclusion metadata while preserving token inputs', async () => {
    const harness = createHarness({ resolver: null })
    await harness.service.index({ entityId, recordId: 'record-1', tenantId: 'tenant-1', fields: makeFields() })
    expect(harness.documents[0].fields).toEqual({ id: 'record-1', organization_id: null, title: 'Public title' })
    expect(harness.embeddings).toEqual(['record-1 Public title'])
    expect(jest.mocked(replaceSearchTokensForRecord).mock.calls[0][1].doc['cf:secret']).toBe('PRIVATE-CANONICAL')
  })

  it('keeps exclusion metadata effective after JSON serialization for custom direct clients', async () => {
    const harness = createHarness({ resolver: null })
    const record: IndexableRecord = { entityId, recordId: 'record-1', tenantId: 'tenant-1', fields: makeFields(), plaintextExcludedCustomFields: ['secret', 'order-ref'] }

    await harness.service.index(JSON.parse(JSON.stringify(record)) as IndexableRecord)

    expectPlaintextSafe(harness)
  })
})
