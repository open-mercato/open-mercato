const mockGetAuthFromRequest = jest.fn()
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))

const mockCreateRequestContainer = jest.fn()
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

const mockRecordIndexerLog = jest.fn().mockResolvedValue(undefined)
const mockRecordIndexerError = jest.fn().mockResolvedValue(undefined)
jest.mock('@open-mercato/shared/lib/indexers/status-log', () => ({
  recordIndexerLog: (...args: unknown[]) => mockRecordIndexerLog(...args),
}))
jest.mock('@open-mercato/shared/lib/indexers/error-log', () => ({
  recordIndexerError: (...args: unknown[]) => mockRecordIndexerError(...args),
}))

const mockGetReindexLockStatus = jest.fn().mockResolvedValue(null)
const mockAcquireReindexLock = jest.fn().mockResolvedValue({ acquired: true })
const mockClearReindexLock = jest.fn().mockResolvedValue(undefined)
const mockSetReindexLockTotal = jest.fn()
jest.mock('../../lib/reindex-lock', () => ({
  getReindexLockStatus: (...args: unknown[]) => mockGetReindexLockStatus(...args),
  acquireReindexLock: (...args: unknown[]) => mockAcquireReindexLock(...args),
  clearReindexLock: (...args: unknown[]) => mockClearReindexLock(...args),
  setReindexLockTotal: (...args: unknown[]) => mockSetReindexLockTotal(...args),
  isReindexLockDrained: jest.requireActual('../../lib/reindex-lock').isReindexLockDrained,
}))

const mockStartReindexProgressJob = jest.fn().mockResolvedValue('progress-1')
const mockCompleteReindexProgress = jest.fn().mockResolvedValue(undefined)
const mockFailReindexProgress = jest.fn().mockResolvedValue(undefined)
const mockCancelReindexProgress = jest.fn().mockResolvedValue(undefined)
jest.mock('../../lib/reindex-progress', () => ({
  startReindexProgressJob: (...args: unknown[]) => mockStartReindexProgressJob(...args),
  completeReindexProgress: (...args: unknown[]) => mockCompleteReindexProgress(...args),
  failReindexProgress: (...args: unknown[]) => mockFailReindexProgress(...args),
  cancelReindexProgress: (...args: unknown[]) => mockCancelReindexProgress(...args),
}))

import { POST as fulltextReindexPost } from '../reindex/route'
import { POST as fulltextReindexCancelPost } from '../reindex/cancel/route'
import { SearchIndexer, type SearchIndexerOptions } from '../../../../indexer/search-indexer'
import { SearchService } from '../../../../service'
import { FullTextSearchStrategy } from '../../../../strategies/fulltext.strategy'
import type { FullTextSearchDriver } from '../../../../fulltext/types'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'

const mockProgressService = { updateProgress: jest.fn().mockResolvedValue(undefined) }

function mockAuth() {
  mockGetAuthFromRequest.mockResolvedValue({
    tenantId: 'tenant-123',
    orgId: 'org-456',
    sub: 'user-789',
  })
}

