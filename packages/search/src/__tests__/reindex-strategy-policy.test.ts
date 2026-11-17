import { registerSearchModuleConfigs } from '@open-mercato/shared/modules/search'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { Queue, QueuedJob } from '@open-mercato/queue'
import { SearchIndexer } from '../indexer/search-indexer'
import { SearchService } from '../service'
import type { SearchModuleConfig, SearchStrategy } from '../types'
import type { FulltextIndexJobPayload } from '../queue/fulltext-indexing'
import type { VectorIndexJobPayload } from '../queue/vector-indexing'
import { VectorIndexService } from '../vector/services/vector-index.service'
import type { EmbeddingService } from '../vector/services/embedding'
import type { VectorDriver } from '../vector/types'
import { resolveEntityIndexStrategies } from '../lib/entity-strategy-policy'

import { handleFulltextIndexJob } from '../modules/search/workers/fulltext-index.worker'
import { handleVectorIndexJob } from '../modules/search/workers/vector-index.worker'

jest.mock('@open-mercato/shared/lib/indexers/status-log', () => ({
  recordIndexerLog: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../vector/lib/vector-logs', () => ({
  logVectorOperation: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../modules/search/lib/reindex-progress', () => ({
  hasActiveReindexProgress: jest.fn().mockResolvedValue(false),
  incrementReindexProgress: jest.fn().mockResolvedValue(false),
}))

const entityId = 'test:entity'
const tenantId = 'tenant-1'
const organizationId = 'org-1'

function strategy(id: string) {
  return {
    id,
    name: id,
    priority: 1,
    isAvailable: jest.fn().mockResolvedValue(true),
    ensureReady: jest.fn().mockResolvedValue(undefined),
    search: jest.fn().mockResolvedValue([]),
    index: jest.fn().mockResolvedValue(undefined),
    bulkIndex: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    recreateIndex: jest.fn().mockResolvedValue(undefined),
  } satisfies SearchStrategy & { recreateIndex: () => Promise<void> }
}

function fixture(moduleConfigs: SearchModuleConfig[]) {
  registerSearchModuleConfigs(moduleConfigs)
  const fulltext = strategy('fulltext')
  const vector = strategy('vector')
  const searchService = new SearchService({ strategies: [fulltext, vector] })
  const query = jest.fn().mockResolvedValue({ items: [{ id: 'record-1', name: 'Example' }], total: 1 })
  const queryEngine: QueryEngine = { query }
  const fulltextEnqueue = jest.fn().mockResolvedValue(undefined)
  const vectorEnqueue = jest.fn().mockResolvedValue(undefined)
  const indexer = new SearchIndexer(searchService, moduleConfigs, {
    queryEngine,
    fulltextQueue: { enqueue: fulltextEnqueue } as unknown as Queue<FulltextIndexJobPayload>,
    vectorQueue: { enqueue: vectorEnqueue } as unknown as Queue<VectorIndexJobPayload>,
  })
  return { indexer, fulltext, vector, query, fulltextEnqueue, vectorEnqueue }
}

afterEach(() => registerSearchModuleConfigs([]))

const excludedPolicies: Array<[string, SearchModuleConfig[]]> = [
  ['entity restriction', [{ entities: [{ entityId, strategies: ['tokens'] }] }]],
  ['empty entity strategies', [{ entities: [{ entityId, strategies: [] }] }]],
  ['module default', [{ defaultStrategies: ['tokens'], entities: [{ entityId }] }]],
  ['disabled entity', [{ entities: [{ entityId, enabled: false }] }]],
]

