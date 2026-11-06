import { SearchIndexer } from '../indexer/search-indexer'
import type { SearchModuleConfig, SearchEntityConfig, SearchBuildContext } from '../types'
import type { QueryEngine, QueryResult } from '@open-mercato/shared/lib/query/types'

type SearchServiceMock = {
  index: jest.Mock
  bulkIndex: jest.Mock
  delete: jest.Mock
  purge: jest.Mock
  getStrategy: jest.Mock
}

const TENANT = 'tenant-1'
const ORG = 'org-1'

const records = [
  { id: 'rec-allowed', name: 'Alpha', optedIn: true },
  { id: 'rec-rejected', name: 'Beta', optedIn: false },
  { id: 'rec-throws', name: 'Gamma', optedIn: 'boom' },
]

function gatedShouldIndex(ctx: SearchBuildContext): boolean {
  if (ctx.record.optedIn === 'boom') throw new Error('lookup failed')
  return ctx.record.optedIn === true
}

function makeModuleConfigs(entity: Partial<SearchEntityConfig>): SearchModuleConfig[] {
  return [
    {
      entities: [
        {
          entityId: 'test:entity',
          formatResult: async (ctx) => ({ title: String(ctx.record.name) }),
          ...entity,
        },
      ],
    },
  ]
}

function makeQueryEngine(items: Record<string, unknown>[]): QueryEngine {
  return {
    query: jest.fn(async (_entity, opts) => {
      const wantedId = (opts?.filters as { id?: string } | undefined)?.id
      const matched = wantedId ? items.filter((item) => item.id === wantedId) : items
      return { items: matched, total: matched.length } as QueryResult
    }),
  }
}

function makeSearchService(fulltext?: { bulkIndex: jest.Mock; recreateIndex: jest.Mock }): SearchServiceMock {
  return {
    index: jest.fn().mockResolvedValue(undefined),
    bulkIndex: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    purge: jest.fn().mockResolvedValue(undefined),
    getStrategy: jest.fn(() => fulltext),
  }
}

function makeIndexer(searchService: SearchServiceMock, entity: Partial<SearchEntityConfig>) {
  return new SearchIndexer(searchService as never, makeModuleConfigs(entity), {
    queryEngine: makeQueryEngine(records),
  })
}

function indexedIds(calls: unknown[][]): string[] {
  return calls.flatMap((call) => (call[0] as Array<{ recordId: string }>).map((record) => record.recordId))
}

