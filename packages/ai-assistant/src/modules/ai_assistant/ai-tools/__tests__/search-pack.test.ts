/**
 * Step 3.8 — `search.*` tool pack unit tests.
 *
 * Covers `search.hybrid_search` happy path and `search.get_record_context`
 * happy / miss / tenant isolation.
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
    ;(ctx.container.resolve as jest.Mock).mockImplementation((name: string) => {
      if (name === 'searchService') return service
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
    ;(ctx.container.resolve as jest.Mock).mockReturnValue(service)
    await tool.handler({ q: 'hello' }, ctx as any)
    expect(calls[0].options.limit).toBe(20)
  })

  it('throws when tenant context is missing', async () => {
    const ctx = makeCtx({ tenantId: null })
    ;(ctx.container.resolve as jest.Mock).mockReturnValue({ search: jest.fn() })
    await expect(tool.handler({ q: 'x' }, ctx as any)).rejects.toThrow(/Tenant context/)
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
    ;(ctx.container.resolve as jest.Mock).mockReturnValue(service)
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
    ;(ctx.container.resolve as jest.Mock).mockReturnValue(service)
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
    ;(ctx.container.resolve as jest.Mock).mockReturnValue(service)
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
