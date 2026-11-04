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
jest.mock('../../lib/reindex-lock', () => ({
  getReindexLockStatus: (...args: unknown[]) => mockGetReindexLockStatus(...args),
  acquireReindexLock: (...args: unknown[]) => mockAcquireReindexLock(...args),
  clearReindexLock: (...args: unknown[]) => mockClearReindexLock(...args),
}))

const mockEnsureReindexProgressJob = jest.fn().mockResolvedValue('progress-1')
const mockCompleteReindexProgress = jest.fn().mockResolvedValue(undefined)
const mockFailReindexProgress = jest.fn().mockResolvedValue(undefined)
const mockCancelReindexProgress = jest.fn().mockResolvedValue(undefined)
jest.mock('../../lib/reindex-progress', () => ({
  ensureReindexProgressJob: (...args: unknown[]) => mockEnsureReindexProgressJob(...args),
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
  })

  test('clears the fulltext lock when no indexable strategy is configured', async () => {
    const mockDb = { db: true }
    const mockEm = { getKysely: jest.fn(() => mockDb) }
    const mockContainer = {
      resolve: jest.fn((name: string) => {
        if (name === 'em') return mockEm
        if (name === 'progressService') return { progress: true }
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
        if (name === 'progressService') return { progress: true }
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
    expect(mockEnsureReindexProgressJob).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'fulltext',
        tenantId: 'tenant-123',
        organizationId: 'org-456',
        totalCount: 0,
      }),
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
        if (name === 'progressService') return { progress: true }
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
