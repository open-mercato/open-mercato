import { SearchIndexer } from '../indexer/search-indexer'
import type { SearchModuleConfig } from '../types'
import type { QueryEngine, QueryResult } from '@open-mercato/shared/lib/query/types'

describe('SearchIndexer.indexRecordsById', () => {
  const moduleConfigs: SearchModuleConfig[] = [
    {
      entities: [
        {
          entityId: 'test:entity',
          enabled: true,
          formatResult: async (ctx) => ({ title: String(ctx.record.name ?? ctx.record.id) }),
        },
      ],
    },
  ]

  function makeQueryEngine(records: Record<string, unknown>[]): QueryEngine {
    return {
      query: jest.fn(async (_entity, opts) => {
        const wantedId = (opts?.filters as { id?: string } | undefined)?.id
        const items = records.filter((r) => r.id === wantedId)
        return { items, total: items.length } as QueryResult
      }),
    }
  }

  it('writes N queued records through exactly one bulkIndex call, not N', async () => {
    const records = [
      { id: 'rec-1', name: 'Alpha' },
      { id: 'rec-2', name: 'Beta' },
      { id: 'rec-3', name: 'Gamma' },
    ]
    const searchService = { bulkIndex: jest.fn().mockResolvedValue(undefined) }
    const indexer = new SearchIndexer(searchService as any, moduleConfigs, {
      queryEngine: makeQueryEngine(records),
    })

    const result = await indexer.indexRecordsById(
      [
        { entityId: 'test:entity', recordId: 'rec-1' },
        { entityId: 'test:entity', recordId: 'rec-2' },
        { entityId: 'test:entity', recordId: 'rec-3' },
      ],
      'tenant-123',
      'org-456',
    )

    expect(searchService.bulkIndex).toHaveBeenCalledTimes(1)
    expect(searchService.bulkIndex).toHaveBeenCalledWith([
      expect.objectContaining({ entityId: 'test:entity', recordId: 'rec-1', tenantId: 'tenant-123', organizationId: 'org-456' }),
      expect.objectContaining({ entityId: 'test:entity', recordId: 'rec-2', tenantId: 'tenant-123', organizationId: 'org-456' }),
      expect.objectContaining({ entityId: 'test:entity', recordId: 'rec-3', tenantId: 'tenant-123', organizationId: 'org-456' }),
    ])
    expect(result).toEqual({ indexed: 3, skipped: 0 })
  })

  it('skips records that no longer exist without failing the batch write', async () => {
    const records = [{ id: 'rec-1', name: 'Alpha' }]
    const searchService = { bulkIndex: jest.fn().mockResolvedValue(undefined) }
    const indexer = new SearchIndexer(searchService as any, moduleConfigs, {
      queryEngine: makeQueryEngine(records),
    })

    const result = await indexer.indexRecordsById(
      [
        { entityId: 'test:entity', recordId: 'rec-1' },
        { entityId: 'test:entity', recordId: 'missing' },
      ],
      'tenant-123',
      null,
    )

    expect(searchService.bulkIndex).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ indexed: 1, skipped: 1 })
  })

  it('skips entities that are not configured and never calls bulkIndex when nothing is indexable', async () => {
    const searchService = { bulkIndex: jest.fn().mockResolvedValue(undefined) }
    const indexer = new SearchIndexer(searchService as any, moduleConfigs, {
      queryEngine: makeQueryEngine([]),
    })

    const result = await indexer.indexRecordsById(
      [{ entityId: 'unknown:entity', recordId: 'rec-1' }],
      'tenant-123',
      null,
    )

    expect(searchService.bulkIndex).not.toHaveBeenCalled()
    expect(result).toEqual({ indexed: 0, skipped: 1 })
  })
})