describe.each(excludedPolicies)('%s', (_name, moduleConfigs) => {
  it.each([true, false])('blocks fulltext reindex before reading or queueing data (queue=%s)', async (useQueue) => {
    const state = fixture(moduleConfigs)
    const result = await state.indexer.reindexEntityToFulltext({ entityId, tenantId, organizationId, useQueue })
    expect(result.recordsIndexed).toBe(0)
    expect(state.query).not.toHaveBeenCalled()
    expect(state.fulltextEnqueue).not.toHaveBeenCalled()
    expect(state.fulltext.bulkIndex).not.toHaveBeenCalled()
    expect(state.fulltext.recreateIndex).not.toHaveBeenCalled()
    expect(state.vector.index).not.toHaveBeenCalled()
  })

  it.each([true, false])('blocks vector reindex before reading or queueing data (queue=%s)', async (useQueue) => {
    const state = fixture(moduleConfigs)
    const result = await state.indexer.reindexEntityToVector({ entityId, tenantId, organizationId, useQueue })
    expect(result.recordsIndexed).toBe(0)
    expect(state.query).not.toHaveBeenCalled()
    expect(state.vectorEnqueue).not.toHaveBeenCalled()
    expect(state.fulltext.index).not.toHaveBeenCalled()
    expect(state.vector.index).not.toHaveBeenCalled()
  })

  it.each(['index', 'batch-index'] as const)('enforces policy through real queue handlers (%s)', async (jobType) => {
    const state = fixture(moduleConfigs)
    const consumeRecord = jest.spyOn(state.indexer, 'indexRecordById')
    const context = {
      resolve<T>(name: string): T {
        if (name === 'searchIndexer') return state.indexer as T
        if (name === 'searchStrategies') return [state.fulltext, state.vector] as T
        throw new Error('[internal] Service unavailable in worker fixture')
      },
    }
    const payload = jobType === 'index'
      ? { jobType, entityType: entityId, recordId: 'record-1', tenantId, organizationId }
      : { jobType, records: [{ entityId, recordId: 'record-1' }], tenantId, organizationId }
    const job: QueuedJob<FulltextIndexJobPayload & VectorIndexJobPayload> = {
      id: 'job-1', payload, createdAt: new Date().toISOString(),
    }
    const jobContext = { jobId: job.id, attemptNumber: 1, queueName: 'test-queue' }
    await handleFulltextIndexJob(job, jobContext, context)
    await handleVectorIndexJob(job, jobContext, context)
    expect(consumeRecord).toHaveBeenCalled()
    expect(state.fulltext.index).not.toHaveBeenCalled()
    expect(state.fulltext.bulkIndex).not.toHaveBeenCalled()
    expect(state.vector.index).not.toHaveBeenCalled()
    expect(state.vector.bulkIndex).not.toHaveBeenCalled()
  })

  it('blocks excluded backends during general single and all-entity reindexing', async () => {
    const state = fixture(moduleConfigs)
    await state.indexer.reindexEntity({ entityId, tenantId, organizationId })
    await state.indexer.reindexAll({ tenantId, organizationId })
    expect(state.fulltext.bulkIndex).not.toHaveBeenCalled()
    expect(state.vector.bulkIndex).not.toHaveBeenCalled()
  })

  it('rechecks policy when queued single and batch references are consumed', async () => {
    const state = fixture(moduleConfigs)
    await state.indexer.indexRecordById({ entityId, recordId: 'record-1', tenantId, organizationId })
    await state.indexer.indexRecordsById({ items: [{ entityId, recordId: 'record-1' }], tenantId, organizationId })
    expect(state.fulltext.index).not.toHaveBeenCalled()
    expect(state.fulltext.bulkIndex).not.toHaveBeenCalled()
    expect(state.vector.index).not.toHaveBeenCalled()
    expect(state.vector.bulkIndex).not.toHaveBeenCalled()
  })
})

it.each([true, false])('keeps allowed fulltext reindex working (queue=%s)', async (useQueue) => {
  const state = fixture([{ defaultStrategies: ['tokens'], entities: [{ entityId, strategies: ['fulltext'] }] }])
  const result = await state.indexer.reindexEntityToFulltext({ entityId, tenantId, organizationId, useQueue })
  expect(result.recordsIndexed).toBe(1)
  if (useQueue) expect(state.fulltextEnqueue).toHaveBeenCalledTimes(1)
  else expect(state.fulltext.bulkIndex).toHaveBeenCalledWith([expect.objectContaining({ entityId, tenantId, organizationId })])
  expect(state.vector.index).not.toHaveBeenCalled()
})

