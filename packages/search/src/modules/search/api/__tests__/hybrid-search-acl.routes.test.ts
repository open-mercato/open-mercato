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

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

jest.mock('../../lib/embedding-config', () => ({
  resolveEmbeddingConfig: jest.fn().mockResolvedValue(null),
}))

import type { EntityId } from '@open-mercato/shared/modules/entities'
import type { SearchEntityConfig, SearchResult, SearchStrategyId } from '../../../../types'
import { GET } from '../search/route'

const DEMO_ENTITY_ID = 'demo:thing' as EntityId

function buildResults(): SearchResult[] {
  return ['fulltext-record', 'vector-record', 'tokens-record'].map((recordId, index) => ({
    entityId: DEMO_ENTITY_ID,
    recordId,
    organizationId: 'org-1',
    score: 1,
    source: (['fulltext', 'vector', 'tokens'] as SearchStrategyId[])[index],
    presenter: { title: recordId, badge: 'Person' },
    links: [{ href: `/backend/demo/${recordId}`, label: 'Open person', kind: 'primary' }],
  }))
}

/**
 * The route resolves `rbacService` and `searchIndexer` to drop results whose entity
 * type the caller has no view feature for (issue #5168), so the container mock has
 * to answer for both.
 */
function createContainer(
  searchService: { search: jest.Mock },
  acl: { features: string[]; isSuperAdmin?: boolean },
  configs: SearchEntityConfig[] = [
    { entityId: DEMO_ENTITY_ID, enabled: true, aclFeatures: ['demo.view'] },
  ],
) {
  const configMap = new Map(configs.map((config) => [config.entityId, config]))
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

describe('GET /api/search/search per-entity access control', () => {
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

  function createSearchService() {
    return { search: jest.fn().mockResolvedValue(buildResults()) }
  }

  async function search(acl: { features: string[]; isSuperAdmin?: boolean }) {
    const searchService = createSearchService()
    mockCreateRequestContainer.mockResolvedValue(createContainer(searchService, acl))
    const response = await GET(new Request('http://localhost/api/search/search?q=person'))
    return {
      searchService,
      status: response.status,
      body: await response.json() as { results: SearchResult[]; strategiesUsed: SearchStrategyId[] },
    }
  }

  it('withholds results for entity types the caller cannot view', async () => {
    // `search.view` alone opens the Vector Search playground; it must not expose
    // presenter titles, subtitles or deep links for records the caller has no view
    // feature for.
    const { status, body, searchService } = await search({ features: ['search.view'] })

    expect(status).toBe(200)
    expect(body.results).toEqual([])
    expect(body.strategiesUsed).toEqual([])
    // Nothing readable short-circuits before a strategy is ever asked.
    expect(searchService.search).not.toHaveBeenCalled()
  })

  it('returns results once the caller holds the entity view feature', async () => {
    const { status, body } = await search({ features: ['search.view', 'demo.view'] })

    expect(status).toBe(200)
    expect(body.results).toHaveLength(3)
  })

  it('returns results for a superadmin without any explicit grant', async () => {
    const { status, body } = await search({ features: [], isSuperAdmin: true })

    expect(status).toBe(200)
    expect(body.results).toHaveLength(3)
  })

  it('narrows the query to the readable entity types instead of only filtering afterwards', async () => {
    // Filtering after the fact would spend `limit` on unreadable records and leave
    // the playground looking empty, so the restriction has to reach the strategies.
    const { searchService } = await search({ features: ['search.view', 'demo.view'] })

    expect(searchService.search).toHaveBeenCalledTimes(1)
    const options = searchService.search.mock.calls[0][1] as { entityTypes?: string[] }
    expect(options.entityTypes).toEqual([DEMO_ENTITY_ID])
  })

  it('intersects an explicitly requested entity type with the readable set', async () => {
    const searchService = createSearchService()
    mockCreateRequestContainer.mockResolvedValue(
      createContainer(searchService, { features: ['search.view', 'demo.view'] }, [
        { entityId: DEMO_ENTITY_ID, enabled: true, aclFeatures: ['demo.view'] },
        { entityId: 'secret:thing' as EntityId, enabled: true, aclFeatures: ['secret.view'] },
      ]),
    )

    const response = await GET(
      new Request(`http://localhost/api/search/search?q=person&entityTypes=${DEMO_ENTITY_ID},secret:thing`),
    )

    expect(response.status).toBe(200)
    const options = searchService.search.mock.calls[0][1] as { entityTypes?: string[] }
    expect(options.entityTypes).toEqual([DEMO_ENTITY_ID])
  })

  it('drops results a strategy returned for an unreadable entity type', async () => {
    // Defense in depth: `entityTypes` is a request to the strategies, not a guarantee.
    const searchService = {
      search: jest.fn().mockResolvedValue([
        ...buildResults(),
        {
          entityId: 'secret:thing' as EntityId,
          recordId: 'secret-record',
          score: 1,
          source: 'tokens' as SearchStrategyId,
          presenter: { title: 'secret-record' },
        },
      ]),
    }
    mockCreateRequestContainer.mockResolvedValue(
      createContainer(searchService, { features: ['search.view', 'demo.view'] }, [
        { entityId: DEMO_ENTITY_ID, enabled: true, aclFeatures: ['demo.view'] },
        { entityId: 'secret:thing' as EntityId, enabled: true, aclFeatures: ['secret.view'] },
      ]),
    )

    const response = await GET(new Request('http://localhost/api/search/search?q=person'))
    const body = await response.json() as { results: SearchResult[] }

    expect(response.status).toBe(200)
    expect(body.results).toHaveLength(3)
    expect(body.results.every((result) => result.entityId === DEMO_ENTITY_ID)).toBe(true)
  })

  it('fails closed with 503 when the RBAC service or the entity registry is missing', async () => {
    const searchService = createSearchService()
    const registrations: Record<string, unknown> = { searchService }
    mockCreateRequestContainer.mockResolvedValue({
      hasRegistration: (name: string) => name in registrations,
      resolve: jest.fn((name: string) => registrations[name]),
      dispose: jest.fn().mockResolvedValue(undefined),
    })

    const response = await GET(new Request('http://localhost/api/search/search?q=person'))

    expect(response.status).toBe(503)
    expect(searchService.search).not.toHaveBeenCalled()
  })
})
