import { aiTools } from '../ai-tools'

const aggregateTool = aiTools.find((t) => t.name === 'search_aggregate')
if (!aggregateTool) throw new Error('search_aggregate tool not found in aiTools — was it renamed?')

const ENTITY_CONFIGS: Record<string, { aclFeatures: string[]; fieldPolicy: { searchable: string[]; hashOnly?: string[]; excluded?: string[] } }> = {
  'customers:customer_deal': {
    aclFeatures: ['customers.deals.view'],
    fieldPolicy: { searchable: ['title', 'status', 'pipeline_stage', 'source'], hashOnly: [], excluded: ['value_amount'] },
  },
  'catalog:product': {
    aclFeatures: ['catalog.products.view'],
    fieldPolicy: { searchable: ['category', 'status'], hashOnly: [], excluded: [] },
  },
}

const DEFAULT_FEATURES = ['search.view', 'customers.deals.view', 'catalog.products.view']

function makeCtx(
  queryResult: { items: unknown[]; total: number },
  overrides: {
    userFeatures?: string[]
    isSuperAdmin?: boolean
    userId?: string | null
    organizationId?: string | null
    orgScope?: { em: unknown; rbacService: unknown }
  } = {},
) {
  const mockQuery = jest.fn().mockResolvedValue(queryResult)
  const searchIndexer = {
    getEntityConfig: (entityId: string) => ENTITY_CONFIGS[entityId],
    getAllEntityConfigs: () =>
      Object.entries(ENTITY_CONFIGS).map(([entityId, config]) => ({ entityId, ...config })),
  }
  const ctx = {
    tenantId: 'tenant-1',
    organizationId: overrides.organizationId !== undefined ? overrides.organizationId : 'org-1',
    userId: overrides.userId !== undefined ? overrides.userId : 'user-1',
    userFeatures: overrides.userFeatures ?? DEFAULT_FEATURES,
    isSuperAdmin: overrides.isSuperAdmin ?? false,
    container: {
      resolve: (name: string) => {
        if (name === 'searchIndexer') return searchIndexer
        if (name === 'em') {
          if (overrides.orgScope) return overrides.orgScope.em
          throw new Error('em not mocked')
        }
        if (name === 'rbacService') {
          if (overrides.orgScope) return overrides.orgScope.rbacService
          throw new Error('rbacService not mocked')
        }
        return { query: mockQuery }
      },
    },
  }
  return { ctx, mockQuery }
}

/**
 * Builds a real `em`/`rbacService` pair so `resolveActorOrganizationScope`
 * (issue #7808) runs the full `resolveOrganizationScopeForRequest` resolution
 * instead of its no-DI fallback — needed to assert the organization
 * allowlist is actually enforced (not just the caller's single current org).
 */
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