it.each([true, false])('keeps allowed vector reindex working (queue=%s)', async (useQueue) => {
  const state = fixture([{ entities: [{ entityId, strategies: ['vector'] }] }])
  const result = await state.indexer.reindexEntityToVector({ entityId, tenantId, organizationId, useQueue })
  expect(result.recordsIndexed).toBe(1)
  if (useQueue) expect(state.vectorEnqueue).toHaveBeenCalledTimes(1)
  else expect(state.vector.index).toHaveBeenCalledWith(expect.objectContaining({ entityId, tenantId, organizationId }))
  expect(state.fulltext.index).not.toHaveBeenCalled()
})

it('resolves the last declaration and keeps unspecified configurations unrestricted', () => {
  expect(resolveEntityIndexStrategies(entityId, [])).toBeUndefined()
  expect(resolveEntityIndexStrategies(entityId, [{ entities: [{ entityId, strategies: [] }] }, { entities: [{ entityId }] }])).toBeUndefined()
  expect(resolveEntityIndexStrategies(entityId, [{ defaultStrategies: ['fulltext'], entities: [{ entityId, enabled: false }] }])).toEqual([])
})

it.each([true, false])('keeps excluded payloads out of every backend when reindexing all entities (queue=%s)', async (useQueue) => {
  const state = fixture([{ entities: [{ entityId, strategies: ['tokens'] }] }])
  await state.indexer.reindexAllToFulltext({ tenantId, organizationId, useQueue })
  await state.indexer.reindexAllToVector({ tenantId, organizationId, useQueue })
  expect(state.query).not.toHaveBeenCalled()
  expect(state.fulltextEnqueue).not.toHaveBeenCalled()
  expect(state.vectorEnqueue).not.toHaveBeenCalled()
  expect(state.fulltext.bulkIndex).not.toHaveBeenCalled()
  expect(state.vector.index).not.toHaveBeenCalled()
})

it('applies updated policy when previously queued references are consumed', async () => {
  const configs: SearchModuleConfig[] = [{ entities: [{ entityId, strategies: ['fulltext', 'vector'] }] }]
  const state = fixture(configs)
  await state.indexer.reindexEntityToFulltext({ entityId, tenantId, organizationId, useQueue: true })
  const payload = state.fulltextEnqueue.mock.calls[0][0] as FulltextIndexJobPayload
  registerSearchModuleConfigs([{ entities: [{ entityId, strategies: [] }] }])
  await state.indexer.indexRecordsById({ items: payload.records ?? [], tenantId, organizationId })
  expect(state.fulltext.bulkIndex).not.toHaveBeenCalled()
  expect(state.vector.bulkIndex).not.toHaveBeenCalled()
})

it.each(['single', 'reindex'])('blocks legacy vector writes before source callbacks or embedding (%s)', async (mode) => {
  registerSearchModuleConfigs([{ entities: [{ entityId, strategies: ['tokens'] }] }])
  const buildSource = jest.fn().mockResolvedValue({ text: ['Example'] })
  const createEmbedding = jest.fn().mockResolvedValue([1, 2, 3])
  const upsert = jest.fn().mockResolvedValue(undefined)
  const driver = {
    id: 'pgvector',
    ensureReady: jest.fn().mockResolvedValue(undefined),
    getChecksum: jest.fn().mockResolvedValue(null),
    upsert,
  } as unknown as VectorDriver
  let queried = false
  const queryEngine: QueryEngine = { query: jest.fn(async () => {
    const items = queried ? [] : [{ id: 'record-1', name: 'Example' }]
    queried = true
    return { items, total: items.length }
  }) }
  const service = new VectorIndexService({
    drivers: [driver],
    embeddingService: { available: true, createEmbedding } as unknown as EmbeddingService,
    queryEngine,
    moduleConfigs: [{ entities: [{ entityId, buildSource }] }],
  })
  if (mode === 'single') {
    expect(await service.indexRecord({ entityId, recordId: 'record-1', tenantId, organizationId })).toMatchObject({ action: 'skipped' })
  } else {
    await service.reindexEntity({ entityId, tenantId, organizationId })
  }
  expect(buildSource).not.toHaveBeenCalled()
  expect(createEmbedding).not.toHaveBeenCalled()
  expect(upsert).not.toHaveBeenCalled()
})
