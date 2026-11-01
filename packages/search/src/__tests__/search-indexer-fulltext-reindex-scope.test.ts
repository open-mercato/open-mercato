import { SearchIndexer } from '../indexer/search-indexer'
import { SearchService } from '../service'
import { FullTextSearchStrategy } from '../strategies/fulltext.strategy'
import type { FullTextSearchDocument, FullTextSearchDriver } from '../fulltext/types'
import type { SearchModuleConfig } from '../types'
import type { SearchIndexerOptions } from '../indexer/search-indexer'
import type { QueryEngine, QueryResult } from '@open-mercato/shared/lib/query/types'

const TENANT = 'tenant-1'
const ORG_A = 'org-a'
const ORG_B = 'org-b'

function createTenantIndexDriver() {
  const indexes = new Map<string, Map<string, FullTextSearchDocument>>()
  const tenantIndex = (tenantId: string) => {
    const existing = indexes.get(tenantId)
    if (existing) return existing
    const created = new Map<string, FullTextSearchDocument>()
    indexes.set(tenantId, created)
    return created
  }
  const upsert = async (doc: FullTextSearchDocument) => {
    tenantIndex(doc.tenantId).set(`${doc.entityId}:${doc.recordId}`, doc)
  }

  const driver: FullTextSearchDriver = {
    id: 'meilisearch',
    ensureReady: jest.fn(async () => {}),
    isHealthy: jest.fn(async () => true),
    search: jest.fn(async () => []),
    index: jest.fn(upsert),
    delete: jest.fn(async () => {}),
    bulkIndex: jest.fn(async (docs: FullTextSearchDocument[]) => {
      for (const doc of docs) await upsert(doc)
    }),
    purge: jest.fn(async (entityId: string, tenantId: string, organizationId?: string | null) => {
      const index = tenantIndex(tenantId)
      for (const [key, doc] of index) {
        if (doc.entityId !== entityId) continue
        if (organizationId && doc.organizationId !== organizationId) continue
        index.delete(key)
      }
    }),
    recreateIndex: jest.fn(async (tenantId: string) => {
      indexes.set(tenantId, new Map())
    }),
  }

  const keys = (tenantId: string) => [...tenantIndex(tenantId).keys()].sort()
  return { driver, upsert, keys }
}

function seedDoc(entityId: string, recordId: string, organizationId: string | null): FullTextSearchDocument {
  return { entityId, recordId, tenantId: TENANT, organizationId, fields: { name: recordId } }
}

const moduleConfigs: SearchModuleConfig[] = [
  {
    entities: [
      { entityId: 'test:product', enabled: true },
      { entityId: 'test:customer', enabled: true },
    ],
  },
]

function makeQueryEngine(rows: Record<string, Array<{ id: string; organization_id: string }>>): QueryEngine {
  return {
    query: jest.fn(async (entity, opts) => {
      const all = rows[entity as string] ?? []
      const items = opts?.organizationId ? all.filter((row) => row.organization_id === opts.organizationId) : all
      return { items, total: items.length } as QueryResult
    }),
  }
}

async function setup(fulltextQueue?: SearchIndexerOptions['fulltextQueue']) {
  const fake = createTenantIndexDriver()
  const searchService = new SearchService({ strategies: [new FullTextSearchStrategy(fake.driver)] })
  await fake.upsert(seedDoc('test:product', 'p-a-stale', ORG_A))
  await fake.upsert(seedDoc('test:product', 'p-b-1', ORG_B))
  await fake.upsert(seedDoc('test:customer', 'c-a-1', ORG_A))
  await fake.upsert(seedDoc('test:customer', 'c-b-1', ORG_B))
  const indexer = new SearchIndexer(searchService, moduleConfigs, {
    fulltextQueue,
    queryEngine: makeQueryEngine({
      'test:product': [
        { id: 'p-a-1', organization_id: ORG_A },
        { id: 'p-b-1', organization_id: ORG_B },
      ],
      'test:customer': [
        { id: 'c-a-1', organization_id: ORG_A },
        { id: 'c-b-1', organization_id: ORG_B },
      ],
    }),
  })
  return { ...fake, indexer }
}

