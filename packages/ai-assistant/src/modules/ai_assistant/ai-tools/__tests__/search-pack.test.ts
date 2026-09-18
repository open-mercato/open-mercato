/**
 * Step 3.8 — `search.*` tool pack unit tests.
 *
 * Covers `search.hybrid_search` happy path and `search.get_record_context`
 * happy / miss / tenant isolation, plus per-entity ACL enforcement for
 * issue #5211 (legacy pack must not leak records the caller cannot view).
 */
import searchAiTools from '../search-pack'

type SearchCall = {
  query: string
  options: Record<string, unknown>
}

type ToolContext = {
  tenantId: string | null
  organizationId: string | null
  userId: string | null
  container: { resolve: (name: string) => unknown }
  userFeatures: string[]
  isSuperAdmin: boolean
}

function findTool(name: string) {
  const tool = searchAiTools.find((entry) => entry.name === name)
  if (!tool) throw new Error(`tool ${name} missing`)
  return tool
}

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  const container = {
    resolve: jest.fn(),
  }
  return {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userId: 'user-1',
    container,
    userFeatures: ['search.view'],
    isSuperAdmin: false,
    ...overrides,
  }
}

function makeSearchService(results: unknown[]): {
  service: { search: (query: string, options: Record<string, unknown>) => Promise<unknown[]> }
  calls: SearchCall[]
} {
  const calls: SearchCall[] = []
  return {
    calls,
    service: {
      search: async (query: string, options: Record<string, unknown>) => {
        calls.push({ query, options })
        return results
      },
    },
  }
}

function makeLookup(configs: Array<{ entityId: string; aclFeatures?: string[]; enabled?: boolean }>) {
  const map = new Map(configs.map((c) => [c.entityId, c]))
  return {
    getEntityConfig: (entityId: string) => map.get(entityId) as any,
    getAllEntityConfigs: () => configs as any,
  }
}

function permissiveLookup(entityIds: string[] = ['catalog:product']) {
  const configs = entityIds.map((id) => ({ entityId: id, aclFeatures: ['search.view'], enabled: true }))
  return makeLookup(configs)
}

