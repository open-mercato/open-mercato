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

/**
 * The route resolves `rbacService` and `searchIndexer` to drop results whose entity
 * type the caller has no view feature for (issue #5163), so the container mock has
 * to answer for both.
 */
function createContainer(
  searchService: SearchService,
  configMap: Map<EntityId, SearchEntityConfig>,
  acl: { features: string[]; isSuperAdmin?: boolean },
) {
  const registrations: Record<string, unknown> = {
    searchService,
    searchIndexer: {
      getEntityConfig: (entityId: string) => configMap.get(entityId as EntityId),
      getAllEntityConfigs: () => [...configMap.values()],
    },
    rbacService: {
      loadAcl: async () => ({
        isSuperAdmin: acl.isSuperAdmin ?? false,
        features: acl.features,
        organizations: null,
      }),
    },
  }
  return {
    hasRegistration: (name: string) => name in registrations,
    resolve: jest.fn((name: string) => registrations[name]),
    dispose: jest.fn().mockResolvedValue(undefined),
  }
}

function buildDemoSearchService() {
  const rows = ['fulltext-record', 'vector-record', 'tokens-record'].map((recordId) => ({
    entity_type: DEMO_ENTITY_ID,
    entity_id: recordId,
    doc: { id: recordId, title: recordId },
  }))
  const config: SearchEntityConfig = {
    entityId: DEMO_ENTITY_ID,
    enabled: true,
    aclFeatures: ['demo.view'],
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
  const searchService = new SearchService({
    strategies: [
      createStrategy('fulltext', 'fulltext-record'),
      createStrategy('vector', 'vector-record'),
      createStrategy('tokens', 'tokens-record'),
    ],
    defaultStrategies: ['fulltext', 'vector', 'tokens'],
    presenterEnricher: createPresenterEnricher(createDatabase(rows), configMap),
  })
  return { searchService, configMap }
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
    const { searchService, configMap } = buildDemoSearchService()
    mockCreateRequestContainer.mockResolvedValue(
      createContainer(searchService, configMap, { features: ['search.global', 'demo.view'] }),
    )

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

  // Covers OM_SEARCH_CUSTOMERS_INDEX_BASE_ENTITY=true, where base customer rows are tokenized and
  // the route can therefore receive both halves of a pair. Under the default the token strategy
  // never returns the base rows at all (see token-strategy-entity-exclusion.test.ts); the strategy
  // here is a stub that yields them regardless, so this pins the merge itself.
  it('merges a customer entity and profile pair into one navigable result when both are indexed', async () => {
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
      {
        entity_type: 'orders:order',
        entity_id: 'order-1',
        doc: { id: 'order-1', title: 'Order 1' },
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
    const scoresByRecordId: Record<string, number> = {
      'person-profile': 0.95,
      'company-profile': 0.85,
      'order-1': 0.5,
      'person-entity': 0.2,
      'company-entity': 0.1,
    }
    const results: SearchResult[] = rows
      .map((row) => ({
        entityId: row.entity_type as EntityId,
        recordId: row.entity_id,
        organizationId: 'org-1',
        score: scoresByRecordId[row.entity_id] ?? 0,
        source: 'tokens' as const,
      }))
      .sort((left, right) => right.score - left.score)
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
    mockCreateRequestContainer.mockResolvedValue(
      createContainer(searchService, configMap, { features: ['search.global'], isSuperAdmin: true }),
    )

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
      expect.objectContaining({
        entityId: 'orders:order',
        recordId: 'order-1',
      }),
    ])
    expect(body.results[0]?.score).toBeGreaterThan(body.results[1]?.score ?? 0)
    expect(body.results[1]?.score).toBeGreaterThan(body.results[2]?.score ?? 0)
  })
})

describe('GET /api/search/search/global per-entity access control', () => {
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

  async function search(acl: { features: string[]; isSuperAdmin?: boolean }) {
    const { searchService, configMap } = buildDemoSearchService()
    mockCreateRequestContainer.mockResolvedValue(createContainer(searchService, configMap, acl))
    const response = await GET(new Request('http://localhost/api/search/search/global?q=person'))
    return {
      status: response.status,
      body: await response.json() as { results: SearchResult[]; strategiesUsed: SearchStrategyId[] },
    }
  }

  it('withholds results for entity types the caller cannot view', async () => {
    // `search.global` alone opens the palette; it must not expose presenter titles,
    // subtitles or deep links for records the caller has no view feature for.
    const { status, body } = await search({ features: ['search.global'] })

    expect(status).toBe(200)
    expect(body.results).toEqual([])
    expect(body.strategiesUsed).toEqual([])
  })

  it('returns results once the caller holds the entity view feature', async () => {
    const { status, body } = await search({ features: ['search.global', 'demo.view'] })

    expect(status).toBe(200)
    expect(body.results).toHaveLength(3)
  })

  it('narrows the query to the readable entity types instead of only filtering afterwards', async () => {
    // Filtering after the fact would spend `limit` on unreadable records and leave
    // the palette looking empty, so the restriction has to reach the strategies.
    const { searchService, configMap } = buildDemoSearchService()
    const searchSpy = jest.spyOn(searchService, 'search')
    mockCreateRequestContainer.mockResolvedValue(
      createContainer(searchService, configMap, { features: ['search.global', 'demo.view'] }),
    )

    await GET(new Request('http://localhost/api/search/search/global?q=person'))

    expect(searchSpy).toHaveBeenCalledTimes(1)
    const options = searchSpy.mock.calls[0][1] as { entityTypes?: string[] }
    expect(options.entityTypes).toEqual([DEMO_ENTITY_ID])
  })

  it('skips the search entirely when the caller can read nothing', async () => {
    const { searchService, configMap } = buildDemoSearchService()
    const searchSpy = jest.spyOn(searchService, 'search')
    mockCreateRequestContainer.mockResolvedValue(
      createContainer(searchService, configMap, { features: ['search.global'] }),
    )

    const response = await GET(new Request('http://localhost/api/search/search/global?q=person'))

    expect(response.status).toBe(200)
    expect(searchSpy).not.toHaveBeenCalled()
    expect((await response.json() as { results: SearchResult[] }).results).toEqual([])
  })

  it('returns results for a superadmin without any explicit grant', async () => {
    const { status, body } = await search({ features: [], isSuperAdmin: true })

    expect(status).toBe(200)
    expect(body.results).toHaveLength(3)
  })
})
