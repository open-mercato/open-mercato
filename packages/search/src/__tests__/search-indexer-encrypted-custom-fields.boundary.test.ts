import { SearchIndexer } from '../indexer/search-indexer'
import { SearchService } from '../service'
import { FullTextSearchStrategy } from '../strategies/fulltext.strategy'
import { VectorSearchStrategy, type EmbeddingService } from '../strategies/vector.strategy'
import type { FullTextSearchDocument, FullTextSearchDriver } from '../fulltext/types'
import type { VectorDriver, VectorDriverDocument } from '../vector/types'
import type { SearchBuildContext, SearchModuleConfig } from '../types'
import { registerTelemetryRuntime, type TelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

const companyEntityId = 'customers:customer_company_profile'
const secret = 'GB-SECRET-123456'

function describeRecord(ctx: SearchBuildContext): string {
  return JSON.stringify({ record: ctx.record, customFields: ctx.customFields })
}

const moduleConfigs: SearchModuleConfig[] = [
  {
    entities: [
      {
        entityId: companyEntityId,
        enabled: true,
        buildSource: async (ctx) => ({ text: describeRecord(ctx) }),
        formatResult: async (ctx) => ({ title: 'Acme Ltd', subtitle: describeRecord(ctx) }),
        resolveUrl: async (ctx) => `/backend/companies?context=${encodeURIComponent(describeRecord(ctx))}`,
        resolveLinks: async (ctx) => [{ href: '/backend/companies', label: describeRecord(ctx), kind: 'primary' }],
      },
    ],
  },
]

function createRecord(): Record<string, unknown> {
  return {
    id: 'profile-1',
    legal_name: 'Acme Ltd',
    'cf:tax_number': secret,
    'cf:industry_note': 'Wholesale',
  }
}

function createFulltextDriver() {
  const documents: FullTextSearchDocument[] = []
  const driver: FullTextSearchDriver = {
    id: 'meilisearch',
    ensureReady: async () => undefined,
    isHealthy: async () => true,
    search: async () => [],
    index: async (doc) => {
      documents.push(doc)
    },
    bulkIndex: async (docs) => {
      documents.push(...docs)
    },
    delete: async () => undefined,
  }
  return { driver, documents }
}

function createVectorBackend() {
  const embeddedTexts: string[] = []
  const upserted: VectorDriverDocument[] = []
  const embeddingService: EmbeddingService = {
    available: true,
    createEmbedding: async (text) => {
      embeddedTexts.push(text)
      return [0.1, 0.2]
    },
  }
  const driver: VectorDriver = {
    id: 'pgvector',
    ensureReady: async () => undefined,
    upsert: async (doc) => {
      upserted.push(doc)
    },
    delete: async () => undefined,
    query: async () => [],
    getChecksum: async () => null,
  }
  return { embeddingService, driver, embeddedTexts, upserted }
}

const encryptedTaxNumber = async () => new Set(['tax_number'])

describe('SearchIndexer encrypted custom fields at the strategy boundary', () => {
  it('keeps encrypted values out of the documents bulkIndexRecords sends to the fulltext driver', async () => {
    const { driver, documents } = createFulltextDriver()
    const searchService = new SearchService({ strategies: [new FullTextSearchStrategy(driver)] })
    const indexer = new SearchIndexer(searchService, moduleConfigs, {
      encryptedCustomFieldKeysResolver: encryptedTaxNumber,
    })

    await indexer.bulkIndexRecords([
      {
        entityId: companyEntityId,
        recordId: 'profile-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        record: createRecord(),
        customFields: { tax_number: secret, industry_note: 'Wholesale' },
      },
    ])

    expect(documents).toHaveLength(1)
    const [document] = documents
    const callbackOutput = JSON.stringify({ presenter: document.presenter, url: document.url, links: document.links })
    expect(callbackOutput).not.toContain(secret)
    expect(callbackOutput).toContain('Wholesale')
  })

  it('keeps encrypted values out of the text and presenter indexRecord sends to the embedding provider', async () => {
    const { embeddingService, driver, embeddedTexts, upserted } = createVectorBackend()
    const searchService = new SearchService({ strategies: [new VectorSearchStrategy(embeddingService, driver)] })
    const indexer = new SearchIndexer(searchService, moduleConfigs, {
      encryptedCustomFieldKeysResolver: encryptedTaxNumber,
    })

    await indexer.indexRecord({
      entityId: companyEntityId,
      recordId: 'profile-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      record: createRecord(),
      customFields: { tax_number: secret, industry_note: 'Wholesale' },
    })

    expect(embeddedTexts).toHaveLength(1)
    expect(embeddedTexts[0]).not.toContain(secret)
    expect(embeddedTexts[0]).toContain('Wholesale')
    expect(JSON.stringify({ presenter: upserted[0].presenter, url: upserted[0].url, links: upserted[0].links })).not.toContain(secret)
  })

  it('reports an unresolved definition lookup and leaves every custom field out of bulk documents', async () => {
    const reportError = jest.fn()
    const unregister = registerTelemetryRuntime({ reportError } as unknown as TelemetryRuntime)
    try {
      const { driver, documents } = createFulltextDriver()
      const searchService = new SearchService({ strategies: [new FullTextSearchStrategy(driver)] })
      const failure = new Error('custom_field_defs unavailable')
      const indexer = new SearchIndexer(searchService, moduleConfigs, {
        encryptedCustomFieldKeysResolver: async () => {
          throw failure
        },
      })

      await indexer.bulkIndexRecords([
        {
          entityId: companyEntityId,
          recordId: 'profile-1',
          tenantId: 'tenant-1',
          record: createRecord(),
          customFields: { tax_number: secret, industry_note: 'Wholesale' },
        },
      ])

      const callbackOutput = JSON.stringify(documents[0].presenter)
      expect(callbackOutput).not.toContain(secret)
      expect(callbackOutput).not.toContain('Wholesale')
      expect(reportError).toHaveBeenCalledWith(failure, {
        module: 'search',
        code: 'search.encrypted_custom_fields_unresolved',
        attributes: { entityId: companyEntityId },
      })
    } finally {
      unregister()
    }
  })

  it('keeps indexing when the telemetry runtime itself throws', async () => {
    const unregister = registerTelemetryRuntime({
      reportError: () => {
        throw new Error('telemetry down')
      },
    } as unknown as TelemetryRuntime)
    try {
      const { driver, documents } = createFulltextDriver()
      const searchService = new SearchService({ strategies: [new FullTextSearchStrategy(driver)] })
      const indexer = new SearchIndexer(searchService, moduleConfigs, {
        encryptedCustomFieldKeysResolver: async () => {
          throw new Error('custom_field_defs unavailable')
        },
      })

      await indexer.bulkIndexRecords([
        { entityId: companyEntityId, recordId: 'profile-1', tenantId: 'tenant-1', record: createRecord() },
      ])

      expect(documents).toHaveLength(1)
      expect(JSON.stringify(documents[0].presenter)).not.toContain(secret)
    } finally {
      unregister()
    }
  })
})
