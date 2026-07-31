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
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('../../lib/embedding-config', () => ({
  resolveEmbeddingConfig: jest.fn().mockResolvedValue(null),
}))

jest.mock('../../lib/global-search-config', () => ({
  resolveGlobalSearchStrategies: jest.fn().mockResolvedValue(['tokens']),
}))

const mockRecordIndexerLog = jest.fn().mockResolvedValue(undefined)
jest.mock('@open-mercato/shared/lib/indexers/status-log', () => ({
  recordIndexerLog: (...args: unknown[]) => mockRecordIndexerLog(...args),
}))

const mockWriteCoverageCounts = jest.fn().mockResolvedValue(undefined)
jest.mock('@open-mercato/core/modules/query_index/lib/coverage', () => ({
  writeCoverageCounts: (...args: unknown[]) => mockWriteCoverageCounts(...args),
}))

import { GET as hybridSearchGet } from '../search/route'
import { GET as globalSearchGet } from '../search/global/route'
import { GET as indexGet, DELETE as indexDelete } from '../index/route'

type MockOrganizationScope = {
  selectedId: string | null
  filterIds: string[] | null
  allowedIds: string[] | null
  tenantId: string | null
}

describe('Search API organizationId scoping', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('/api/search/search uses resolved org scope (selected org)', async () => {
    mockGetAuthFromRequest.mockResolvedValue({ tenantId: 't1', orgId: 'org-A', sub: 'user-1', isSuperAdmin: false })

    const searchService = {
      search: jest.fn().mockResolvedValue([{ entityId: 'x:y', recordId: '1', score: 1, source: 'tokens' }]),
    }
    const container = {
      resolve: jest.fn((name: string) => (name === 'searchService' ? searchService : undefined)),
      dispose: jest.fn(),
    }
    mockCreateRequestContainer.mockResolvedValue(container)
    mockResolveOrganizationScopeForRequest.mockResolvedValue({
      selectedId: 'org-A',
      filterIds: ['org-A'],
      allowedIds: ['org-A'],
      tenantId: 't1',
    } satisfies MockOrganizationScope)

    const req = new Request('http://localhost/api/search/search?q=test')
    const res = await hybridSearchGet(req)

    expect(mockResolveOrganizationScopeForRequest).toHaveBeenCalledWith(
      expect.objectContaining({ container, auth: expect.anything(), request: req }),
    )
    expect(searchService.search).toHaveBeenCalledTimes(1)

    const passedOptions = (searchService.search as jest.Mock).mock.calls[0][1] as Record<string, unknown>
    expect(passedOptions.organizationId).toEqual('org-A')
    expect(passedOptions.organizationIds).toEqual(['org-A'])

    const body = await res.json()
    expect(Array.isArray(body.results)).toBe(true)
  })

  test('/api/search/search/global uses full allowed org scope when no single org is selected', async () => {
    mockGetAuthFromRequest.mockResolvedValue({ tenantId: 't1', orgId: 'org-A', sub: 'user-1', isSuperAdmin: false })

    const searchService = {
      search: jest.fn().mockResolvedValue([]),
    }
    const container = {
      resolve: jest.fn((name: string) => (name === 'searchService' ? searchService : undefined)),
      dispose: jest.fn(),
    }
    mockCreateRequestContainer.mockResolvedValue(container)
    mockResolveOrganizationScopeForRequest.mockResolvedValue({
      selectedId: null,
      filterIds: ['org-A', 'org-B'],
      allowedIds: ['org-A', 'org-B'],
      tenantId: 't1',
    } satisfies MockOrganizationScope)

    const req = new Request('http://localhost/api/search/search/global?q=test')
    await globalSearchGet(req)

    const passedOptions = (searchService.search as jest.Mock).mock.calls[0][1] as Record<string, unknown>
    expect(passedOptions.organizationId).toBeUndefined()
    expect(passedOptions.organizationIds).toEqual(['org-A', 'org-B'])
  })

  test('/api/search/search uses full allowed org scope when restricted user has no selected org', async () => {
    mockGetAuthFromRequest.mockResolvedValue({ tenantId: 't1', orgId: 'org-A', sub: 'user-1', isSuperAdmin: false })

    const searchService = {
      search: jest.fn().mockResolvedValue([]),
    }
    const container = {
      resolve: jest.fn((name: string) => (name === 'searchService' ? searchService : undefined)),
      dispose: jest.fn(),
    }
    mockCreateRequestContainer.mockResolvedValue(container)
    mockResolveOrganizationScopeForRequest.mockResolvedValue({
      selectedId: null,
      filterIds: ['org-A', 'org-B'],
      allowedIds: ['org-A', 'org-B'],
      tenantId: 't1',
    } satisfies MockOrganizationScope)

    const req = new Request('http://localhost/api/search/search?q=test')
    await hybridSearchGet(req)

    const passedOptions = (searchService.search as jest.Mock).mock.calls[0][1] as Record<string, unknown>
    expect(passedOptions.organizationId).toBeUndefined()
    expect(passedOptions.organizationIds).toEqual(['org-A', 'org-B'])
  })

  test('/api/search/index list respects resolved org scope and does not default to org NULL', async () => {
    mockGetAuthFromRequest.mockResolvedValue({ tenantId: 't1', orgId: 'org-A', sub: 'user-1', isSuperAdmin: false })

    const vectorStrategy = {
      id: 'vector',
      isAvailable: jest.fn().mockResolvedValue(true),
      listEntries: jest.fn().mockResolvedValue([]),
    }
    const searchService = {
      getStrategies: jest.fn().mockReturnValue([vectorStrategy]),
    }

    const container = {
      resolve: jest.fn((name: string) => (name === 'searchService' ? searchService : undefined)),
      dispose: jest.fn(),
    }
    mockCreateRequestContainer.mockResolvedValue(container)
    mockResolveOrganizationScopeForRequest.mockResolvedValue({
      selectedId: 'org-A',
      filterIds: ['org-A'],
      allowedIds: ['org-A'],
      tenantId: 't1',
    } satisfies MockOrganizationScope)

    const req = new Request('http://localhost/api/search/index?limit=10&offset=0')
    await indexGet(req)

    expect(vectorStrategy.listEntries).toHaveBeenCalledTimes(1)
    const passedOptions = (vectorStrategy.listEntries as jest.Mock).mock.calls[0][0] as Record<string, unknown>
    expect(passedOptions.organizationId).toEqual('org-A')
  })
})

