import { SearchIndexer } from '../indexer/search-indexer'
import type { SearchService } from '../service'
import type { SearchModuleConfig } from '../types'
import type { QueryEngine, QueryResult } from '@open-mercato/shared/lib/query/types'

const ENTITY = 'test:profile'
const TENANT = 'tenant-123'
const ORG = 'org-456'

const RECORDS = [
  { id: 'live-1', name: 'Alive', parent_deleted: false },
  { id: 'ghost-1', name: 'Ghost', parent_deleted: true },
]

function makeConfigs(isRecordExcluded: (record: Record<string, unknown>) => boolean | Promise<boolean>): SearchModuleConfig[] {
  return [
    {
      entities: [
        {
          entityId: ENTITY,
          enabled: true,
          isRecordExcluded: (ctx) => isRecordExcluded(ctx.record),
          buildSource: async (ctx) => ({ text: [String(ctx.record.name)], presenter: { title: String(ctx.record.name) } }),
        },
      ],
    },
  ]
}

function makeQueryEngine(): QueryEngine {
  return {
    query: jest.fn(async (_entity, opts) => {
      const wantedId = (opts?.filters as { id?: string } | undefined)?.id
      const items = wantedId ? RECORDS.filter((record) => record.id === wantedId) : RECORDS
      return { items, total: items.length } as QueryResult
    }),
  }
}

function makeSearchService() {
  const fulltext = {
    bulkIndex: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
    recreateIndex: jest.fn(async () => undefined),
  }
  const service = {
    index: jest.fn(async () => undefined),
    bulkIndex: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
    getStrategy: jest.fn((id: string) => (id === 'fulltext' ? fulltext : undefined)),
  }
  return { service, fulltext, asSearchService: service as unknown as SearchService }
}

const indexedIds = (calls: unknown[][]) =>
  calls.flatMap(([records]) => (records as Array<{ recordId: string }>).map((record) => record.recordId))

describe('SearchIndexer honours isRecordExcluded (#8638)', () => {
  const byParent = (record: Record<string, unknown>) => record.parent_deleted === true

  it('indexRecord removes an excluded record instead of indexing it', async () => {
    const { service, asSearchService } = makeSearchService()
    const indexer = new SearchIndexer(asSearchService, makeConfigs(byParent), { queryEngine: makeQueryEngine() })

    await indexer.indexRecord({ entityId: ENTITY, recordId: 'ghost-1', tenantId: TENANT, organizationId: ORG, record: RECORDS[1] })
    await indexer.indexRecord({ entityId: ENTITY, recordId: 'live-1', tenantId: TENANT, organizationId: ORG, record: RECORDS[0] })

    expect(service.delete).toHaveBeenCalledTimes(1)
    expect(service.delete).toHaveBeenCalledWith(ENTITY, 'ghost-1', TENANT)
    expect(service.index).toHaveBeenCalledTimes(1)
    expect(service.index).toHaveBeenCalledWith(expect.objectContaining({ recordId: 'live-1' }))
  })

  it('indexRecordById removes an excluded record', async () => {
    const { service, asSearchService } = makeSearchService()
    const indexer = new SearchIndexer(asSearchService, makeConfigs(byParent), { queryEngine: makeQueryEngine() })

    await indexer.indexRecordById({ entityId: ENTITY, recordId: 'ghost-1', tenantId: TENANT, organizationId: ORG })

    expect(service.delete).toHaveBeenCalledWith(ENTITY, 'ghost-1', TENANT)
    expect(service.index).not.toHaveBeenCalled()
  })

  it('indexRecordsById and bulkIndexRecords drop and remove excluded records', async () => {
    const { service, asSearchService } = makeSearchService()
    const indexer = new SearchIndexer(asSearchService, makeConfigs(byParent), { queryEngine: makeQueryEngine() })

    const result = await indexer.indexRecordsById({
      items: [{ entityId: ENTITY, recordId: 'live-1' }, { entityId: ENTITY, recordId: 'ghost-1' }],
      tenantId: TENANT,
      organizationId: ORG,
    })
    await indexer.bulkIndexRecords(RECORDS.map((record) => ({
      entityId: ENTITY,
      recordId: record.id,
      tenantId: TENANT,
      organizationId: ORG,
      record,
    })))

    expect(result).toEqual({ indexed: 1, skipped: 1 })
    expect(indexedIds(service.bulkIndex.mock.calls)).toEqual(['live-1', 'live-1'])
    expect(service.delete.mock.calls).toEqual([[ENTITY, 'ghost-1', TENANT], [ENTITY, 'ghost-1', TENANT]])
  })

  it('reindexEntity indexes only live records and removes excluded ones', async () => {
    const { service, asSearchService } = makeSearchService()
    const indexer = new SearchIndexer(asSearchService, makeConfigs(byParent), { queryEngine: makeQueryEngine() })

    const result = await indexer.reindexEntity({ entityId: ENTITY, tenantId: TENANT, organizationId: ORG })

    expect(result.recordsIndexed).toBe(1)
    expect(indexedIds(service.bulkIndex.mock.calls)).toEqual(['live-1'])
    expect(service.delete).toHaveBeenCalledWith(ENTITY, 'ghost-1', TENANT)
  })

  it('reindexEntityToFulltext removes excluded records from the fulltext strategy', async () => {
    const { fulltext, asSearchService } = makeSearchService()
    const indexer = new SearchIndexer(asSearchService, makeConfigs(byParent), { queryEngine: makeQueryEngine() })

    const result = await indexer.reindexEntityToFulltext({ entityId: ENTITY, tenantId: TENANT, organizationId: ORG, recreateIndex: false })

    expect(result.recordsDropped).toBe(1)
    expect(indexedIds(fulltext.bulkIndex.mock.calls)).toEqual(['live-1'])
    expect(fulltext.delete).toHaveBeenCalledWith(ENTITY, 'ghost-1', TENANT)
  })

  it('keeps indexing when the exclusion check fails', async () => {
    const { service, asSearchService } = makeSearchService()
    const failing = () => { throw new Error('[internal] lookup failed') }
    const indexer = new SearchIndexer(asSearchService, makeConfigs(failing), { queryEngine: makeQueryEngine() })

    await indexer.indexRecord({ entityId: ENTITY, recordId: 'ghost-1', tenantId: TENANT, organizationId: ORG, record: RECORDS[1] })

    expect(service.index).toHaveBeenCalledWith(expect.objectContaining({ recordId: 'ghost-1' }))
    expect(service.delete).not.toHaveBeenCalled()
  })

  it('leaves entities without isRecordExcluded unchanged', async () => {
    const { service, asSearchService } = makeSearchService()
    const configs: SearchModuleConfig[] = [{
      entities: [{ entityId: ENTITY, enabled: true, buildSource: async () => null }],
    }]
    const indexer = new SearchIndexer(asSearchService, configs, { queryEngine: makeQueryEngine() })

    await indexer.reindexEntity({ entityId: ENTITY, tenantId: TENANT, organizationId: ORG })

    expect(indexedIds(service.bulkIndex.mock.calls)).toEqual(['live-1', 'ghost-1'])
    expect(service.delete).not.toHaveBeenCalled()
  })
})