function makeRequest(body: Record<string, unknown> = {}) {
  return new Request('http://localhost/api/search/reindex', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/search/reindex', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAuth()
    mockGetReindexLockStatus.mockResolvedValue(null)
    mockAcquireReindexLock.mockResolvedValue({ acquired: true })
    mockClearReindexLock.mockResolvedValue(undefined)
    mockSetReindexLockTotal.mockImplementation(async (_db: unknown, _tenantId: string, _type: string, totalCount: number) => ({
      processedCount: 0,
      totalCount,
    }))
  })

  test('clears the fulltext lock when no indexable strategy is configured', async () => {
    const mockDb = { db: true }
    const mockEm = { getKysely: jest.fn(() => mockDb) }
    const mockContainer = {
      resolve: jest.fn((name: string) => {
        if (name === 'em') return mockEm
        if (name === 'progressService') return mockProgressService
        if (name === 'searchStrategies') return []
        throw new Error(`Unknown service: ${name}`)
      }),
      dispose: jest.fn().mockResolvedValue(undefined),
    }
    mockCreateRequestContainer.mockResolvedValue(mockContainer)

    const res = await fulltextReindexPost(makeRequest({ action: 'reindex' }))
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.error).toBe('No indexable search strategy is configured')
    expect(mockClearReindexLock).toHaveBeenCalledWith(mockDb, 'tenant-123', 'fulltext', 'org-456')
    expect(mockContainer.dispose).toHaveBeenCalled()
  })

  test('finishes progress and clears the fulltext lock when queued reindex enqueues no jobs', async () => {
    const mockDb = { db: true }
    const mockEm = { getKysely: jest.fn(() => mockDb) }
    const mockStrategy = {
      id: 'fulltext',
      isAvailable: jest.fn().mockResolvedValue(true),
      recreateIndex: jest.fn().mockResolvedValue(undefined),
    }
    const mockSearchIndexer = {
      listEnabledEntities: jest.fn(() => ['catalog:catalog_product']),
      reindexEntityToFulltext: jest.fn().mockResolvedValue({
        success: true,
        recordsIndexed: 0,
        jobsEnqueued: 0,
        errors: [],
      }),
    }
    const mockContainer = {
      resolve: jest.fn((name: string) => {
        if (name === 'em') return mockEm
        if (name === 'progressService') return mockProgressService
        if (name === 'searchStrategies') return [mockStrategy]
        if (name === 'searchIndexer') return mockSearchIndexer
        throw new Error(`Unknown service: ${name}`)
      }),
      dispose: jest.fn().mockResolvedValue(undefined),
    }
    mockCreateRequestContainer.mockResolvedValue(mockContainer)

    const res = await fulltextReindexPost(makeRequest({
      action: 'reindex',
      entityId: 'catalog:catalog_product',
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual(expect.objectContaining({
      ok: true,
      action: 'reindex',
      entityId: 'catalog:catalog_product',
      useQueue: true,
    }))
    expect(mockSearchIndexer.reindexEntityToFulltext).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: 'catalog:catalog_product',
        tenantId: 'tenant-123',
        organizationId: 'org-456',
        useQueue: true,
      }),
    )
    expect(mockStartReindexProgressJob).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'fulltext',
        tenantId: 'tenant-123',
        organizationId: 'org-456',
      }),
    )
    expect(mockProgressService.updateProgress).toHaveBeenCalledWith(
      'progress-1',
      { totalCount: 0 },
      expect.objectContaining({ tenantId: 'tenant-123', organizationId: 'org-456' }),
    )
    expect(mockCompleteReindexProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'fulltext',
        tenantId: 'tenant-123',
        organizationId: 'org-456',
        resultSummary: expect.objectContaining({
          recordsIndexed: 0,
          jobsEnqueued: 0,
          errors: 0,
        }),
      }),
    )
    expect(mockClearReindexLock).toHaveBeenCalledWith(mockDb, 'tenant-123', 'fulltext', 'org-456')
    expect(mockContainer.dispose).toHaveBeenCalled()
  })

  test.each([
    { label: 'entity', payload: { action: 'reindex', entityId: 'test:product', useQueue: false }, failedEntityId: 'test:product' },
    { label: 'full', payload: { action: 'reindex', useQueue: true }, failedEntityId: 'all' },
  ])('fails progress and returns a localized error when the fulltext driver cannot clear a scoped $label reindex', async ({ payload, failedEntityId }) => {
    const mockDb = { db: true }
    const mockEm = { getKysely: jest.fn(() => mockDb) }
    const driver: FullTextSearchDriver = {
      id: 'algolia',
      ensureReady: jest.fn(async () => {}),
      isHealthy: jest.fn(async () => true),
      search: jest.fn(async () => []),
      index: jest.fn(async () => {}),
      delete: jest.fn(async () => {}),
      bulkIndex: jest.fn(async () => {}),
      recreateIndex: jest.fn(async () => {}),
    }
    const strategy = new FullTextSearchStrategy(driver)
    const queryEngine: QueryEngine = { query: jest.fn() }
    const enqueue = jest.fn(async () => 'job-1')
    const searchIndexer = new SearchIndexer(
      new SearchService({ strategies: [strategy] }),
      [{ entities: [{ entityId: 'test:product', enabled: true }] }],
      { queryEngine, fulltextQueue: { enqueue } as unknown as SearchIndexerOptions['fulltextQueue'] },
    )
    const mockContainer = {
      resolve: jest.fn((name: string) => {
        if (name === 'em') return mockEm
        if (name === 'progressService') return mockProgressService
        if (name === 'searchStrategies') return [strategy]
        if (name === 'searchIndexer') return searchIndexer
        throw new Error(`Unknown service: ${name}`)
      }),
      dispose: jest.fn().mockResolvedValue(undefined),
    }
    mockCreateRequestContainer.mockResolvedValue(mockContainer)

    const res = await fulltextReindexPost(makeRequest(payload))
    const body = await res.json()

    expect(body.ok).toBe(false)
    expect(body.error).toBe('Reindex did not complete. Check the search activity log for details.')
    expect(body.result.errors).toEqual([
      { entityId: failedEntityId, error: expect.stringContaining('implement purge or listDocumentIds') },
    ])
    expect(mockFailReindexProgress).toHaveBeenCalledWith(expect.objectContaining({
      type: 'fulltext',
      tenantId: 'tenant-123',
      organizationId: 'org-456',
      errorMessage: expect.stringContaining('implement purge or listDocumentIds'),
    }))
    expect(mockCompleteReindexProgress).not.toHaveBeenCalled()
    expect(mockClearReindexLock).toHaveBeenCalledWith(mockDb, 'tenant-123', 'fulltext', 'org-456')
    expect(driver.recreateIndex).not.toHaveBeenCalled()
    expect(driver.bulkIndex).not.toHaveBeenCalled()
    expect(enqueue).not.toHaveBeenCalled()
    expect(queryEngine.query).not.toHaveBeenCalled()
  })

  test('keeps the lock and progress with queued workers when one entity fails its scoped clear, so a retry stays excluded', async () => {
    const mockDb = { db: true }
    const mockEm = { getKysely: jest.fn(() => mockDb) }
    let lockHeld = false
    mockAcquireReindexLock.mockImplementation(async () => {
      lockHeld = true
      return { acquired: true }
    })
    mockClearReindexLock.mockImplementation(async () => {
      lockHeld = false
    })
    mockGetReindexLockStatus.mockImplementation(async () => (lockHeld
      ? { type: 'fulltext', action: 'reindex', startedAt: new Date().toISOString(), processedCount: 0, totalCount: 1 }
      : null))
    const driver: FullTextSearchDriver = {
      id: 'meilisearch',
      ensureReady: jest.fn(async () => {}),
      isHealthy: jest.fn(async () => true),
      search: jest.fn(async () => []),
      index: jest.fn(async () => {}),
      delete: jest.fn(async () => {}),
      bulkIndex: jest.fn(async () => {}),
      purge: jest.fn(async (entityId: string) => {
        if (entityId === 'test:product') throw new Error('purge unavailable')
      }),
      recreateIndex: jest.fn(async () => {}),
    }
    const strategy = new FullTextSearchStrategy(driver)
    const queryEngine = {
      query: jest.fn(async () => ({ items: [{ id: 'c-1', organization_id: 'org-456' }], total: 1 })),
    } as unknown as QueryEngine
    const enqueue = jest.fn(async () => 'job-1')
    const searchIndexer = new SearchIndexer(
      new SearchService({ strategies: [strategy] }),
      [{ entities: [{ entityId: 'test:product', enabled: true }, { entityId: 'test:customer', enabled: true }] }],
      { queryEngine, fulltextQueue: { enqueue } as unknown as SearchIndexerOptions['fulltextQueue'] },
    )
    const mockContainer = {
      resolve: jest.fn((name: string) => {
        if (name === 'em') return mockEm
        if (name === 'progressService') return mockProgressService
        if (name === 'searchStrategies') return [strategy]
        if (name === 'searchIndexer') return searchIndexer
        throw new Error(`Unknown service: ${name}`)
      }),
      dispose: jest.fn().mockResolvedValue(undefined),
    }
    mockCreateRequestContainer.mockResolvedValue(mockContainer)

    const res = await fulltextReindexPost(makeRequest({ action: 'reindex' }))
    const body = await res.json()

    expect(body.ok).toBe(false)
    expect(body.error).toBe('Reindex did not complete. Check the search activity log for details.')
    expect(body.result).toEqual(expect.objectContaining({
      jobsEnqueued: 1,
      errors: [{ entityId: 'test:product', error: 'purge unavailable' }],
    }))
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      jobType: 'batch-index',
      records: [{ entityId: 'test:customer', recordId: 'c-1' }],
    }))
    expect(mockStartReindexProgressJob.mock.invocationCallOrder[0]).toBeLessThan(enqueue.mock.invocationCallOrder[0])
    expect(mockProgressService.updateProgress).toHaveBeenCalledWith('progress-1', { totalCount: 1 }, expect.anything())
    expect(mockSetReindexLockTotal).toHaveBeenCalledWith(mockDb, 'tenant-123', 'fulltext', 1, 'org-456')
    expect(mockFailReindexProgress).not.toHaveBeenCalled()
    expect(mockCompleteReindexProgress).not.toHaveBeenCalled()
    expect(mockClearReindexLock).not.toHaveBeenCalled()
    expect(mockRecordIndexerError).toHaveBeenCalledWith(
      { em: mockEm },
      expect.objectContaining({ entityType: 'test:product' }),
    )

    const retry = await fulltextReindexPost(makeRequest({ action: 'reindex' }))

    expect(retry.status).toBe(409)
    expect(mockAcquireReindexLock).toHaveBeenCalledTimes(1)
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(mockStartReindexProgressJob).toHaveBeenCalledTimes(1)
  })

  test('starts progress before enqueueing and settles a queued reindex whose batches drained before the request finished', async () => {
    const mockDb = { db: true }
    const mockEm = { getKysely: jest.fn(() => mockDb) }
    mockSetReindexLockTotal.mockResolvedValue({ processedCount: 2, totalCount: 2 })
    const driver: FullTextSearchDriver = {
      id: 'meilisearch',
      ensureReady: jest.fn(async () => {}),
      isHealthy: jest.fn(async () => true),
      search: jest.fn(async () => []),
      index: jest.fn(async () => {}),
      delete: jest.fn(async () => {}),
      bulkIndex: jest.fn(async () => {}),
      purge: jest.fn(async () => {}),
      recreateIndex: jest.fn(async () => {}),
    }
    const strategy = new FullTextSearchStrategy(driver)
    const queryEngine = {
      query: jest.fn(async () => ({
        items: [{ id: 'p-1', organization_id: 'org-456' }, { id: 'p-2', organization_id: 'org-456' }],
        total: 2,
      })),
    } as unknown as QueryEngine
    const enqueue = jest.fn(async () => 'job-1')
    const searchIndexer = new SearchIndexer(
      new SearchService({ strategies: [strategy] }),
      [{ entities: [{ entityId: 'test:product', enabled: true }] }],
      { queryEngine, fulltextQueue: { enqueue } as unknown as SearchIndexerOptions['fulltextQueue'] },
    )
    const mockContainer = {
      resolve: jest.fn((name: string) => {
        if (name === 'em') return mockEm
        if (name === 'progressService') return mockProgressService
        if (name === 'searchStrategies') return [strategy]
        if (name === 'searchIndexer') return searchIndexer
        throw new Error(`Unknown service: ${name}`)
      }),
      dispose: jest.fn().mockResolvedValue(undefined),
    }
    mockCreateRequestContainer.mockResolvedValue(mockContainer)

    const res = await fulltextReindexPost(makeRequest({ action: 'reindex' }))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(mockStartReindexProgressJob.mock.invocationCallOrder[0]).toBeLessThan(enqueue.mock.invocationCallOrder[0])
    expect(mockSetReindexLockTotal).toHaveBeenCalledWith(mockDb, 'tenant-123', 'fulltext', 2, 'org-456')
    expect(mockCompleteReindexProgress).toHaveBeenCalledWith(expect.objectContaining({
      type: 'fulltext',
      tenantId: 'tenant-123',
      organizationId: 'org-456',
      resultSummary: expect.objectContaining({ recordsIndexed: 2, jobsEnqueued: 1 }),
    }))
    expect(mockFailReindexProgress).not.toHaveBeenCalled()
    expect(mockClearReindexLock).toHaveBeenCalledWith(mockDb, 'tenant-123', 'fulltext', 'org-456')
  })

  test('cancel removes only current tenant and organization fulltext queue jobs', async () => {
    const mockDb = { db: true }
    const mockEm = { getKysely: jest.fn(() => mockDb) }
    const mockQueue = {
      getJobCounts: jest.fn().mockResolvedValue({ waiting: 3, active: 1, completed: 0, failed: 0 }),
      clear: jest.fn().mockResolvedValue({ removed: 4 }),
      removeQueuedJobsByScope: jest.fn().mockResolvedValue({ removed: 2 }),
    }
    const mockProgressService = { progress: true }
    const mockContainer = {
      resolve: jest.fn((name: string) => {
        if (name === 'em') return mockEm
        if (name === 'progressService') return mockProgressService
        if (name === 'fulltextIndexQueue') return mockQueue
        throw new Error(`Unknown service: ${name}`)
      }),
      dispose: jest.fn().mockResolvedValue(undefined),
    }
    mockCreateRequestContainer.mockResolvedValue(mockContainer)

    const res = await fulltextReindexCancelPost(new Request('http://localhost/api/search/reindex/cancel', {
      method: 'POST',
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true, jobsRemoved: 2 })
    expect(mockQueue.removeQueuedJobsByScope).toHaveBeenCalledWith({
      tenantId: 'tenant-123',
      organizationId: 'org-456',
      jobTypes: ['batch-index'],
    })
    expect(mockQueue.clear).not.toHaveBeenCalled()
    expect(mockClearReindexLock).toHaveBeenCalledWith(mockDb, 'tenant-123', 'fulltext', 'org-456')
    expect(mockCancelReindexProgress).toHaveBeenCalledWith(expect.objectContaining({
      em: mockEm,
      progressService: mockProgressService,
      type: 'fulltext',
      tenantId: 'tenant-123',
      organizationId: 'org-456',
      userId: 'user-789',
    }))
    expect(mockRecordIndexerLog).toHaveBeenCalledWith(
      { em: mockEm },
      expect.objectContaining({
        source: 'fulltext',
        details: { jobsRemoved: 2 },
        tenantId: 'tenant-123',
        organizationId: 'org-456',
      }),
    )
    expect(mockContainer.dispose).toHaveBeenCalled()
  })

  test('cancel fails closed when scoped fulltext queue removal is unavailable', async () => {
    const mockDb = { db: true }
    const mockEm = { getKysely: jest.fn(() => mockDb) }
    const mockQueue = {
      clear: jest.fn().mockResolvedValue({ removed: 4 }),
    }
    const mockContainer = {
      resolve: jest.fn((name: string) => {
        if (name === 'em') return mockEm
        if (name === 'progressService') return { progress: true }
        if (name === 'fulltextIndexQueue') return mockQueue
        throw new Error(`Unknown service: ${name}`)
      }),
      dispose: jest.fn().mockResolvedValue(undefined),
    }
    mockCreateRequestContainer.mockResolvedValue(mockContainer)

    const res = await fulltextReindexCancelPost(new Request('http://localhost/api/search/reindex/cancel', {
      method: 'POST',
    }))
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.error).toBe('Scoped queue cancellation is not available.')
    expect(mockQueue.clear).not.toHaveBeenCalled()
    expect(mockClearReindexLock).not.toHaveBeenCalled()
    expect(mockCancelReindexProgress).not.toHaveBeenCalled()
    expect(mockContainer.dispose).toHaveBeenCalled()
  })
})