describe('SearchIndexer fulltext reindex keeps other entities and organizations in the shared tenant index', () => {
  it('reindexEntityToFulltext keeps other entity types and other organizations searchable', async () => {
    const { indexer, driver, keys } = await setup()

    const result = await indexer.reindexEntityToFulltext({
      entityId: 'test:product',
      tenantId: TENANT,
      organizationId: ORG_A,
    })

    expect(result.success).toBe(true)
    expect(keys(TENANT)).toEqual([
      'test:customer:c-a-1',
      'test:customer:c-b-1',
      'test:product:p-a-1',
      'test:product:p-b-1',
    ])
    expect(driver.recreateIndex).not.toHaveBeenCalled()
    expect(driver.purge).toHaveBeenCalledWith('test:product', TENANT, ORG_A)
  })

  it('reindexEntityToFulltext without an organization clears only the requested entity type', async () => {
    const { indexer, driver, keys } = await setup()

    const result = await indexer.reindexEntityToFulltext({ entityId: 'test:product', tenantId: TENANT })

    expect(result.success).toBe(true)
    expect(keys(TENANT)).toEqual([
      'test:customer:c-a-1',
      'test:customer:c-b-1',
      'test:product:p-a-1',
      'test:product:p-b-1',
    ])
    expect(driver.recreateIndex).not.toHaveBeenCalled()
    expect(driver.purge).toHaveBeenCalledWith('test:product', TENANT, null)
  })

  it('reindexEntityToFulltext with recreateIndex false clears nothing', async () => {
    const { indexer, driver, keys } = await setup()

    await indexer.reindexEntityToFulltext({
      entityId: 'test:product',
      tenantId: TENANT,
      organizationId: ORG_A,
      recreateIndex: false,
    })

    expect(driver.recreateIndex).not.toHaveBeenCalled()
    expect(driver.purge).not.toHaveBeenCalled()
    expect(keys(TENANT)).toContain('test:product:p-a-stale')
  })

  it('reindexAllToFulltext scoped to an organization keeps other organizations searchable', async () => {
    const { indexer, driver, keys } = await setup()

    const result = await indexer.reindexAllToFulltext({ tenantId: TENANT, organizationId: ORG_A })

    expect(result.success).toBe(true)
    expect(keys(TENANT)).toEqual([
      'test:customer:c-a-1',
      'test:customer:c-b-1',
      'test:product:p-a-1',
      'test:product:p-b-1',
    ])
    expect(driver.recreateIndex).not.toHaveBeenCalled()
    expect(driver.purge).toHaveBeenCalledWith('test:product', TENANT, ORG_A)
    expect(driver.purge).toHaveBeenCalledWith('test:customer', TENANT, ORG_A)
  })

  it('reindexAllToFulltext without an organization still recreates the tenant index once', async () => {
    const { indexer, driver, keys } = await setup()

    const result = await indexer.reindexAllToFulltext({ tenantId: TENANT })

    expect(result.success).toBe(true)
    expect(keys(TENANT)).toEqual([
      'test:customer:c-a-1',
      'test:customer:c-b-1',
      'test:product:p-a-1',
      'test:product:p-b-1',
    ])
    expect(driver.recreateIndex).toHaveBeenCalledTimes(1)
    expect(driver.recreateIndex).toHaveBeenCalledWith(TENANT)
    expect(driver.purge).not.toHaveBeenCalled()
  })

  it('reindexEntityToFulltext in queue mode clears the scoped documents before enqueueing and indexes nothing directly', async () => {
    const order: string[] = []
    const enqueue = jest.fn(async () => {
      order.push('enqueue')
      return 'job-1'
    })
    const { indexer, driver, keys } = await setup({ enqueue } as unknown as SearchIndexerOptions['fulltextQueue'])
    const purge = driver.purge as jest.Mock
    const purgeImpl = purge.getMockImplementation()!
    purge.mockImplementation(async (...args: Parameters<typeof purgeImpl>) => {
      order.push('purge')
      return purgeImpl(...args)
    })

    const result = await indexer.reindexEntityToFulltext({
      entityId: 'test:product',
      tenantId: TENANT,
      organizationId: ORG_A,
      useQueue: true,
    })

    expect(result.success).toBe(true)
    expect(order).toEqual(['purge', 'enqueue'])
    expect(driver.recreateIndex).not.toHaveBeenCalled()
    expect(driver.bulkIndex).not.toHaveBeenCalled()
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        jobType: 'batch-index',
        tenantId: TENANT,
        organizationId: ORG_A,
        records: [{ entityId: 'test:product', recordId: 'p-a-1' }],
      }),
    )
    expect(keys(TENANT)).toEqual(['test:customer:c-a-1', 'test:customer:c-b-1', 'test:product:p-b-1'])
  })

  it('reindexAllToFulltext scoped to an organization with recreateIndex false clears nothing', async () => {
    const { indexer, driver, keys } = await setup()

    const result = await indexer.reindexAllToFulltext({ tenantId: TENANT, organizationId: ORG_A, recreateIndex: false })

    expect(result.success).toBe(true)
    expect(driver.recreateIndex).not.toHaveBeenCalled()
    expect(driver.purge).not.toHaveBeenCalled()
    expect(keys(TENANT)).toContain('test:product:p-a-stale')
  })

  it('reindexEntityToFulltext reports a failed clear as an error without indexing', async () => {
    const { indexer, driver } = await setup()
    ;(driver.purge as jest.Mock).mockRejectedValueOnce(new Error('purge unavailable'))

    const result = await indexer.reindexEntityToFulltext({
      entityId: 'test:product',
      tenantId: TENANT,
      organizationId: ORG_A,
    })

    expect(result.success).toBe(false)
    expect(result.errors).toEqual([{ entityId: 'test:product', error: 'purge unavailable' }])
    expect(driver.bulkIndex).not.toHaveBeenCalled()
  })

  it('reindexAllToFulltext scoped to an organization reports a failed clear per entity and keeps indexing the rest', async () => {
    const { indexer, driver, keys } = await setup()
    ;(driver.purge as jest.Mock).mockRejectedValueOnce(new Error('purge unavailable'))

    const result = await indexer.reindexAllToFulltext({ tenantId: TENANT, organizationId: ORG_A })

    expect(result.success).toBe(false)
    expect(result.errors).toEqual([{ entityId: 'test:product', error: 'purge unavailable' }])
    expect(driver.recreateIndex).not.toHaveBeenCalled()
    expect(keys(TENANT)).toEqual([
      'test:customer:c-a-1',
      'test:customer:c-b-1',
      'test:product:p-a-stale',
      'test:product:p-b-1',
    ])
  })
})
