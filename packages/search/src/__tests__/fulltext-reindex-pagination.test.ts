import { SearchIndexer } from '../indexer/search-indexer'
import { SearchService } from '../service'
import { FullTextSearchStrategy } from '../strategies/fulltext.strategy'
import { handleFulltextIndexJob } from '../modules/search/workers/fulltext-index.worker'
import type { FullTextSearchDocument, FullTextSearchDriver } from '../fulltext/types'
import type { FulltextIndexJobPayload } from '../queue/fulltext-indexing'
import type { SearchModuleConfig } from '../types'
import { SortDir, type QueryEngine, type QueryResult } from '@open-mercato/shared/lib/query/types'
import type { Queue } from '@open-mercato/queue'

jest.mock('@open-mercato/shared/lib/indexers/status-log', () => ({
  recordIndexerLog: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@open-mercato/shared/lib/indexers/error-log', () => ({
  recordIndexerError: jest.fn().mockResolvedValue(undefined),
}))

const entityId = 'test:entity'
const tenantId = 'tenant-pagination'
const organizationId = 'organization-pagination'
const moduleConfigs: SearchModuleConfig[] = [{
  entities: [{
    entityId,
    enabled: true,
    formatResult: async ({ record }) => ({ title: String(record.name) }),
  }],
}]

describe('fulltext reindex pagination', () => {
  it.each([false, true])('indexes every record exactly once across pages (useQueue=%s)', async (useQueue) => {
    const fixtures = Array.from({ length: 401 }, (_, index) => ({
      id: `record-${String(index).padStart(4, '0')}`,
      name: `Record ${index}`,
    })).reverse()
    const documents = new Map<string, FullTextSearchDocument>()
    const indexedIds: string[] = []
    const driver: FullTextSearchDriver = {
      id: 'meilisearch',
      ensureReady: async () => {},
      isHealthy: async () => true,
      search: async () => [],
      index: async () => {},
      delete: async () => {},
      bulkIndex: async (batch) => {
        for (const document of batch) {
          indexedIds.push(document.recordId)
          documents.set(document.recordId, document)
        }
      },
    }
    const strategy = new FullTextSearchStrategy(driver)
    const service = new SearchService({ strategies: [strategy] })
    const query: QueryEngine['query'] = jest.fn(async (_entity, options) => {
      expect(options?.tenantId).toBe(tenantId)
      expect(options?.organizationId).toBe(organizationId)
      const recordId = (options?.filters as { id?: string } | undefined)?.id
      if (recordId) {
        const items = fixtures.filter((record) => record.id === recordId)
        return { items, total: items.length } as QueryResult
      }
      const page = options?.page?.page ?? 1
      const pageSize = options?.page?.pageSize ?? 200
      const sorted = options?.sort?.some((sort) => sort.field === 'id' && sort.dir === SortDir.Asc)
      const ordered = sorted
        ? [...fixtures].sort((first, second) => first.id.localeCompare(second.id))
        : page % 2 === 0 ? [...fixtures].reverse() : fixtures
      return {
        items: ordered.slice((page - 1) * pageSize, page * pageSize),
        total: fixtures.length,
      } as QueryResult
    })
    const jobs: FulltextIndexJobPayload[] = []
    const queue: Queue<FulltextIndexJobPayload> = {
      name: 'fulltext-indexing',
      strategy: 'local',
      enqueue: async (payload) => {
        jobs.push(payload)
        return String(jobs.length)
      },
      process: async () => ({ processed: 0, failed: 0 }),
      clear: async () => ({ removed: 0 }),
      close: async () => {},
      getJobCounts: async () => ({ waiting: jobs.length, active: 0, completed: 0, failed: 0 }),
    }
    const indexer = new SearchIndexer(service, moduleConfigs, {
      queryEngine: { query },
      fulltextQueue: queue,
      encryptedCustomFieldKeysResolver: async () => new Set<string>(),
    })

    const result = await indexer.reindexEntityToFulltext({
      entityId, tenantId, organizationId, useQueue, recreateIndex: false,
    })

    if (useQueue) {
      expect(jobs).toHaveLength(3)
      for (const [index, payload] of jobs.entries()) {
        await handleFulltextIndexJob(
          { id: String(index), payload, createdAt: '2026-11-09T12:00:00Z' },
          { jobId: String(index), attemptNumber: 1, queueName: queue.name },
          { resolve: <Value,>(name: string): Value => {
            if (name === 'searchIndexer') return indexer as Value
            if (name === 'searchService') return service as Value
            if (name === 'searchStrategies') return [strategy] as Value
            throw new Error('[internal] Unavailable service')
          } },
        )
      }
    }

    expect(result).toMatchObject({ success: true, recordsIndexed: 401, errors: [] })
    expect(new Set(documents.keys())).toEqual(new Set(fixtures.map((record) => record.id)))
    expect(indexedIds).toHaveLength(fixtures.length)
    expect(documents.get('record-0200')).toBeDefined()
    expect(documents.get('record-0400')).toBeDefined()
    expect([...documents.values()].every((document) =>
      document.tenantId === tenantId && document.organizationId === organizationId,
    )).toBe(true)
  })
})
