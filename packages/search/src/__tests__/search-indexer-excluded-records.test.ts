import { SearchIndexer } from '../indexer/search-indexer'
import type { SearchService } from '../service'
import type { SearchModuleConfig } from '../types'
import type { QueryEngine, QueryResult } from '@open-mercato/shared/lib/query/types'

const ENTITY = 'test:profile'
const TENANT = 'tenant-123'
const ORG = 'org-456'

const noEncryptedCustomFields = async (): Promise<Set<string>> => new Set<string>()

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
    const indexer = new SearchIndexer(asSearchService, makeConfigs(byParent), { queryEngine: makeQueryEngine(), encryptedCustomFieldKeysResolver: noEncryptedCustomFields })

    await indexer.indexRecord({ entityId: ENTITY, recordId: 'ghost-1', tenantId: TENANT, organizationId: ORG, record: RECORDS[1] })
    await indexer.indexRecord({ entityId: ENTITY, recordId: 'live-1', tenantId: TENANT, organizationId: ORG, record: RECORDS[0] })

    expect(service.delete).toHaveBeenCalledTimes(1)
    expect(service.delete).toHaveBeenCalledWith(ENTITY, 'ghost-1', TENANT)
    expect(service.index).toHaveBeenCalledTimes(1)
    expect(service.index).toHaveBeenCalledWith(expect.objectContaining({ recordId: 'live-1' }))
  })

  it('indexRecordById removes an excluded record', async () => {
    const { service, asSearchService } = makeSearchService()
    const indexer = new SearchIndexer(asSearchService, makeConfigs(byParent), { queryEngine: makeQueryEngine(), encryptedCustomFieldKeysResolver: noEncryptedCustomFields })

    await indexer.indexRecordById({ entityId: ENTITY, recordId: 'ghost-1', tenantId: TENANT, organizationId: ORG })

    expect(service.delete).toHaveBeenCalledWith(ENTITY, 'ghost-1', TENANT)
    expect(service.index).not.toHaveBeenCalled()
  })

  it('indexRecordsById and bulkIndexRecords drop and remove excluded records', async () => {
    const { service, asSearchService } = makeSearchService()
    const indexer = new SearchIndexer(asSearchService, makeConfigs(byParent), { queryEngine: makeQueryEngine(), encryptedCustomFieldKeysResolver: noEncryptedCustomFields })

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
    const indexer = new SearchIndexer(asSearchService, makeConfigs(byParent), { queryEngine: makeQueryEngine(), encryptedCustomFieldKeysResolver: noEncryptedCustomFields })

    const result = await indexer.reindexEntity({ entityId: ENTITY, tenantId: TENANT, organizationId: ORG })

    expect(result.recordsIndexed).toBe(1)
    expect(indexedIds(service.bulkIndex.mock.calls)).toEqual(['live-1'])
    expect(service.delete).toHaveBeenCalledWith(ENTITY, 'ghost-1', TENANT)
  })

  it('reindexEntityToFulltext removes excluded records from the fulltext strategy', async () => {
    const { fulltext, asSearchService } = makeSearchService()
    const indexer = new SearchIndexer(asSearchService, makeConfigs(byParent), { queryEngine: makeQueryEngine(), encryptedCustomFieldKeysResolver: noEncryptedCustomFields })

    const result = await indexer.reindexEntityToFulltext({ entityId: ENTITY, tenantId: TENANT, organizationId: ORG, recreateIndex: false })

    expect(result.recordsDropped).toBe(1)
    expect(indexedIds(fulltext.bulkIndex.mock.calls)).toEqual(['live-1'])
    expect(fulltext.delete).toHaveBeenCalledWith(ENTITY, 'ghost-1', TENANT)
  })

  describe('when removing an excluded record fails', () => {
    const outage = () => Promise.reject(new Error('[internal] strategy unavailable'))
    const bulkParams = () => RECORDS.map((record) => ({
      entityId: ENTITY,
      recordId: record.id,
      tenantId: TENANT,
      organizationId: ORG,
      record,
    }))

    it('reindexEntity reports the failure and succeeds once the strategy recovers', async () => {
      const { service, asSearchService } = makeSearchService()
      service.delete.mockImplementationOnce(outage)
      const indexer = new SearchIndexer(asSearchService, makeConfigs(byParent), { queryEngine: makeQueryEngine(), encryptedCustomFieldKeysResolver: noEncryptedCustomFields })

      const failed = await indexer.reindexEntity({ entityId: ENTITY, tenantId: TENANT, organizationId: ORG })
      const retried = await indexer.reindexEntity({ entityId: ENTITY, tenantId: TENANT, organizationId: ORG })

      expect(failed.success).toBe(false)
      expect(failed.errors).toEqual([{ entityId: ENTITY, error: expect.stringContaining('ghost-1') }])
      expect(failed.recordsIndexed).toBe(1)
      expect(retried).toEqual(expect.objectContaining({ success: true, errors: [] }))
      expect(service.delete.mock.calls).toEqual([[ENTITY, 'ghost-1', TENANT], [ENTITY, 'ghost-1', TENANT]])
    })

    it('reindexEntityToFulltext reports the failure and succeeds once the strategy recovers', async () => {
      const { fulltext, asSearchService } = makeSearchService()
      fulltext.delete.mockImplementationOnce(outage)
      const indexer = new SearchIndexer(asSearchService, makeConfigs(byParent), { queryEngine: makeQueryEngine(), encryptedCustomFieldKeysResolver: noEncryptedCustomFields })
      const params = { entityId: ENTITY, tenantId: TENANT, organizationId: ORG, recreateIndex: false }

      const failed = await indexer.reindexEntityToFulltext(params)
      const retried = await indexer.reindexEntityToFulltext(params)

      expect(failed.success).toBe(false)
      expect(failed.errors).toEqual([{ entityId: ENTITY, error: expect.stringContaining('ghost-1') }])
      expect(indexedIds(fulltext.bulkIndex.mock.calls)).toEqual(['live-1', 'live-1'])
      expect(retried).toEqual(expect.objectContaining({ success: true, errors: [] }))
      expect(fulltext.delete).toHaveBeenCalledTimes(2)
    })

    it('bulkIndexRecords indexes live records, rejects, and resolves on retry', async () => {
      const { service, asSearchService } = makeSearchService()
      service.delete.mockImplementationOnce(outage)
      const indexer = new SearchIndexer(asSearchService, makeConfigs(byParent), { queryEngine: makeQueryEngine(), encryptedCustomFieldKeysResolver: noEncryptedCustomFields })

      await expect(indexer.bulkIndexRecords(bulkParams())).rejects.toThrow('ghost-1')
      await expect(indexer.bulkIndexRecords(bulkParams())).resolves.toBeUndefined()

      expect(indexedIds(service.bulkIndex.mock.calls)).toEqual(['live-1', 'live-1'])
      expect(service.delete).toHaveBeenCalledTimes(2)
    })

    it('indexRecordsById rejects after attempting every delete, and resolves on retry', async () => {
      const { service, asSearchService } = makeSearchService()
      const excludeAll = makeConfigs(() => true)
      service.delete.mockImplementationOnce(outage)
      const indexer = new SearchIndexer(asSearchService, excludeAll, { queryEngine: makeQueryEngine(), encryptedCustomFieldKeysResolver: noEncryptedCustomFields })
      const params = {
        items: RECORDS.map((record) => ({ entityId: ENTITY, recordId: record.id })),
        tenantId: TENANT,
        organizationId: ORG,
      }

      await expect(indexer.indexRecordsById({ ...params, items: [...params.items].reverse() })).rejects.toThrow('ghost-1')
      await expect(indexer.indexRecordsById(params)).resolves.toEqual({ indexed: 0, skipped: 2 })

      expect(service.delete.mock.calls).toEqual([
        [ENTITY, 'ghost-1', TENANT],
        [ENTITY, 'live-1', TENANT],
        [ENTITY, 'live-1', TENANT],
        [ENTITY, 'ghost-1', TENANT],
      ])
    })
  })

  describe('when the exclusion check fails', () => {
    const failOnceForGhost = () => {
      let failed = false
      return (record: Record<string, unknown>) => {
        if (record.id === 'ghost-1' && !failed) {
          failed = true
          throw new Error('[internal] parent lookup failed')
        }
        return byParent(record)
      }
    }
    const ghostParams = { entityId: ENTITY, recordId: 'ghost-1', tenantId: TENANT, organizationId: ORG, record: RECORDS[1] }
    const bulkParams = () => RECORDS.map((record) => ({
      entityId: ENTITY,
      recordId: record.id,
      tenantId: TENANT,
      organizationId: ORG,
      record,
    }))

    it('indexRecord writes nothing, rejects, and removes the record on retry', async () => {
      const { service, asSearchService } = makeSearchService()
      const indexer = new SearchIndexer(asSearchService, makeConfigs(failOnceForGhost()), { queryEngine: makeQueryEngine(), encryptedCustomFieldKeysResolver: noEncryptedCustomFields })

      await expect(indexer.indexRecord(ghostParams)).rejects.toThrow('parent lookup failed')
      expect(service.index).not.toHaveBeenCalled()
      expect(service.delete).not.toHaveBeenCalled()

      await indexer.indexRecord(ghostParams)
      expect(service.index).not.toHaveBeenCalled()
      expect(service.delete).toHaveBeenCalledWith(ENTITY, 'ghost-1', TENANT)
    })

    it('reindexEntity skips the record, reports the failure, and removes it on retry', async () => {
      const { service, asSearchService } = makeSearchService()
      const indexer = new SearchIndexer(asSearchService, makeConfigs(failOnceForGhost()), { queryEngine: makeQueryEngine(), encryptedCustomFieldKeysResolver: noEncryptedCustomFields })

      const failed = await indexer.reindexEntity({ entityId: ENTITY, tenantId: TENANT, organizationId: ORG })
      expect(failed.success).toBe(false)
      expect(failed.errors).toEqual([{ entityId: ENTITY, error: expect.stringContaining('ghost-1') }])
      expect(indexedIds(service.bulkIndex.mock.calls)).toEqual(['live-1'])
      expect(service.delete).not.toHaveBeenCalled()

      const retried = await indexer.reindexEntity({ entityId: ENTITY, tenantId: TENANT, organizationId: ORG })
      expect(retried).toEqual(expect.objectContaining({ success: true, errors: [] }))
      expect(indexedIds(service.bulkIndex.mock.calls)).toEqual(['live-1', 'live-1'])
      expect(service.delete).toHaveBeenCalledWith(ENTITY, 'ghost-1', TENANT)
    })

    it('reindexEntityToFulltext skips the record, reports the failure, and removes it on retry', async () => {
      const { fulltext, asSearchService } = makeSearchService()
      const indexer = new SearchIndexer(asSearchService, makeConfigs(failOnceForGhost()), { queryEngine: makeQueryEngine(), encryptedCustomFieldKeysResolver: noEncryptedCustomFields })
      const params = { entityId: ENTITY, tenantId: TENANT, organizationId: ORG, recreateIndex: false }

      const failed = await indexer.reindexEntityToFulltext(params)
      expect(failed.success).toBe(false)
      expect(failed.errors).toEqual([{ entityId: ENTITY, error: expect.stringContaining('ghost-1') }])
      expect(fulltext.delete).not.toHaveBeenCalled()

      const retried = await indexer.reindexEntityToFulltext(params)
      expect(retried).toEqual(expect.objectContaining({ success: true, errors: [] }))
      expect(indexedIds(fulltext.bulkIndex.mock.calls)).toEqual(['live-1', 'live-1'])
      expect(fulltext.delete).toHaveBeenCalledWith(ENTITY, 'ghost-1', TENANT)
    })

    it('bulkIndexRecords indexes only confirmed records, rejects, and removes the record on retry', async () => {
      const { service, asSearchService } = makeSearchService()
      const indexer = new SearchIndexer(asSearchService, makeConfigs(failOnceForGhost()), { queryEngine: makeQueryEngine(), encryptedCustomFieldKeysResolver: noEncryptedCustomFields })

      await expect(indexer.bulkIndexRecords(bulkParams())).rejects.toThrow('ghost-1')
      expect(indexedIds(service.bulkIndex.mock.calls)).toEqual(['live-1'])
      expect(service.delete).not.toHaveBeenCalled()

      await expect(indexer.bulkIndexRecords(bulkParams())).resolves.toBeUndefined()
      expect(indexedIds(service.bulkIndex.mock.calls)).toEqual(['live-1', 'live-1'])
      expect(service.delete).toHaveBeenCalledWith(ENTITY, 'ghost-1', TENANT)
    })

    it('indexRecordsById writes nothing for the record, rejects, and removes it on retry', async () => {
      const { service, asSearchService } = makeSearchService()
      const indexer = new SearchIndexer(asSearchService, makeConfigs(failOnceForGhost()), { queryEngine: makeQueryEngine(), encryptedCustomFieldKeysResolver: noEncryptedCustomFields })
      const params = { items: [{ entityId: ENTITY, recordId: 'ghost-1' }], tenantId: TENANT, organizationId: ORG }

      await expect(indexer.indexRecordsById(params)).rejects.toThrow('ghost-1')
      expect(service.bulkIndex).not.toHaveBeenCalled()
      expect(service.delete).not.toHaveBeenCalled()

      await expect(indexer.indexRecordsById(params)).resolves.toEqual({ indexed: 0, skipped: 1 })
      expect(service.delete).toHaveBeenCalledWith(ENTITY, 'ghost-1', TENANT)
    })
  })

  it('leaves entities without isRecordExcluded unchanged', async () => {
    const { service, asSearchService } = makeSearchService()
    const configs: SearchModuleConfig[] = [{
      entities: [{ entityId: ENTITY, enabled: true, buildSource: async () => null }],
    }]
    const indexer = new SearchIndexer(asSearchService, configs, { queryEngine: makeQueryEngine(), encryptedCustomFieldKeysResolver: noEncryptedCustomFields })

    await indexer.reindexEntity({ entityId: ENTITY, tenantId: TENANT, organizationId: ORG })

    expect(indexedIds(service.bulkIndex.mock.calls)).toEqual(['live-1', 'ghost-1'])
    expect(service.delete).not.toHaveBeenCalled()
  })
})