describe('search.hybrid_search', () => {
  const tool = findTool('search.hybrid_search')

  it('passes tenant + organization scope and limits through to SearchService', async () => {
    const { service, calls } = makeSearchService([
      {
        entityId: 'catalog:product',
        recordId: 'rec-1',
        score: 0.9,
        source: 'fulltext',
        presenter: { title: 'Product A' },
      },
    ])
    const ctx = makeCtx()
    const lookup = permissiveLookup(['catalog:product'])
    ;(ctx.container.resolve as jest.Mock).mockImplementation((name: string) => {
      if (name === 'searchService') return service
      if (name === 'searchIndexer') return lookup
      throw new Error(`unexpected resolve ${name}`)
    })
    const result = (await tool.handler(
      { q: 'widget', limit: 10, strategies: ['fulltext', 'vector'], entityTypes: ['catalog:product'] },
      ctx as any,
    )) as Record<string, unknown>
    expect(calls).toHaveLength(1)
    expect(calls[0].query).toBe('widget')
    expect(calls[0].options).toMatchObject({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      limit: 10,
      strategies: ['fulltext', 'vector'],
      entityTypes: ['catalog:product'],
    })
    expect(result.totalResults).toBe(1)
    expect(result.strategiesUsed).toEqual(['fulltext'])
  })

  it('defaults limit to 20 when omitted', async () => {
    const { service, calls } = makeSearchService([])
    const ctx = makeCtx()
    const lookup = permissiveLookup(['catalog:product'])
    ;(ctx.container.resolve as jest.Mock).mockImplementation((name: string) => {
      if (name === 'searchService') return service
      if (name === 'searchIndexer') return lookup
      return undefined
    })
    await tool.handler({ q: 'hello' }, ctx as any)
    expect(calls[0].options.limit).toBe(20)
  })

  it('throws when tenant context is missing', async () => {
    const ctx = makeCtx({ tenantId: null })
    ;(ctx.container.resolve as jest.Mock).mockReturnValue({ search: jest.fn() })
    await expect(tool.handler({ q: 'x' }, ctx as any)).rejects.toThrow(/Tenant context/)
  })

  it('withholds results for entity types the caller cannot view', async () => {
    const lookup = makeLookup([
      { entityId: 'customers:customer_person_profile', aclFeatures: ['customers.people.view'], enabled: true },
      { entityId: 'catalog:catalog_product', aclFeatures: ['catalog.products.view'], enabled: true },
    ])
    const { service, calls } = makeSearchService([
      { entityId: 'customers:customer_person_profile', recordId: 'p1', score: 0.9, source: 'fulltext', presenter: { title: 'Person' } },
      { entityId: 'catalog:catalog_product', recordId: 'c1', score: 0.8, source: 'fulltext', presenter: { title: 'Product' } },
    ])
    const ctx = makeCtx({ userFeatures: ['search.view', 'customers.people.view'] })
    ;(ctx.container.resolve as jest.Mock).mockImplementation((name: string) => {
      if (name === 'searchService') return service
      if (name === 'searchIndexer') return lookup
      throw new Error(`unexpected resolve ${name}`)
    })
    const result = (await tool.handler({ q: 'test' }, ctx as any)) as Record<string, unknown>
    // Should have narrowed entityTypes to only readable type
    expect((calls[0].options as any).entityTypes).toEqual(['customers:customer_person_profile'])
    // Defense in depth: results filtered to only readable
    expect(result.totalResults).toBe(1)
    expect((result.results as any[])[0].entityId).toBe('customers:customer_person_profile')
  })

  it('short-circuits without calling search when no entity type is readable for an explicit request', async () => {
    const lookup = makeLookup([
      { entityId: 'catalog:catalog_product', aclFeatures: ['catalog.products.view'], enabled: true },
    ])
    const { service, calls } = makeSearchService([
      { entityId: 'catalog:catalog_product', recordId: 'c1', score: 0.8, source: 'fulltext' },
    ])
    const ctx = makeCtx({ userFeatures: ['search.view'] })
    ;(ctx.container.resolve as jest.Mock).mockImplementation((name: string) => {
      if (name === 'searchService') return service
      if (name === 'searchIndexer') return lookup
      throw new Error(`unexpected ${name}`)
    })
    const result = (await tool.handler({ q: 'test', entityTypes: ['catalog:catalog_product'] }, ctx as any)) as Record<string, unknown>
    expect(calls).toHaveLength(0)
    expect(result.totalResults).toBe(0)
    expect(result.results).toEqual([])
  })

  it('intersects an explicitly requested mixed set with the readable set', async () => {
    const lookup = makeLookup([
      { entityId: 'customers:customer_person_profile', aclFeatures: ['customers.people.view'], enabled: true },
      { entityId: 'catalog:catalog_product', aclFeatures: ['catalog.products.view'], enabled: true },
      { entityId: 'secret:thing', aclFeatures: ['secret.view'], enabled: true },
    ])
    const { service, calls } = makeSearchService([
      { entityId: 'customers:customer_person_profile', recordId: 'p1', score: 0.9, source: 'fulltext' },
      { entityId: 'catalog:catalog_product', recordId: 'c1', score: 0.8, source: 'fulltext' },
    ])
    const ctx = makeCtx({ userFeatures: ['search.view', 'customers.people.view'] })
    ;(ctx.container.resolve as jest.Mock).mockImplementation((name: string) => {
      if (name === 'searchService') return service
      if (name === 'searchIndexer') return lookup
      throw new Error(`unexpected ${name}`)
    })
    await tool.handler({ q: 'test', entityTypes: ['customers:customer_person_profile', 'catalog:catalog_product', 'secret:thing'] }, ctx as any)
    expect((calls[0].options as any).entityTypes).toEqual(['customers:customer_person_profile'])
  })

  it('drops results a strategy returned for an unreadable entity type (defense in depth)', async () => {
    const lookup = makeLookup([
      { entityId: 'customers:customer_person_profile', aclFeatures: ['customers.people.view'], enabled: true },
      { entityId: 'secret:thing', aclFeatures: ['secret.view'], enabled: true },
    ])
    const { service } = makeSearchService([
      { entityId: 'customers:customer_person_profile', recordId: 'p1', score: 0.9, source: 'fulltext' },
      { entityId: 'secret:thing', recordId: 's1', score: 0.8, source: 'fulltext' },
    ])
    const ctx = makeCtx({ userFeatures: ['search.view', 'customers.people.view'] })
    ;(ctx.container.resolve as jest.Mock).mockImplementation((name: string) => {
      if (name === 'searchService') return service
      if (name === 'searchIndexer') return lookup
      throw new Error(`unexpected ${name}`)
    })
    const result = (await tool.handler({ q: 'test' }, ctx as any)) as Record<string, unknown>
    expect((result.results as any[]).every((r: any) => r.entityId === 'customers:customer_person_profile')).toBe(true)
  })

  it('allows a superadmin to see all requested entity types', async () => {
    const lookup = makeLookup([
      { entityId: 'secret:thing', aclFeatures: ['secret.view'], enabled: true },
    ])
    const { service, calls } = makeSearchService([
      { entityId: 'secret:thing', recordId: 's1', score: 0.8, source: 'fulltext' },
    ])
    const ctx = makeCtx({ userFeatures: [], isSuperAdmin: true })
    ;(ctx.container.resolve as jest.Mock).mockImplementation((name: string) => {
      if (name === 'searchService') return service
      if (name === 'searchIndexer') return lookup
      throw new Error(`unexpected ${name}`)
    })
    const result = (await tool.handler({ q: 'test', entityTypes: ['secret:thing'] }, ctx as any)) as Record<string, unknown>
    expect(calls[0].options.entityTypes).toEqual(['secret:thing'])
    expect(result.totalResults).toBe(1)
  })
})

