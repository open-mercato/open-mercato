const mockGetAuthFromRequest = jest.fn()
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))

const mockCreateRequestContainer = jest.fn()
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

const mockResolveOrganizationScopeForRequest = jest.fn()
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) => mockResolveOrganizationScopeForRequest(...args),
}))

jest.mock('../../lib/embedding-config', () => ({
  resolveEmbeddingConfig: jest.fn().mockResolvedValue(null),
}))

jest.mock('../../lib/global-search-config', () => ({
  resolveGlobalSearchStrategies: jest.fn().mockResolvedValue(['fulltext', 'vector', 'tokens']),
}))

jest.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => ({ get: (name: string) => (name === 'accept-language' ? 'pl-PL' : null) }),
}))

import type { Kysely } from 'kysely'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import type { Module } from '@open-mercato/shared/modules/registry'
import type { SearchEntityConfig, SearchResult, SearchStrategy, SearchStrategyId } from '../../../../types'
import { registerModules, resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { SearchService } from '../../../../service'
import { createPresenterEnricher } from '../../../../lib/presenter-enricher'
import { GET } from '../search/global/route'

const DEMO_ENTITY_ID = 'demo:thing' as EntityId

function createDatabase(rows: Array<{ entity_type: string; entity_id: string; doc: Record<string, unknown> }>) {
  const chain = {
    selectFrom: () => chain,
    select: () => chain,
    where: () => chain,
    execute: async () => rows,
  }
  return chain as unknown as Kysely<Record<string, never>>
}

function createStrategy(source: SearchStrategyId, recordId: string): SearchStrategy {
  const result: SearchResult = {
    entityId: DEMO_ENTITY_ID,
    recordId,
    organizationId: 'org-1',
    score: 1,
    source,
    presenter: { title: recordId, badge: 'Person' },
    links: [{ href: `/backend/demo/${recordId}`, label: 'Open person', kind: 'primary' }],
  }

  return {
    id: source,
    name: source,
    priority: 10,
    isAvailable: async () => true,
    ensureReady: async () => undefined,
    search: async () => [result],
    index: async () => undefined,
    delete: async () => undefined,
  }
}

describe('GET /api/search/search/global presenter localization', () => {
  beforeAll(() => {
    registerModules([
      {
        id: 'demo',
        translations: {
          en: {
            'demo.search.badge': 'Person',
            'demo.search.link.open': 'Open person',
          },
          pl: {
            'demo.search.badge': 'Osoba',
            'demo.search.link.open': 'Otwórz osobę',
          },
        },
      },
    ] satisfies Module[])
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({
      tenantId: 'tenant-1',
      orgId: 'org-1',
      sub: 'user-1',
      isSuperAdmin: false,
    })
    mockResolveOrganizationScopeForRequest.mockResolvedValue({
      selectedId: 'org-1',
      filterIds: ['org-1'],
      allowedIds: ['org-1'],
      tenantId: 'tenant-1',
    })
  })

  it('replaces frozen presenters and links for fulltext, vector, and tokens using Accept-Language', async () => {
    const rows = ['fulltext-record', 'vector-record', 'tokens-record'].map((recordId) => ({
      entity_type: DEMO_ENTITY_ID,
      entity_id: recordId,
      doc: { id: recordId, title: recordId },
    }))
    const config: SearchEntityConfig = {
      entityId: DEMO_ENTITY_ID,
      enabled: true,
      formatResult: async (context) => {
        const { t } = await resolveTranslations()
        return {
          title: String(context.record.title),
          badge: t('demo.search.badge', 'Person'),
        }
      },
      resolveLinks: async (context) => {
        const { t } = await resolveTranslations()
        return [{
          href: `/backend/demo/${String(context.record.id)}`,
          label: t('demo.search.link.open', 'Open person'),
          kind: 'primary',
        }]
      },
    }
    const configMap = new Map<EntityId, SearchEntityConfig>([[DEMO_ENTITY_ID, config]])
    const presenterEnricher = createPresenterEnricher(createDatabase(rows), configMap)
    const searchService = new SearchService({
      strategies: [
        createStrategy('fulltext', 'fulltext-record'),
        createStrategy('vector', 'vector-record'),
        createStrategy('tokens', 'tokens-record'),
      ],
      defaultStrategies: ['fulltext', 'vector', 'tokens'],
      presenterEnricher,
    })
    const container = {
      resolve: jest.fn((name: string) => (name === 'searchService' ? searchService : undefined)),
      dispose: jest.fn().mockResolvedValue(undefined),
    }
    mockCreateRequestContainer.mockResolvedValue(container)

    const request = new Request('http://localhost/api/search/search/global?q=person', {
      headers: { 'accept-language': 'pl-PL' },
    })
    const response = await GET(request)
    const body = await response.json() as {
      results: SearchResult[]
      strategiesUsed: SearchStrategyId[]
    }

    expect(response.status).toBe(200)
    expect(body.results).toHaveLength(3)
    expect(body.strategiesUsed).toEqual(expect.arrayContaining(['fulltext', 'vector', 'tokens']))
    for (const result of body.results) {
      expect(result.presenter?.badge).toBe('Osoba')
      expect(result.links?.[0]?.label).toBe('Otwórz osobę')
    }
  })

  it('returns one navigable result for each customer entity and profile pair', async () => {
    const rows = [
      {
        entity_type: 'customers:customer_entity',
        entity_id: 'person-entity',
        doc: { id: 'person-entity', display_name: 'Ada Lovelace', kind: 'person' },
      },
      {
        entity_type: 'customers:customer_person_profile',
        entity_id: 'person-profile',
        doc: { id: 'person-profile', entity_id: 'person-entity', display_name: 'Ada Lovelace' },
      },
      {
        entity_type: 'customers:customer_entity',
        entity_id: 'company-entity',
        doc: { id: 'company-entity', display_name: 'Analytical Engines', kind: 'company' },
      },
      {
        entity_type: 'customers:customer_company_profile',
        entity_id: 'company-profile',
        doc: { id: 'company-profile', entity_id: 'company-entity', display_name: 'Analytical Engines' },
      },
    ]
    const personEntityId = 'customers:customer_person_profile' as EntityId
    const companyEntityId = 'customers:customer_company_profile' as EntityId
    const configMap = new Map<EntityId, SearchEntityConfig>([
      [personEntityId, {
        entityId: personEntityId,
        formatResult: async (context) => ({ title: String(context.record.display_name) }),
        resolveUrl: async (context) => `/backend/customers/people-v2/${String(context.record.entity_id)}`,
      }],
      [companyEntityId, {
        entityId: companyEntityId,
        formatResult: async (context) => ({ title: String(context.record.display_name) }),
        resolveUrl: async (context) => `/backend/customers/companies-v2/${String(context.record.entity_id)}`,
      }],
    ])
    const results: SearchResult[] = rows.map((row, index) => ({
      entityId: row.entity_type as EntityId,
      recordId: row.entity_id,
      organizationId: 'org-1',
      score: 1 - (index * 0.1),
      source: 'tokens',
    }))
    const strategy: SearchStrategy = {
      id: 'tokens',
      name: 'tokens',
      priority: 10,
      isAvailable: async () => true,
      ensureReady: async () => undefined,
      search: async () => results,
      index: async () => undefined,
      delete: async () => undefined,
    }
    const searchService = new SearchService({
      strategies: [strategy],
      defaultStrategies: ['tokens'],
      presenterEnricher: createPresenterEnricher(createDatabase(rows), configMap),
    })
    const container = {
      resolve: jest.fn((name: string) => (name === 'searchService' ? searchService : undefined)),
      dispose: jest.fn().mockResolvedValue(undefined),
    }
    mockCreateRequestContainer.mockResolvedValue(container)

    const response = await GET(new Request('http://localhost/api/search/search/global?q=customer'))
    const body = await response.json() as { results: SearchResult[] }

    expect(response.status).toBe(200)
    expect(body.results).toEqual([
      expect.objectContaining({
        entityId: 'customers:customer_entity',
        recordId: 'person-entity',
        presenter: expect.objectContaining({ title: 'Ada Lovelace' }),
        url: '/backend/customers/people-v2/person-entity',
      }),
      expect.objectContaining({
        entityId: 'customers:customer_entity',
        recordId: 'company-entity',
        presenter: expect.objectContaining({ title: 'Analytical Engines' }),
        url: '/backend/customers/companies-v2/company-entity',
      }),
    ])
  })
})
