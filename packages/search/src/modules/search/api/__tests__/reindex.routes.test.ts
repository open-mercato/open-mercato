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
jest.mock('../../lib/reindex-progress', () => ({
  ensureReindexProgressJob: (...args: unknown[]) => mockEnsureReindexProgressJob(...args),
  completeReindexProgress: (...args: unknown[]) => mockCompleteReindexProgress(...args),
  failReindexProgress: (...args: unknown[]) => mockFailReindexProgress(...args),
}))

import { POST as fulltextReindexPost } from '../reindex/route'

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
})