describe('search.get_record_context', () => {
  const tool = findTool('search.get_record_context')

  it('returns the matching hit with presenter/url/links', async () => {
    const match = {
      entityId: 'catalog:product',
      recordId: 'rec-42',
      score: 1,
      source: 'fulltext',
      presenter: { title: 'Widget' },
      url: '/backend/catalog/catalog/products/rec-42',
      links: [{ href: '/backend/catalog/catalog/products/rec-42', label: 'Open', kind: 'primary' }],
    }
    const { service, calls } = makeSearchService([
      { entityId: 'catalog:product', recordId: 'rec-99', score: 0.5, source: 'fulltext' },
      match,
    ])
    const ctx = makeCtx()
    const lookup = permissiveLookup(['catalog:product'])
    ;(ctx.container.resolve as jest.Mock).mockImplementation((name: string) => {
      if (name === 'searchService') return service
      if (name === 'searchIndexer') return lookup
      throw new Error(`unexpected ${name}`)
    })
    const result = (await tool.handler(
      { entityId: 'catalog:product', recordId: 'rec-42' },
      ctx as any,
    )) as Record<string, unknown>
    expect(calls[0].query).toBe('rec-42')
    expect(calls[0].options).toMatchObject({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      limit: 5,
      entityTypes: ['catalog:product'],
    })
    expect(result.found).toBe(true)
    expect(result.recordId).toBe('rec-42')
    expect(result.presenter).toEqual(match.presenter)
    expect(result.url).toBe(match.url)
    expect(result.links).toEqual(match.links)
  })

  it('returns { found: false } when no hit matches the recordId', async () => {
    const { service } = makeSearchService([
      { entityId: 'catalog:product', recordId: 'other', score: 0.2, source: 'fulltext' },
    ])
    const ctx = makeCtx()
    const lookup = permissiveLookup(['catalog:product'])
    ;(ctx.container.resolve as jest.Mock).mockImplementation((name: string) => {
      if (name === 'searchService') return service
      if (name === 'searchIndexer') return lookup
      throw new Error(`unexpected ${name}`)
    })
    const result = (await tool.handler(
      { entityId: 'catalog:product', recordId: 'missing' },
      ctx as any,
    )) as Record<string, unknown>
    expect(result.found).toBe(false)
    expect(result.recordId).toBe('missing')
  })

  it('passes the caller tenant/org and never leaks another tenant', async () => {
    const { service, calls } = makeSearchService([])
    const ctx = makeCtx({ tenantId: 'tenant-A', organizationId: 'org-A' })
    const lookup = permissiveLookup(['x:y'])
    ;(ctx.container.resolve as jest.Mock).mockImplementation((name: string) => {
      if (name === 'searchService') return service
      if (name === 'searchIndexer') return lookup
      throw new Error(`unexpected ${name}`)
    })
    await tool.handler({ entityId: 'x:y', recordId: 'z' }, ctx as any)
    expect(calls[0].options).toMatchObject({
      tenantId: 'tenant-A',
      organizationId: 'org-A',
    })
    expect(calls[0].options).not.toHaveProperty('bypassTenantScope')
  })

  it('throws when tenant context is missing', async () => {
    const ctx = makeCtx({ tenantId: null })
    ;(ctx.container.resolve as jest.Mock).mockReturnValue({ search: jest.fn() })
    await expect(
      tool.handler({ entityId: 'x:y', recordId: 'z' }, ctx as any),
    ).rejects.toThrow(/Tenant context/)
  })

  it('rejects an explicitly requested unauthorized entity type', async () => {
    const lookup = makeLookup([
      { entityId: 'customers:customer_person_profile', aclFeatures: ['customers.people.view'], enabled: true },
    ])
    const { service } = makeSearchService([])
    const ctx = makeCtx({ userFeatures: ['search.view'] })
    ;(ctx.container.resolve as jest.Mock).mockImplementation((name: string) => {
      if (name === 'searchService') return service
      if (name === 'searchIndexer') return lookup
      throw new Error(`unexpected ${name}`)
    })
    await expect(
      tool.handler({ entityId: 'customers:customer_person_profile', recordId: 'rec-1' }, ctx as any),
    ).rejects.toThrow(/Insufficient permissions/)
  })

  it('allows an authorized caller to retrieve record context', async () => {
    const lookup = makeLookup([
      { entityId: 'customers:customer_person_profile', aclFeatures: ['customers.people.view'], enabled: true },
    ])
    const { service } = makeSearchService([
      { entityId: 'customers:customer_person_profile', recordId: 'rec-1', score: 1, source: 'fulltext', presenter: { title: 'Person' }, url: '/backend/customers/people/rec-1', links: [] },
    ])
    const ctx = makeCtx({ userFeatures: ['search.view', 'customers.people.view'] })
    ;(ctx.container.resolve as jest.Mock).mockImplementation((name: string) => {
      if (name === 'searchService') return service
      if (name === 'searchIndexer') return lookup
      throw new Error(`unexpected ${name}`)
    })
    const result = (await tool.handler({ entityId: 'customers:customer_person_profile', recordId: 'rec-1' }, ctx as any)) as Record<string, unknown>
    expect(result.found).toBe(true)
    expect((result as any).presenter.title).toBe('Person')
  })

  it('filters stray results a strategy returned for an unreadable entity (defense in depth)', async () => {
    const lookup = makeLookup([
      { entityId: 'customers:customer_person_profile', aclFeatures: ['customers.people.view'], enabled: true },
      { entityId: 'secret:thing', aclFeatures: ['secret.view'], enabled: true },
    ])
    // User can read person, but strategy returns secret thing for same recordId
    const { service } = makeSearchService([
      { entityId: 'secret:thing', recordId: 'rec-1', score: 1, source: 'fulltext', presenter: { title: 'Secret' } },
    ])
    const ctx = makeCtx({ userFeatures: ['search.view', 'customers.people.view'] })
    ;(ctx.container.resolve as jest.Mock).mockImplementation((name: string) => {
      if (name === 'searchService') return service
      if (name === 'searchIndexer') return lookup
      throw new Error(`unexpected ${name}`)
    })
    // Requesting person, but backend returned secret – should be filtered to not found
    const result = (await tool.handler({ entityId: 'customers:customer_person_profile', recordId: 'rec-1' }, ctx as any)) as Record<string, unknown>
    expect(result.found).toBe(false)
  })

  it('allows a superadmin to retrieve any record context', async () => {
    const lookup = makeLookup([
      { entityId: 'secret:thing', aclFeatures: ['secret.view'], enabled: true },
    ])
    const { service } = makeSearchService([
      { entityId: 'secret:thing', recordId: 'rec-1', score: 1, source: 'fulltext', presenter: { title: 'Secret' }, url: '/x', links: [] },
    ])
    const ctx = makeCtx({ userFeatures: [], isSuperAdmin: true })
    ;(ctx.container.resolve as jest.Mock).mockImplementation((name: string) => {
      if (name === 'searchService') return service
      if (name === 'searchIndexer') return lookup
      throw new Error(`unexpected ${name}`)
    })
    const result = (await tool.handler({ entityId: 'secret:thing', recordId: 'rec-1' }, ctx as any)) as Record<string, unknown>
    expect(result.found).toBe(true)
  })
})

describe('search-pack tool surface', () => {
  it('exports exactly the expected tool names and shapes', () => {
    const names = searchAiTools.map((tool) => tool.name)
    expect(names).toEqual(['search.hybrid_search', 'search.get_record_context'])
    for (const tool of searchAiTools) {
      expect(typeof tool.description).toBe('string')
      expect(tool.isMutation).not.toBe(true)
      expect(tool.requiredFeatures).toContain('search.view')
    }
  })
})