describe('search_aggregate tool', () => {
  it('sends pageSize: 100 to the query engine', async () => {
    const { ctx, mockQuery } = makeCtx({ items: [], total: 0 })

    await aggregateTool.handler({ entityType: 'customers:customer_deal', groupBy: 'status', limit: 20 }, ctx)

    expect(mockQuery).toHaveBeenCalledWith(
      'customers:customer_deal',
      expect.objectContaining({
        page: { page: 1, pageSize: 100 },
      }),
    )
  })

  it('groups returned items by the specified field', async () => {
    const items = [
      { status: 'open' },
      { status: 'open' },
      { status: 'closed' },
      { status: null },
    ]
    const { ctx } = makeCtx({ items, total: 4 })

    const result = await aggregateTool.handler(
      { entityType: 'customers:customer_deal', groupBy: 'status', limit: 20 },
      ctx,
    ) as { buckets: Array<{ value: string | null; count: number; percentage: number }>; total: number }

    expect(result.total).toBe(4)
    const open = result.buckets.find((b) => b.value === 'open')
    const closed = result.buckets.find((b) => b.value === 'closed')
    const nullBucket = result.buckets.find((b) => b.value === null)
    expect(open?.count).toBe(2)
    expect(closed?.count).toBe(1)
    expect(nullBucket?.count).toBe(1)
  })

  it('respects the limit on returned buckets', async () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ category: `cat-${i}` }))
    const { ctx } = makeCtx({ items, total: 10 })

    const result = await aggregateTool.handler(
      { entityType: 'catalog:product', groupBy: 'category', limit: 3 },
      ctx,
    ) as { buckets: unknown[] }

    expect(result.buckets.length).toBe(3)
  })

  it('computes percentage against the sampled item count', async () => {
    const items = [{ status: 'open' }, { status: 'open' }, { status: 'closed' }]
    const { ctx } = makeCtx({ items, total: 1000 }) // DB total irrelevant; sample is 3
    const result = await aggregateTool.handler(
      { entityType: 'customers:customer_deal', groupBy: 'status', limit: 20 },
      ctx,
    ) as { buckets: Array<{ value: string; percentage: number }> }
    const open = result.buckets.find((b) => b.value === 'open')
    expect(open?.percentage).toBeCloseTo(66.67, 1)
  })

  it('returns buckets sorted by count descending', async () => {
    const items = [
      { status: 'closed' },
      { status: 'open' }, { status: 'open' }, { status: 'open' },
      { status: 'pending' }, { status: 'pending' },
    ]
    const { ctx } = makeCtx({ items, total: 6 })
    const result = await aggregateTool.handler(
      { entityType: 'customers:customer_deal', groupBy: 'status', limit: 20 },
      ctx,
    ) as { buckets: Array<{ value: string; count: number }> }
    expect(result.buckets.map((b) => b.value)).toEqual(['open', 'pending', 'closed'])
  })

  it('returns empty buckets for empty result set', async () => {
    const { ctx } = makeCtx({ items: [], total: 0 })
    const result = await aggregateTool.handler(
      { entityType: 'customers:customer_deal', groupBy: 'status', limit: 20 },
      ctx,
    ) as { total: number; buckets: unknown[] }
    expect(result.total).toBe(0)
    expect(result.buckets).toEqual([])
  })

  it('throws when tenantId is missing', async () => {
    const { ctx } = makeCtx({ items: [], total: 0 })
    const noTenantCtx = { ...ctx, tenantId: null }

    await expect(
      aggregateTool.handler({ entityType: 'customers:customer_deal', groupBy: 'status', limit: 20 }, noTenantCtx),
    ).rejects.toThrow('Tenant context is required')
  })

  it('denies callers holding only search.view without the per-entity view feature', async () => {
    const { ctx, mockQuery } = makeCtx({ items: [{ status: 'open' }], total: 1 }, { userFeatures: ['search.view'] })

    await expect(
      aggregateTool.handler({ entityType: 'customers:customer_deal', groupBy: 'status', limit: 20 }, ctx),
    ).rejects.toThrow(/Insufficient permissions/)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('allows callers holding the per-entity view feature', async () => {
    const { ctx, mockQuery } = makeCtx({ items: [{ status: 'open' }], total: 1 }, { userFeatures: ['customers.deals.view'] })

    const result = await aggregateTool.handler(
      { entityType: 'customers:customer_deal', groupBy: 'status', limit: 20 },
      ctx,
    ) as { total: number }
    expect(result.total).toBe(1)
    expect(mockQuery).toHaveBeenCalled()
  })

  it('honors wildcard module grants for the per-entity view feature', async () => {
    const { ctx } = makeCtx({ items: [{ status: 'open' }], total: 1 }, { userFeatures: ['customers.*'] })

    const result = await aggregateTool.handler(
      { entityType: 'customers:customer_deal', groupBy: 'status', limit: 20 },
      ctx,
    ) as { total: number }
    expect(result.total).toBe(1)
  })

  it('allows super admins regardless of features', async () => {
    const { ctx } = makeCtx({ items: [{ status: 'open' }], total: 1 }, { userFeatures: [], isSuperAdmin: true })

    const result = await aggregateTool.handler(
      { entityType: 'customers:customer_deal', groupBy: 'status', limit: 20 },
      ctx,
    ) as { total: number }
    expect(result.total).toBe(1)
  })

  it('rejects groupBy on an excluded (sensitive) field', async () => {
    const { ctx, mockQuery } = makeCtx({ items: [{ value_amount: 100 }], total: 1 })

    await expect(
      aggregateTool.handler({ entityType: 'customers:customer_deal', groupBy: 'value_amount', limit: 20 }, ctx),
    ).rejects.toThrow(/not an allowed grouping key/)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('rejects groupBy on a field not in the searchable allowlist (e.g. PII enumeration)', async () => {
    const { ctx, mockQuery } = makeCtx({ items: [{ email: 'a@b.c' }], total: 1 })

    await expect(
      aggregateTool.handler({ entityType: 'customers:customer_deal', groupBy: 'email', limit: 20 }, ctx),
    ).rejects.toThrow(/not an allowed grouping key/)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('fails closed for entity types not configured for search', async () => {
    const { ctx } = makeCtx({ items: [], total: 0 })

    await expect(
      aggregateTool.handler({ entityType: 'secret:unconfigured', groupBy: 'status', limit: 20 }, ctx),
    ).rejects.toThrow(/not configured for search/)
  })

  describe('org-allowlist enforcement (issue #7808)', () => {
    it('scopes a restricted user with no current org to their organization allowlist', async () => {
      const orgScope = makeOrgScopeResolver({ aclOrganizations: ['org-2', 'org-3'] })
      const { ctx, mockQuery } = makeCtx(
        { items: [{ status: 'open' }], total: 1 },
        { organizationId: null, orgScope },
      )

      await aggregateTool.handler({ entityType: 'customers:customer_deal', groupBy: 'status', limit: 20 }, ctx)

      expect(mockQuery).toHaveBeenCalledWith(
        'customers:customer_deal',
        expect.objectContaining({ organizationIds: ['org-2', 'org-3'] }),
      )
    })

    it('denies a restricted user whose allowlist is explicitly empty, without querying', async () => {
      const orgScope = makeOrgScopeResolver({ aclOrganizations: [] })
      const { ctx, mockQuery } = makeCtx(
        { items: [{ status: 'open' }], total: 1 },
        { organizationId: null, orgScope },
      )

      const result = await aggregateTool.handler(
        { entityType: 'customers:customer_deal', groupBy: 'status', limit: 20 },
        ctx,
      ) as { total: number; buckets: unknown[] }

      expect(mockQuery).not.toHaveBeenCalled()
      expect(result.total).toBe(0)
      expect(result.buckets).toEqual([])
    })

    it('leaves a superadmin unfiltered regardless of the ACL allowlist', async () => {
      const orgScope = makeOrgScopeResolver({ aclOrganizations: [], isSuperAdmin: true })
      const { ctx, mockQuery } = makeCtx(
        { items: [{ status: 'open' }], total: 1 },
        { organizationId: null, isSuperAdmin: true, userFeatures: [], orgScope },
      )

      await aggregateTool.handler({ entityType: 'customers:customer_deal', groupBy: 'status', limit: 20 }, ctx)

      expect(mockQuery).toHaveBeenCalledWith(
        'customers:customer_deal',
        expect.objectContaining({ organizationIds: undefined }),
      )
    })
  })
})
