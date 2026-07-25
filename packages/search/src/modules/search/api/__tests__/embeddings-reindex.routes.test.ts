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

jest.mock('../../lib/embedding-config', () => ({
  resolveEmbeddingConfig: jest.fn().mockResolvedValue(null),
}))

const mockRecordIndexerLog = jest.fn().mockResolvedValue(undefined)
jest.mock('@open-mercato/shared/lib/indexers/status-log', () => ({
  recordIndexerLog: (...args: unknown[]) => mockRecordIndexerLog(...args),
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

import { POST as vectorReindexPost } from '../embeddings/reindex/route'
import { POST as vectorReindexCancelPost } from '../embeddings/reindex/cancel/route'

describe('POST /api/search/embeddings/reindex', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetReindexLockStatus.mockResolvedValue(null)
    mockAcquireReindexLock.mockResolvedValue({ acquired: true })
  })

  test('finishes progress and clears the lock when no vector jobs are queued', async () => {
    mockGetAuthFromRequest.mockResolvedValue({
      tenantId: 'tenant-123',
      orgId: 'org-456',
      sub: 'user-789',
    })

    const mockDb = { db: true }
    const mockEm = { getKysely: jest.fn(() => mockDb) }
    const mockProgressService = { progress: true }
    const mockSearchIndexer = {
      reindexEntityToVector: jest.fn().mockResolvedValue({
        success: true,
        entitiesProcessed: 1,
        recordsIndexed: 0,
        recordsDropped: 0,
        jobsEnqueued: 0,
        errors: [],
      }),
    }
    const mockContainer = {
      resolve: jest.fn((name: string) => {
        if (name === 'em') return mockEm
        if (name === 'progressService') return mockProgressService
        if (name === 'searchIndexer') return mockSearchIndexer
        throw new Error(`Unknown service: ${name}`)
      }),
      dispose: jest.fn().mockResolvedValue(undefined),
    }
    mockCreateRequestContainer.mockResolvedValue(mockContainer)

    const req = new Request('http://localhost/api/search/embeddings/reindex', {
      method: 'POST',
      body: JSON.stringify({ entityId: 'catalog:catalog_product_variant' }),
    })

    const res = await vectorReindexPost(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual(expect.objectContaining({
      ok: true,
      recordsIndexed: 0,
      jobsEnqueued: 0,
      entitiesProcessed: 1,
    }))
    expect(mockSearchIndexer.reindexEntityToVector).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: 'catalog:catalog_product_variant',
        tenantId: 'tenant-123',
        organizationId: 'org-456',
        useQueue: true,
      }),
    )
    expect(mockEnsureReindexProgressJob).toHaveBeenCalledWith(
      expect.objectContaining({
        totalCount: 0,
        tenantId: 'tenant-123',
        organizationId: 'org-456',
      }),
    )
    expect(mockCompleteReindexProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-123',
        organizationId: 'org-456',
        resultSummary: expect.objectContaining({
          entitiesProcessed: 1,
          recordsIndexed: 0,
          jobsEnqueued: 0,
          errors: 0,
        }),
      }),
    )
    expect(mockFailReindexProgress).not.toHaveBeenCalled()
    expect(mockClearReindexLock).toHaveBeenCalledWith(mockDb, 'tenant-123', 'vector', 'org-456')
    expect(mockContainer.dispose).toHaveBeenCalled()
  })

  test('cancel removes only current tenant and organization vector queue jobs', async () => {
    mockGetAuthFromRequest.mockResolvedValue({
      tenantId: 'tenant-123',
      orgId: 'org-456',
      sub: 'user-789',
    })

    const mockDb = { db: true }
    const mockEm = { getKysely: jest.fn(() => mockDb) }
    const mockProgressService = { progress: true }
    const mockQueue = {
      getJobCounts: jest.fn().mockResolvedValue({ waiting: 3, active: 1, completed: 0, failed: 0 }),
      clear: jest.fn().mockResolvedValue({ removed: 4 }),
      removeQueuedJobsByScope: jest.fn().mockResolvedValue({ removed: 2 }),
    }
    const mockContainer = {
      resolve: jest.fn((name: string) => {
        if (name === 'em') return mockEm
        if (name === 'progressService') return mockProgressService
        if (name === 'vectorIndexQueue') return mockQueue
        throw new Error(`Unknown service: ${name}`)
      }),
      dispose: jest.fn().mockResolvedValue(undefined),
    }
    mockCreateRequestContainer.mockResolvedValue(mockContainer)

    const res = await vectorReindexCancelPost(new Request(
      'http://localhost/api/search/embeddings/reindex/cancel',
      { method: 'POST' },
    ))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true, jobsRemoved: 2 })
    expect(mockQueue.removeQueuedJobsByScope).toHaveBeenCalledWith({
      tenantId: 'tenant-123',
      organizationId: 'org-456',
      jobTypes: ['batch-index'],
    })
    expect(mockQueue.clear).not.toHaveBeenCalled()
    expect(mockClearReindexLock).toHaveBeenCalledWith(mockDb, 'tenant-123', 'vector', 'org-456')
    expect(mockCancelReindexProgress).toHaveBeenCalledWith(expect.objectContaining({
      em: mockEm,
      progressService: mockProgressService,
      type: 'vector',
      tenantId: 'tenant-123',
      organizationId: 'org-456',
      userId: 'user-789',
    }))
    expect(mockRecordIndexerLog).toHaveBeenCalledWith(
      { em: mockEm },
      expect.objectContaining({
        source: 'vector',
        details: { jobsRemoved: 2 },
        tenantId: 'tenant-123',
        organizationId: 'org-456',
      }),
    )
    expect(mockContainer.dispose).toHaveBeenCalled()
  })

  test('cancel fails closed when scoped vector queue removal fails', async () => {
    mockGetAuthFromRequest.mockResolvedValue({
      tenantId: 'tenant-123',
      orgId: 'org-456',
      sub: 'user-789',
    })

    const mockDb = { db: true }
    const mockEm = { getKysely: jest.fn(() => mockDb) }
    const mockQueue = {
      clear: jest.fn().mockResolvedValue({ removed: 4 }),
      removeQueuedJobsByScope: jest.fn().mockRejectedValue(new Error('redis unavailable')),
    }
    const mockContainer = {
      resolve: jest.fn((name: string) => {
        if (name === 'em') return mockEm
        if (name === 'progressService') return { progress: true }
        if (name === 'vectorIndexQueue') return mockQueue
        throw new Error(`Unknown service: ${name}`)
      }),
      dispose: jest.fn().mockResolvedValue(undefined),
    }
    mockCreateRequestContainer.mockResolvedValue(mockContainer)

    const res = await vectorReindexCancelPost(new Request(
      'http://localhost/api/search/embeddings/reindex/cancel',
      { method: 'POST' },
    ))
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.error).toBe('Failed to cancel queued reindex jobs.')
    expect(mockQueue.removeQueuedJobsByScope).toHaveBeenCalledWith({
      tenantId: 'tenant-123',
      organizationId: 'org-456',
      jobTypes: ['batch-index'],
    })
    expect(mockQueue.clear).not.toHaveBeenCalled()
    expect(mockClearReindexLock).not.toHaveBeenCalled()
    expect(mockCancelReindexProgress).not.toHaveBeenCalled()
    expect(mockContainer.dispose).toHaveBeenCalled()
  })
})