describe('Search API DELETE /api/search/index organizationId scoping (issue #2935)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  function setupContainer() {
    const searchIndexer = {
      listEnabledEntities: jest.fn().mockReturnValue(['demo:item', 'demo:other']),
      purgeEntity: jest.fn().mockResolvedValue(undefined),
    }
    const container = {
      resolve: jest.fn((name: string) => (name === 'searchIndexer' ? searchIndexer : undefined)),
      dispose: jest.fn(),
    }
    mockCreateRequestContainer.mockResolvedValue(container)
    return { searchIndexer, container }
  }

  test('scopes the purge to the caller selected organization (never tenant-wide)', async () => {
    mockGetAuthFromRequest.mockResolvedValue({ tenantId: 't1', orgId: 'org-A', sub: 'user-1', isSuperAdmin: false })
    const { searchIndexer } = setupContainer()
    mockResolveOrganizationScopeForRequest.mockResolvedValue({
      selectedId: 'org-A',
      filterIds: ['org-A'],
      allowedIds: ['org-A'],
      tenantId: 't1',
    } satisfies MockOrganizationScope)

    const req = new Request('http://localhost/api/search/index?entityId=demo:item', { method: 'DELETE' })
    const res = await indexDelete(req)

    expect(res.status).toBe(200)
    expect(mockResolveOrganizationScopeForRequest).toHaveBeenCalledWith(
      expect.objectContaining({ container: expect.anything(), auth: expect.anything(), request: req }),
    )
    expect(searchIndexer.purgeEntity).toHaveBeenCalledTimes(1)
    expect(searchIndexer.purgeEntity).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 'demo:item', tenantId: 't1', organizationId: 'org-A' }),
    )
  })

  test('purges the full authorized org set (never tenant-wide) for a restricted user with no selected org', async () => {
    mockGetAuthFromRequest.mockResolvedValue({ tenantId: 't1', orgId: null, sub: 'user-1', isSuperAdmin: false })
    const { searchIndexer } = setupContainer()
    mockResolveOrganizationScopeForRequest.mockResolvedValue({
      selectedId: null,
      filterIds: ['org-A', 'org-B'],
      allowedIds: ['org-A', 'org-B'],
      tenantId: 't1',
    } satisfies MockOrganizationScope)

    const req = new Request('http://localhost/api/search/index?entityId=demo:item', { method: 'DELETE' })
    const res = await indexDelete(req)

    expect(res.status).toBe(200)
    const purgedOrgs = (searchIndexer.purgeEntity as jest.Mock).mock.calls.map(
      (call) => (call[0] as { organizationId?: string | null }).organizationId,
    )
    expect(purgedOrgs).toEqual(expect.arrayContaining(['org-A', 'org-B']))
    expect(purgedOrgs).not.toContain(undefined)
    expect(purgedOrgs).not.toContain(null)
  })

  test('purges nothing when the caller has no accessible organizations', async () => {
    mockGetAuthFromRequest.mockResolvedValue({ tenantId: 't1', orgId: 'org-A', sub: 'user-1', isSuperAdmin: false })
    const { searchIndexer } = setupContainer()
    mockResolveOrganizationScopeForRequest.mockResolvedValue({
      selectedId: null,
      filterIds: [],
      allowedIds: [],
      tenantId: 't1',
    } satisfies MockOrganizationScope)

    const req = new Request('http://localhost/api/search/index?entityId=demo:item', { method: 'DELETE' })
    const res = await indexDelete(req)

    expect(res.status).toBe(200)
    expect(searchIndexer.purgeEntity).not.toHaveBeenCalled()
  })

  test('allows a tenant-wide purge for an unrestricted (super-admin) caller', async () => {
    mockGetAuthFromRequest.mockResolvedValue({ tenantId: 't1', orgId: null, sub: 'user-1', isSuperAdmin: true })
    const { searchIndexer } = setupContainer()
    mockResolveOrganizationScopeForRequest.mockResolvedValue({
      selectedId: null,
      filterIds: null,
      allowedIds: null,
      tenantId: 't1',
    } satisfies MockOrganizationScope)

    const req = new Request('http://localhost/api/search/index?entityId=demo:item', { method: 'DELETE' })
    const res = await indexDelete(req)

    expect(res.status).toBe(200)
    expect(searchIndexer.purgeEntity).toHaveBeenCalledTimes(1)
    const arg = (searchIndexer.purgeEntity as jest.Mock).mock.calls[0][0] as { organizationId?: string | null }
    expect(arg.organizationId).toBeUndefined()
  })
})