describe('SearchIndexer shouldIndex gate', () => {
  describe('indexRecord', () => {
    it('deletes the record from every strategy and skips indexing when the hook returns false', async () => {
      const searchService = makeSearchService()
      const indexer = makeIndexer(searchService, { shouldIndex: gatedShouldIndex })

      await indexer.indexRecord({ entityId: 'test:entity', recordId: 'rec-rejected', tenantId: TENANT, organizationId: ORG, record: records[1] })

      expect(searchService.delete).toHaveBeenCalledWith('test:entity', 'rec-rejected', TENANT)
      expect(searchService.index).not.toHaveBeenCalled()
    })

    it('fails closed when the hook throws', async () => {
      const searchService = makeSearchService()
      const indexer = makeIndexer(searchService, { shouldIndex: gatedShouldIndex })

      await indexer.indexRecord({ entityId: 'test:entity', recordId: 'rec-throws', tenantId: TENANT, organizationId: ORG, record: records[2] })

      expect(searchService.delete).toHaveBeenCalledWith('test:entity', 'rec-throws', TENANT)
      expect(searchService.index).not.toHaveBeenCalled()
    })

    it('indexes the record when the hook returns true and hands the hook a query engine', async () => {
      const searchService = makeSearchService()
      const shouldIndex = jest.fn(async (ctx: SearchBuildContext) => {
        expect(ctx.queryEngine).toBeDefined()
        expect(ctx.tenantId).toBe(TENANT)
        return true
      })
      const indexer = makeIndexer(searchService, { shouldIndex })

      await indexer.indexRecord({ entityId: 'test:entity', recordId: 'rec-allowed', tenantId: TENANT, organizationId: ORG, record: records[0] })

      expect(shouldIndex).toHaveBeenCalledTimes(1)
      expect(searchService.index).toHaveBeenCalledWith(expect.objectContaining({ recordId: 'rec-allowed' }))
      expect(searchService.delete).not.toHaveBeenCalled()
    })

    it('treats a non-boolean truthy result as a rejection', async () => {
      const searchService = makeSearchService()
      const indexer = makeIndexer(searchService, { shouldIndex: (() => 'yes') as unknown as SearchEntityConfig['shouldIndex'] })

      await indexer.indexRecord({ entityId: 'test:entity', recordId: 'rec-allowed', tenantId: TENANT, record: records[0] })

      expect(searchService.index).not.toHaveBeenCalled()
      expect(searchService.delete).toHaveBeenCalledTimes(1)
    })

    it('indexes every record exactly as before when the entity declares no hook', async () => {
      const searchService = makeSearchService()
      const indexer = makeIndexer(searchService, {})

      for (const record of records) {
        await indexer.indexRecord({ entityId: 'test:entity', recordId: String(record.id), tenantId: TENANT, organizationId: ORG, record })
      }

      expect(searchService.index).toHaveBeenCalledTimes(3)
      expect(searchService.delete).not.toHaveBeenCalled()
    })
  })

  it('reports a rejected record as skipped from indexRecordById', async () => {
    const searchService = makeSearchService()
    const indexer = makeIndexer(searchService, { shouldIndex: gatedShouldIndex })

    const rejected = await indexer.indexRecordById({ entityId: 'test:entity', recordId: 'rec-rejected', tenantId: TENANT, organizationId: ORG })
    const allowed = await indexer.indexRecordById({ entityId: 'test:entity', recordId: 'rec-allowed', tenantId: TENANT, organizationId: ORG })

    expect(rejected).toEqual({ action: 'skipped', reason: 'excluded by shouldIndex' })
    expect(allowed).toEqual({ action: 'indexed' })
    expect(searchService.index).toHaveBeenCalledTimes(1)
    expect(searchService.delete).toHaveBeenCalledWith('test:entity', 'rec-rejected', TENANT)
  })

  it('bulk-indexes only allowed records in indexRecordsById and deletes the rest', async () => {
    const searchService = makeSearchService()
    const indexer = makeIndexer(searchService, { shouldIndex: gatedShouldIndex })

    const result = await indexer.indexRecordsById({
      items: records.map((record) => ({ entityId: 'test:entity', recordId: String(record.id) })),
      tenantId: TENANT,
      organizationId: ORG,
    })

    expect(result).toEqual({ indexed: 1, skipped: 2 })
    expect(indexedIds(searchService.bulkIndex.mock.calls)).toEqual(['rec-allowed'])
    expect(searchService.delete.mock.calls.map((call) => call[1]).sort()).toEqual(['rec-rejected', 'rec-throws'])
  })

  it('applies the gate in bulkIndexRecords', async () => {
    const searchService = makeSearchService()
    const indexer = makeIndexer(searchService, { shouldIndex: gatedShouldIndex })

    await indexer.bulkIndexRecords(
      records.map((record) => ({ entityId: 'test:entity', recordId: String(record.id), tenantId: TENANT, organizationId: ORG, record })),
    )

    expect(indexedIds(searchService.bulkIndex.mock.calls)).toEqual(['rec-allowed'])
    expect(searchService.delete).toHaveBeenCalledTimes(2)
  })

  it('applies the gate in reindexEntity and reindexAll', async () => {
    const searchService = makeSearchService()
    const indexer = makeIndexer(searchService, { shouldIndex: gatedShouldIndex })

    const entityResult = await indexer.reindexEntity({ entityId: 'test:entity', tenantId: TENANT, organizationId: ORG })
    expect(entityResult.recordsIndexed).toBe(1)
    expect(indexedIds(searchService.bulkIndex.mock.calls)).toEqual(['rec-allowed'])
    expect(searchService.delete).toHaveBeenCalledTimes(2)

    searchService.bulkIndex.mockClear()
    searchService.delete.mockClear()

    const allResult = await indexer.reindexAll({ tenantId: TENANT, organizationId: ORG })
    expect(allResult.recordsIndexed).toBe(1)
    expect(indexedIds(searchService.bulkIndex.mock.calls)).toEqual(['rec-allowed'])
    expect(searchService.delete).toHaveBeenCalledTimes(2)
  })

  it('applies the gate in the direct fulltext reindex path', async () => {
    const fulltext = { bulkIndex: jest.fn().mockResolvedValue(undefined), recreateIndex: jest.fn().mockResolvedValue(undefined) }
    const searchService = makeSearchService(fulltext)
    const indexer = makeIndexer(searchService, { shouldIndex: gatedShouldIndex })

    const result = await indexer.reindexEntityToFulltext({ entityId: 'test:entity', tenantId: TENANT, organizationId: ORG })

    expect(result.recordsIndexed).toBe(1)
    expect(indexedIds(fulltext.bulkIndex.mock.calls)).toEqual(['rec-allowed'])
    expect(searchService.delete).toHaveBeenCalledTimes(2)
  })

  it('applies the gate in the direct vector reindex path', async () => {
    const searchService = makeSearchService()
    const indexer = makeIndexer(searchService, { shouldIndex: gatedShouldIndex })

    await indexer.reindexEntityToVector({ entityId: 'test:entity', tenantId: TENANT, organizationId: ORG, useQueue: false })

    expect(searchService.index).toHaveBeenCalledTimes(1)
    expect(searchService.index).toHaveBeenCalledWith(expect.objectContaining({ recordId: 'rec-allowed' }))
    expect(searchService.delete).toHaveBeenCalledTimes(2)
  })

  it('leaves reindex output unchanged for entities without the hook', async () => {
    const searchService = makeSearchService()
    const indexer = makeIndexer(searchService, {})

    const result = await indexer.reindexEntity({ entityId: 'test:entity', tenantId: TENANT, organizationId: ORG })

    expect(result.recordsIndexed).toBe(3)
    expect(indexedIds(searchService.bulkIndex.mock.calls)).toEqual(['rec-allowed', 'rec-rejected', 'rec-throws'])
    expect(searchService.delete).not.toHaveBeenCalled()
  })
})
