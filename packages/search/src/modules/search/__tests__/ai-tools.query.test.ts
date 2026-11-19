/**
 * Regression coverage for `search_query` (issue #7808): the AI search tool
 * must enforce the caller's allowed-organization allowlist, not just their
 * current `organizationId`, mirroring the HTTP search route.
 */
import { aiTools } from '../ai-tools'

const queryTool = aiTools.find((t) => t.name === 'search_query')
if (!queryTool) throw new Error('search_query tool not found in aiTools — was it renamed?')

function makeOrgScopeResolver(options: { aclOrganizations: string[] | null; isSuperAdmin?: boolean; knownOrgIds?: string[] }) {
  const em = {
    find: jest.fn(async (_entity: unknown, filter: { id?: { $in: string[] } }) => {
      const ids = filter?.id?.$in ?? []
      const known = new Set(options.knownOrgIds ?? ['org-1', 'org-2', 'org-3'])
      return ids.filter((id) => known.has(id)).map((id) => ({ id, descendantIds: [] }))
    }),
  }
  const rbacService = {
    loadAcl: jest.fn(async () => ({
      isSuperAdmin: options.isSuperAdmin ?? false,
      features: [],
      organizations: options.aclOrganizations,
    })),
  }
  return { em, rbacService }
}

function makeCtx(overrides: {
  userFeatures?: string[]
  isSuperAdmin?: boolean
  userId?: string | null
  organizationId?: string | null
  orgScope?: { em: unknown; rbacService: unknown }
  apiKeyId?: string | null
} = {}) {
  const mockSearch = jest.fn().mockResolvedValue([
    { entityId: 'catalog:product', recordId: 'c1', score: 0.8, source: 'fulltext', presenter: { title: 'Widget' } },
  ])
  const searchIndexer = {
    getEntityConfig: (entityId: string) =>
      entityId === 'catalog:product' ? { aclFeatures: ['catalog.products.view'], enabled: true } : undefined,
    getAllEntityConfigs: () => [{ entityId: 'catalog:product', aclFeatures: ['catalog.products.view'], enabled: true }],
  }
  const ctx = {
    tenantId: 'tenant-1',
    organizationId: overrides.organizationId !== undefined ? overrides.organizationId : 'org-1',
    userId: overrides.userId !== undefined ? overrides.userId : 'user-1',
    userFeatures: overrides.userFeatures ?? ['search.global', 'catalog.products.view'],
    isSuperAdmin: overrides.isSuperAdmin ?? false,
    apiKeyId: overrides.apiKeyId ?? null,
    container: {
      resolve: (name: string) => {
        if (name === 'searchIndexer') return searchIndexer
        if (name === 'searchService') return { search: mockSearch }
        if (name === 'em') {
          if (overrides.orgScope) return overrides.orgScope.em
          throw new Error('em not mocked')
        }
        if (name === 'rbacService') {
          if (overrides.orgScope) return overrides.orgScope.rbacService
          throw new Error('rbacService not mocked')
        }
        throw new Error(`unexpected resolve ${name}`)
      },
    },
  }
  return { ctx, mockSearch }
}

describe('search_query tool', () => {
  it('throws when tenantId is missing', async () => {
    const { ctx } = makeCtx()
    const noTenantCtx = { ...ctx, tenantId: null }

    await expect(queryTool.handler({ query: 'widget' }, noTenantCtx)).rejects.toThrow(/Tenant context/)
  })

  it('returns results for an unrestricted (no-allowlist) caller', async () => {
    const orgScope = makeOrgScopeResolver({ aclOrganizations: null })
    const { ctx, mockSearch } = makeCtx({ orgScope })

    const result = await queryTool.handler({ query: 'widget' }, ctx) as { totalResults: number }

    expect(result.totalResults).toBe(1)
    expect(mockSearch).toHaveBeenCalledWith('widget', expect.objectContaining({ organizationIds: ['org-1'] }))
  })

  describe('org-allowlist enforcement (issue #7808)', () => {
    it('scopes a restricted user with no current org to their organization allowlist', async () => {
      const orgScope = makeOrgScopeResolver({ aclOrganizations: ['org-2', 'org-3'] })
      const { ctx, mockSearch } = makeCtx({ organizationId: null, orgScope })

      const result = await queryTool.handler({ query: 'widget' }, ctx) as { totalResults: number }

      expect(result.totalResults).toBe(1)
      expect(mockSearch).toHaveBeenCalledWith(
        'widget',
        expect.objectContaining({ organizationIds: ['org-2', 'org-3'] }),
      )
    })

    it('denies a restricted user whose allowlist is explicitly empty, without calling search', async () => {
      const orgScope = makeOrgScopeResolver({ aclOrganizations: [] })
      const { ctx, mockSearch } = makeCtx({ organizationId: null, orgScope })

      const result = await queryTool.handler({ query: 'widget' }, ctx) as { totalResults: number; results: unknown[] }

      expect(mockSearch).not.toHaveBeenCalled()
      expect(result.totalResults).toBe(0)
      expect(result.results).toEqual([])
    })

    it('leaves a superadmin unfiltered regardless of the ACL allowlist', async () => {
      const orgScope = makeOrgScopeResolver({ aclOrganizations: [], isSuperAdmin: true })
      const { ctx, mockSearch } = makeCtx({ organizationId: null, isSuperAdmin: true, userFeatures: [], orgScope })

      const result = await queryTool.handler({ query: 'widget' }, ctx) as { totalResults: number }

      expect(result.totalResults).toBe(1)
      expect(mockSearch).toHaveBeenCalledWith('widget', expect.objectContaining({ organizationIds: undefined }))
    })
  })

  describe('per-record visibility viewer (PR #9648 B-8)', () => {
    it('passes the calling user as the search viewer so filterResults entities are not dropped', async () => {
      const orgScope = makeOrgScopeResolver({ aclOrganizations: null })
      const { ctx, mockSearch } = makeCtx({ orgScope })

      await queryTool.handler({ query: 'widget' }, ctx)

      const options = mockSearch.mock.calls[0][1]
      expect(options.viewer).toEqual({
        auth: {
          sub: 'user-1',
          userId: 'user-1',
          tenantId: 'tenant-1',
          orgId: 'org-1',
          features: ['search.global', 'catalog.products.view'],
          isSuperAdmin: false,
        },
        container: ctx.container,
      })
    })

    it('runs an API-key caller as the key itself, with no user identity', async () => {
      const orgScope = makeOrgScopeResolver({ aclOrganizations: null })
      const { ctx, mockSearch } = makeCtx({ orgScope, apiKeyId: 'key-1' })

      await queryTool.handler({ query: 'widget' }, ctx)

      const viewer = mockSearch.mock.calls[0][1].viewer
      expect(viewer.auth).toMatchObject({ sub: 'api_key:key-1', isApiKey: true, keyId: 'key-1', tenantId: 'tenant-1' })
      expect(viewer.auth).not.toHaveProperty('userId')
    })

    it('uses the re-validated organization, not the raw context organization', async () => {
      const orgScope = makeOrgScopeResolver({ aclOrganizations: ['org-2'] })
      const { ctx, mockSearch } = makeCtx({ organizationId: 'org-9', orgScope })

      await queryTool.handler({ query: 'widget' }, ctx)

      expect(mockSearch.mock.calls[0][1].viewer.auth.orgId).toBeNull()
    })
  })
})
