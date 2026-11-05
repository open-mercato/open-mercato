import { SearchService } from '../service'
import { VectorSearchStrategy } from '../strategies/vector.strategy'
import { FullTextSearchStrategy } from '../strategies/fulltext.strategy'
import { TokenSearchStrategy } from '../strategies/token.strategy'

/**
 * Regression coverage for issue #2935: the search purge chain ignored
 * organizationId and deleted index entries by (tenantId, entityType) only,
 * letting a holder of search.embeddings.manage in one organization destroy
 * another organization's entries within the same tenant. organizationId must
 * now flow through SearchService.purge -> every strategy.purge -> the driver,
 * and each store must scope the delete to that organization when provided
 * (while preserving the tenant-wide purge when no organization is given).
 */

function fakeStrategy(id: string) {
  return {
    id,
    name: id,
    priority: 1,
    isAvailable: jest.fn().mockResolvedValue(true),
    search: jest.fn().mockResolvedValue([]),
    index: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    purge: jest.fn().mockResolvedValue(undefined),
  }
}

describe('SearchService.purge organization scoping (issue #2935)', () => {
  it('forwards organizationId to every available strategy', async () => {
    const vector = fakeStrategy('vector')
    const tokens = fakeStrategy('tokens')
    const service = new SearchService({ strategies: [vector, tokens] as never })

    await service.purge('demo:item', 'tenant-1', 'org-A')

    expect(vector.purge).toHaveBeenCalledWith('demo:item', 'tenant-1', 'org-A')
    expect(tokens.purge).toHaveBeenCalledWith('demo:item', 'tenant-1', 'org-A')
  })

  it('performs a tenant-wide purge (no organization) when organizationId is omitted', async () => {
    const vector = fakeStrategy('vector')
    const service = new SearchService({ strategies: [vector] as never })

    await service.purge('demo:item', 'tenant-1')

    expect(vector.purge).toHaveBeenCalledWith('demo:item', 'tenant-1', undefined)
  })
})

describe('VectorSearchStrategy.purge organization scoping (issue #2935)', () => {
  function createDriver() {
    return {
      id: 'pgvector' as const,
      ensureReady: jest.fn().mockResolvedValue(undefined),
      upsert: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue([]),
      getChecksum: jest.fn().mockResolvedValue(null),
      purge: jest.fn().mockResolvedValue(undefined),
    }
  }

  it('forwards organizationId to the vector driver', async () => {
    const driver = createDriver()
    const strategy = new VectorSearchStrategy({ available: true } as never, driver as never)

    await strategy.purge('demo:item', 'tenant-1', 'org-A')

    expect(driver.purge).toHaveBeenCalledWith('demo:item', 'tenant-1', 'org-A')
  })

  it('forwards an undefined organizationId for a tenant-wide purge', async () => {
    const driver = createDriver()
    const strategy = new VectorSearchStrategy({ available: true } as never, driver as never)

    await strategy.purge('demo:item', 'tenant-1')

    expect(driver.purge).toHaveBeenCalledWith('demo:item', 'tenant-1', undefined)
  })
})

describe('FullTextSearchStrategy.purge organization scoping (issue #2935)', () => {
  it('forwards organizationId to the fulltext driver', async () => {
    const driver = {
      ensureReady: jest.fn().mockResolvedValue(undefined),
      isHealthy: jest.fn().mockResolvedValue(true),
      search: jest.fn().mockResolvedValue([]),
      index: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      purge: jest.fn().mockResolvedValue(undefined),
    }
    const strategy = new FullTextSearchStrategy(driver as never)

    await strategy.purge('demo:item', 'tenant-1', 'org-A')

    expect(driver.purge).toHaveBeenCalledWith('demo:item', 'tenant-1', 'org-A')
  })
})

describe('TokenSearchStrategy.purge organization scoping (issue #2935)', () => {
  function createMockDb() {
    const wheres: Array<[string, string, unknown]> = []
    const builder: Record<string, unknown> = {
      where: jest.fn((column: string, op: string, value: unknown) => {
        wheres.push([column, op, value])
        return builder
      }),
      execute: jest.fn().mockResolvedValue([]),
    }
    const db = { deleteFrom: jest.fn(() => builder) }
    return { db, wheres }
  }

  it('adds an organization_id filter to the delete when an organization is provided', async () => {
    const { db, wheres } = createMockDb()
    const strategy = new TokenSearchStrategy(db as never)

    await strategy.purge('demo:item', 'tenant-1', 'org-A')

    expect(wheres).toContainEqual(['entity_type', '=', 'demo:item'])
    expect(wheres).toContainEqual(['tenant_id', '=', 'tenant-1'])
    expect(wheres).toContainEqual(['organization_id', '=', 'org-A'])
  })

  it('does NOT add an organization_id filter for a tenant-wide purge', async () => {
    const { db, wheres } = createMockDb()
    const strategy = new TokenSearchStrategy(db as never)

    await strategy.purge('demo:item', 'tenant-1')

    expect(wheres.map((entry) => entry[0])).not.toContain('organization_id')
    expect(wheres).toContainEqual(['entity_type', '=', 'demo:item'])
    expect(wheres).toContainEqual(['tenant_id', '=', 'tenant-1'])
  })
})
