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
        {
          entityId: 'test:other',
          enabled: true,
          formatResult: async (ctx) => ({ title: String(ctx.record.name ?? ctx.record.id) }),
        },
      ],
    },
  ]

  function makeQueryEngine(recordsByEntity: Record<string, Record<string, unknown>[]>): QueryEngine {
    return {
      query: jest.fn(async (entity, opts) => {
        const wantedId = (opts?.filters as { id?: string } | undefined)?.id
        const items = (recordsByEntity[entity as string] ?? []).filter((r) => r.id === wantedId)
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
      queryEngine: makeQueryEngine({ 'test:entity': records }),
    })

    const result = await indexer.indexRecordsById({
      items: [
        { entityId: 'test:entity', recordId: 'rec-1' },
        { entityId: 'test:entity', recordId: 'rec-2' },
        { entityId: 'test:entity', recordId: 'rec-3' },
      ],
      tenantId: 'tenant-123',
      organizationId: 'org-456',
    })

    expect(searchService.bulkIndex).toHaveBeenCalledTimes(1)
    expect(searchService.bulkIndex).toHaveBeenCalledWith([
      expect.objectContaining({ entityId: 'test:entity', recordId: 'rec-1', tenantId: 'tenant-123', organizationId: 'org-456' }),
      expect.objectContaining({ entityId: 'test:entity', recordId: 'rec-2', tenantId: 'tenant-123', organizationId: 'org-456' }),
      expect.objectContaining({ entityId: 'test:entity', recordId: 'rec-3', tenantId: 'tenant-123', organizationId: 'org-456' }),
    ])
    expect(result).toEqual({ indexed: 3, skipped: 0 })
  })

  it('collapses records spanning multiple entities into one bulkIndex call', async () => {
    const searchService = { bulkIndex: jest.fn().mockResolvedValue(undefined) }
    const indexer = new SearchIndexer(searchService as any, moduleConfigs, {
      queryEngine: makeQueryEngine({
        'test:entity': [{ id: 'rec-1', name: 'Alpha' }],
        'test:other': [{ id: 'other-1', name: 'Delta' }],
      }),
    })

    const result = await indexer.indexRecordsById({
      items: [
        { entityId: 'test:entity', recordId: 'rec-1' },
        { entityId: 'test:other', recordId: 'other-1' },
      ],
      tenantId: 'tenant-123',
      organizationId: null,
    })

    expect(searchService.bulkIndex).toHaveBeenCalledTimes(1)
    expect(searchService.bulkIndex).toHaveBeenCalledWith([
      expect.objectContaining({ entityId: 'test:entity', recordId: 'rec-1' }),
      expect.objectContaining({ entityId: 'test:other', recordId: 'other-1' }),
    ])
    expect(result).toEqual({ indexed: 2, skipped: 0 })
  })

  it('loads each record with custom fields and without triggering auto-reindex', async () => {
    const queryEngine = makeQueryEngine({ 'test:entity': [{ id: 'rec-1', name: 'Alpha' }] })
    const searchService = { bulkIndex: jest.fn().mockResolvedValue(undefined) }
    const indexer = new SearchIndexer(searchService as any, moduleConfigs, { queryEngine })

    await indexer.indexRecordsById({
      items: [{ entityId: 'test:entity', recordId: 'rec-1' }],
      tenantId: 'tenant-123',
      organizationId: 'org-456',
    })

    expect(queryEngine.query).toHaveBeenCalledWith(
      'test:entity',
      expect.objectContaining({
        tenantId: 'tenant-123',
        organizationId: 'org-456',
        filters: { id: 'rec-1' },
        includeCustomFields: true,
        skipAutoReindex: true,
      }),
    )
  })

  it('skips records that no longer exist without failing the batch write', async () => {
    const records = [{ id: 'rec-1', name: 'Alpha' }]
    const searchService = { bulkIndex: jest.fn().mockResolvedValue(undefined) }
    const indexer = new SearchIndexer(searchService as any, moduleConfigs, {
      queryEngine: makeQueryEngine({ 'test:entity': records }),
    })

    const result = await indexer.indexRecordsById({
      items: [
        { entityId: 'test:entity', recordId: 'rec-1' },
        { entityId: 'test:entity', recordId: 'missing' },
      ],
      tenantId: 'tenant-123',
      organizationId: null,
    })

    expect(searchService.bulkIndex).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ indexed: 1, skipped: 1 })
  })

  it('keeps indexing the batch when loading one record throws', async () => {
    const searchService = { bulkIndex: jest.fn().mockResolvedValue(undefined) }
    const queryEngine: QueryEngine = {
      query: jest.fn(async (_entity, opts) => {
        const wantedId = (opts?.filters as { id?: string } | undefined)?.id
        if (wantedId === 'boom') throw new Error('connection lost')
        return { items: [{ id: wantedId, name: 'Alpha' }], total: 1 } as QueryResult
      }),
    }
    const indexer = new SearchIndexer(searchService as any, moduleConfigs, { queryEngine })

    const result = await indexer.indexRecordsById({
      items: [
        { entityId: 'test:entity', recordId: 'rec-1' },
        { entityId: 'test:entity', recordId: 'boom' },
        { entityId: 'test:entity', recordId: 'rec-2' },
      ],
      tenantId: 'tenant-123',
      organizationId: null,
    })

    expect(searchService.bulkIndex).toHaveBeenCalledTimes(1)
    expect(searchService.bulkIndex).toHaveBeenCalledWith([
      expect.objectContaining({ recordId: 'rec-1' }),
      expect.objectContaining({ recordId: 'rec-2' }),
    ])
    expect(result).toEqual({ indexed: 2, skipped: 1 })
  })

  it('propagates a bulkIndex failure so the queue can retry the job', async () => {
    const searchService = { bulkIndex: jest.fn().mockRejectedValue(new Error('meilisearch unavailable')) }
    const indexer = new SearchIndexer(searchService as any, moduleConfigs, {
      queryEngine: makeQueryEngine({ 'test:entity': [{ id: 'rec-1', name: 'Alpha' }] }),
    })

    await expect(
      indexer.indexRecordsById({
        items: [{ entityId: 'test:entity', recordId: 'rec-1' }],
        tenantId: 'tenant-123',
        organizationId: null,
      }),
    ).rejects.toThrow('meilisearch unavailable')
  })

  it('skips entities that are not configured and never calls bulkIndex when nothing is indexable', async () => {
    const searchService = { bulkIndex: jest.fn().mockResolvedValue(undefined) }
    const indexer = new SearchIndexer(searchService as any, moduleConfigs, {
      queryEngine: makeQueryEngine({}),
    })

    const result = await indexer.indexRecordsById({
      items: [{ entityId: 'unknown:entity', recordId: 'rec-1' }],
      tenantId: 'tenant-123',
      organizationId: null,
    })

    expect(searchService.bulkIndex).not.toHaveBeenCalled()
    expect(result).toEqual({ indexed: 0, skipped: 1 })
  })

  it('counts records dropped for a missing id as skipped so the totals add up', async () => {
    const searchService = { bulkIndex: jest.fn().mockResolvedValue(undefined) }
    const queryEngine: QueryEngine = {
      query: jest.fn(async (_entity, opts) => {
        const wantedId = (opts?.filters as { id?: string } | undefined)?.id
        const item = wantedId === 'no-id' ? { name: 'Ghost' } : { id: wantedId, name: 'Alpha' }
        return { items: [item], total: 1 } as QueryResult
      }),
    }
    const indexer = new SearchIndexer(searchService as any, moduleConfigs, { queryEngine })

    const result = await indexer.indexRecordsById({
      items: [
        { entityId: 'test:entity', recordId: 'rec-1' },
        { entityId: 'test:entity', recordId: 'no-id' },
      ],
      tenantId: 'tenant-123',
      organizationId: null,
    })

    expect(result).toEqual({ indexed: 1, skipped: 1 })
  })
})
