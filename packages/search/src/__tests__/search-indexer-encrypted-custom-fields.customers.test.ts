jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key),
  }),
}))

import { searchConfig } from '@open-mercato/core/modules/customers/search'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import { SearchIndexer } from '../indexer/search-indexer'
import { SearchService } from '../service'
import { VectorSearchStrategy, type EmbeddingService } from '../strategies/vector.strategy'
import type { VectorDriver, VectorDriverDocument } from '../vector/types'

/**
 * The customers Company source writes every custom field of the profile and of its customer
 * entity into its source text, which is the leak #7872 reported. These tests run the real
 * source through the indexer and the vector strategy, so the text the embedding provider
 * receives is the one asserted on.
 */

const companyEntityId = 'customers:customer_company_profile'
const customerEntityId = 'customers:customer_entity'
const profileSecret = 'GB-SECRET-123456'
const entitySecret = 'CREDIT-REVIEW-SECRET'

const encryptedKeysByEntity: Record<string, string[]> = {
  [companyEntityId]: ['tax_number'],
  [customerEntityId]: ['credit_review_note'],
}

const resolveEncryptedKeys = async (entityId: EntityId) => new Set(encryptedKeysByEntity[entityId] ?? [])

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

function createIndexer(rows: Array<Record<string, unknown>>) {
  const backend = createVectorBackend()
  const query = jest.fn(async () => ({ items: rows.map((row) => ({ ...row })), total: rows.length, page: 1, pageSize: 1 }))
  const queryEngine = { query } as unknown as QueryEngine
  const searchService = new SearchService({
    strategies: [new VectorSearchStrategy(backend.embeddingService, backend.driver)],
  })
  const indexer = new SearchIndexer(searchService, [searchConfig], {
    queryEngine,
    encryptedCustomFieldKeysResolver: resolveEncryptedKeys,
  })
  return { indexer, query, ...backend }
}

function storedCallbackOutput(document: VectorDriverDocument): string {
  return JSON.stringify({ presenter: document.presenter, url: document.url, links: document.links })
}

describe('SearchIndexer encrypted custom fields through the customers Company source', () => {
  it('keeps encrypted profile and customer-entity fields out of the embedded text and stored presenter', async () => {
    const { indexer, embeddedTexts, upserted } = createIndexer([
      {
        id: 'customer-entity-1',
        kind: 'company',
        display_name: 'Acme Ltd',
        'cf:credit_review_note': entitySecret,
        'cf:account_tier': 'Gold',
      },
    ])

    await indexer.indexRecord({
      entityId: companyEntityId,
      recordId: 'company-profile-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      record: {
        id: 'company-profile-1',
        entity_id: 'customer-entity-1',
        legal_name: 'Acme Ltd',
        'cf:tax_number': profileSecret,
        'cf:industry_note': 'Wholesale',
      },
      customFields: { tax_number: profileSecret, industry_note: 'Wholesale' },
    })

    expect(embeddedTexts).toHaveLength(1)
    const [text] = embeddedTexts
    expect(text).toContain('Acme Ltd')
    expect(text).toContain('Wholesale')
    expect(text).toContain('Gold')
    expect(text).not.toContain(profileSecret)
    expect(text).not.toContain(entitySecret)
    expect(upserted).toHaveLength(1)
    expect(storedCallbackOutput(upserted[0])).not.toContain(profileSecret)
    expect(storedCallbackOutput(upserted[0])).not.toContain(entitySecret)
  })

  it('keeps an encrypted profile field joined through customFieldSources out of the embedded text', async () => {
    const { indexer, query, embeddedTexts, upserted } = createIndexer([
      {
        id: 'customer-entity-2',
        kind: 'company',
        display_name: 'Beta GmbH',
        'cf:tax_number': profileSecret,
        'cf:account_tier': 'Silver',
      },
    ])

    await indexer.indexRecord({
      entityId: companyEntityId,
      recordId: 'company-profile-2',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      record: { id: 'company-profile-2', legal_name: 'Beta GmbH' },
    })

    const queryOptions = (query.mock.calls as unknown as Array<[string, { customFieldSources?: Array<{ entityId: string }> }]>)
      .find(([entity]) => entity === customerEntityId)?.[1]
    expect(queryOptions?.customFieldSources?.map((source) => source.entityId)).toContain(companyEntityId)
    expect(embeddedTexts).toHaveLength(1)
    expect(embeddedTexts[0]).toContain('Silver')
    expect(embeddedTexts[0]).not.toContain(profileSecret)
    expect(storedCallbackOutput(upserted[0])).not.toContain(profileSecret)
  })
})
