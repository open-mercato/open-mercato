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

import { GET as hybridSearchGet } from '../search/route'
import { GET as globalSearchGet } from '../search/global/route'
import { GET as indexGet } from '../index/route'

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

    const body = await res.json()
    expect(Array.isArray(body.results)).toBe(true)
  })

  test('/api/search/search/global uses resolved org scope (all orgs, non-superadmin)', async () => {
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
