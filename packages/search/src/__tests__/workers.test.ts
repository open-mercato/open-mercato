import { QueuedJob, JobContext } from '@open-mercato/queue'
import { VectorIndexJobPayload } from '../queue/vector-indexing'
import { FulltextIndexJobPayload } from '../queue/fulltext-indexing'

type HandlerContext = { resolve: <T = unknown>(name: string) => T }

// Mock dependencies before importing workers
jest.mock('@open-mercato/shared/lib/indexers/error-log', () => ({
  recordIndexerError: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@open-mercato/shared/lib/indexers/status-log', () => ({
  recordIndexerLog: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@open-mercato/core/modules/query_index/lib/coverage', () => ({
  refreshCoverageSnapshot: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../vector/lib/vector-logs', () => ({
  logVectorOperation: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../modules/search/lib/auto-indexing', () => ({
  resolveAutoIndexingEnabled: jest.fn().mockResolvedValue(true),
}))

jest.mock('../modules/search/lib/embedding-config', () => ({
  resolveEmbeddingConfig: jest.fn().mockResolvedValue(null),
}))

jest.mock('../modules/search/lib/reindex-lock', () => ({
  updateReindexProgress: jest.fn().mockResolvedValue(undefined),
  clearReindexLock: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../modules/search/lib/reindex-progress', () => ({
  hasActiveReindexProgress: jest.fn().mockResolvedValue(true),
  incrementReindexProgress: jest.fn().mockResolvedValue(true),
}))

import { handleVectorIndexJob } from '../modules/search/workers/vector-index.worker'
import { handleFulltextIndexJob } from '../modules/search/workers/fulltext-index.worker'
import { updateReindexProgress, clearReindexLock } from '../modules/search/lib/reindex-lock'
import { hasActiveReindexProgress, incrementReindexProgress } from '../modules/search/lib/reindex-progress'
import { refreshCoverageSnapshot } from '@open-mercato/core/modules/query_index/lib/coverage'

/**
 * Create a mock job context
 */
function createMockJobContext(overrides: Partial<JobContext> = {}): JobContext {
  return {
    jobId: 'job-123',
    attemptNumber: 1,
    queueName: 'test-queue',
    ...overrides,
  }
}

/**
 * Create a mock queued job
 */
function createMockJob<T>(payload: T): QueuedJob<T> {
  return {
    id: 'job-123',
    payload,
    createdAt: new Date().toISOString(),
  }
}

describe('Vector Index Worker', () => {
  const mockSearchIndexer = {
    indexRecordById: jest.fn().mockResolvedValue({ action: 'indexed', created: true }),
    deleteRecord: jest.fn().mockResolvedValue({ action: 'deleted', existed: true }),
  }

  // Configurable embedding/preflight surface — defaults to a healthy provider.
  const mockEmbeddingService: {
    updateConfig: jest.Mock
    available: boolean
    dimension: number
    createEmbedding: jest.Mock
  } = {
    updateConfig: jest.fn(),
    available: true,
    dimension: 1536,
    createEmbedding: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  }
  let mockTableDimension: number | null = null
  const mockPgvectorDriver = {
    id: 'pgvector',
    getTableDimension: jest.fn(async () => mockTableDimension),
  }

  const mockContainer: HandlerContext = {
    resolve: jest.fn((name: string) => {
      if (name === 'searchIndexer') return mockSearchIndexer
      if (name === 'em') return null
      if (name === 'eventBus') return null
      if (name === 'vectorEmbeddingService') return mockEmbeddingService
      if (name === 'vectorDrivers') return [mockPgvectorDriver]
      throw new Error(`Unknown service: ${name}`)
    }) as HandlerContext['resolve'],
  }

  beforeEach(() => {
    jest.clearAllMocks()
    ;(hasActiveReindexProgress as jest.Mock).mockResolvedValue(true)
    mockEmbeddingService.available = true
    mockEmbeddingService.dimension = 1536
    mockEmbeddingService.createEmbedding.mockResolvedValue([0.1, 0.2, 0.3])
    mockTableDimension = null
  })

  it('should skip job with missing required fields', async () => {
    const job = createMockJob<VectorIndexJobPayload>({
      jobType: 'index',
      entityType: '',
      recordId: 'rec-123',
      tenantId: 'tenant-123',
      organizationId: null,
    })
    const ctx = createMockJobContext()

    await handleVectorIndexJob(job, ctx, mockContainer)

    expect(mockSearchIndexer.indexRecordById).not.toHaveBeenCalled()
  })

  it('should index record when jobType is index', async () => {
    const job = createMockJob<VectorIndexJobPayload>({
      jobType: 'index',
      entityType: 'customers:customer_person_profile',
      recordId: 'rec-123',
      tenantId: 'tenant-123',
      organizationId: 'org-456',
    })
    const ctx = createMockJobContext()

    await handleVectorIndexJob(job, ctx, mockContainer)

    expect(mockSearchIndexer.indexRecordById).toHaveBeenCalledWith({
      entityId: 'customers:customer_person_profile',
      recordId: 'rec-123',
      tenantId: 'tenant-123',
      organizationId: 'org-456',
    })
  })

  it('refreshes vector coverage from storage after indexing instead of incrementing it blindly', async () => {
    const mockEventBus = { emitEvent: jest.fn().mockResolvedValue(undefined) }
    const containerWithEventBus: HandlerContext = {
      resolve: jest.fn((name: string) => {
        if (name === 'searchIndexer') return mockSearchIndexer
        if (name === 'em') return null
        if (name === 'eventBus') return mockEventBus
        if (name === 'vectorEmbeddingService') return mockEmbeddingService
        if (name === 'vectorDrivers') return [mockPgvectorDriver]
        throw new Error(`Unknown service: ${name}`)
      }) as HandlerContext['resolve'],
    }
    const job = createMockJob<VectorIndexJobPayload>({
      jobType: 'index',
      entityType: 'customers:customer_person_profile',
      recordId: 'rec-123',
      tenantId: 'tenant-123',
      organizationId: 'org-456',
    })

    await handleVectorIndexJob(job, createMockJobContext(), containerWithEventBus)

    expect(mockSearchIndexer.indexRecordById).toHaveBeenCalledTimes(1)
    expect(mockEventBus.emitEvent).toHaveBeenCalledWith('query_index.coverage.refresh', {
      entityType: 'customers:customer_person_profile',
      tenantId: 'tenant-123',
      organizationId: 'org-456',
      withDeleted: false,
      delayMs: 1000,
    })
    expect(refreshCoverageSnapshot).not.toHaveBeenCalled()
  })

  it('should delete record when jobType is delete', async () => {
    const job = createMockJob<VectorIndexJobPayload>({
      jobType: 'delete',
      entityType: 'customers:customer_person_profile',
      recordId: 'rec-123',
      tenantId: 'tenant-123',
      organizationId: null,
    })
    const ctx = createMockJobContext()

    await handleVectorIndexJob(job, ctx, mockContainer)

    expect(mockSearchIndexer.deleteRecord).toHaveBeenCalledWith({
      entityId: 'customers:customer_person_profile',
      recordId: 'rec-123',
      tenantId: 'tenant-123',
    })
  })

  it('should skip when vectorIndexService is not available', async () => {
    const containerWithoutService: HandlerContext = {
      resolve: jest.fn(() => {
        throw new Error('Service not available')
      }) as HandlerContext['resolve'],
    }
    const job = createMockJob<VectorIndexJobPayload>({
      jobType: 'index',
      entityType: 'test:entity',
      recordId: 'rec-123',
      tenantId: 'tenant-123',
      organizationId: null,
    })
    const ctx = createMockJobContext()

    // Should not throw
    await handleVectorIndexJob(job, ctx, containerWithoutService)
  })

  it('should skip a batch with one warning when the dimension mismatches (no per-record indexing)', async () => {
    mockTableDimension = 768
    mockEmbeddingService.dimension = 1536
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const job = createMockJob<VectorIndexJobPayload>({
      jobType: 'batch-index',
      tenantId: 'tenant-123',
      organizationId: 'org-456',
      records: [
        { entityId: 'test:entity', recordId: 'rec-1' },
        { entityId: 'test:entity', recordId: 'rec-2' },
      ],
    })

    await handleVectorIndexJob(job, createMockJobContext(), mockContainer)

    expect(mockSearchIndexer.indexRecordById).not.toHaveBeenCalled()
    expect(mockEmbeddingService.createEmbedding).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(String(warnSpy.mock.calls[0][0])).toContain('Skipping vector batch')
    warnSpy.mockRestore()
  })

  it('should skip a batch with one warning when the provider probe is unreachable', async () => {
    mockTableDimension = 1536
    mockEmbeddingService.dimension = 1536
    mockEmbeddingService.createEmbedding.mockRejectedValueOnce(
      new Error('fetch failed. Check OLLAMA_BASE_URL.'),
    )
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const job = createMockJob<VectorIndexJobPayload>({
      jobType: 'batch-index',
      tenantId: 'tenant-123',
      organizationId: null,
      records: [{ entityId: 'test:entity', recordId: 'rec-1' }],
    })

    await handleVectorIndexJob(job, createMockJobContext(), mockContainer)

    expect(mockSearchIndexer.indexRecordById).not.toHaveBeenCalled()
    expect(mockEmbeddingService.createEmbedding).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(String(warnSpy.mock.calls[0][0])).toContain('Skipping vector batch')
    warnSpy.mockRestore()
  })

  it('should still advance reindex progress/lock when a batch is skipped (no stuck run)', async () => {
    mockTableDimension = 768
    mockEmbeddingService.dimension = 1536
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const mockDb = { kysely: true }
    const containerWithProgress: HandlerContext = {
      resolve: jest.fn((name: string) => {
        if (name === 'searchIndexer') return mockSearchIndexer
        if (name === 'em') return { getKysely: () => mockDb }
        if (name === 'progressService') return { id: 'progress' }
        if (name === 'vectorEmbeddingService') return mockEmbeddingService
        if (name === 'vectorDrivers') return [mockPgvectorDriver]
        throw new Error(`Unknown service: ${name}`)
      }) as HandlerContext['resolve'],
    }
    const job = createMockJob<VectorIndexJobPayload>({
      jobType: 'batch-index',
      tenantId: 'tenant-123',
      organizationId: 'org-456',
      records: [
        { entityId: 'test:entity', recordId: 'rec-1' },
        { entityId: 'test:entity', recordId: 'rec-2' },
      ],
    })

    await handleVectorIndexJob(job, createMockJobContext(), containerWithProgress)

    expect(mockSearchIndexer.indexRecordById).not.toHaveBeenCalled()
    // Skipped records are counted as processed so the reindex run still completes.
    expect(updateReindexProgress).toHaveBeenCalledWith(mockDb, 'tenant-123', 'vector', 2, 'org-456')
    expect(incrementReindexProgress).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'vector', tenantId: 'tenant-123', delta: 2 }),
    )
    expect(clearReindexLock).toHaveBeenCalledWith(mockDb, 'tenant-123', 'vector', 'org-456')
    warnSpy.mockRestore()
  })

  it('counts handled-but-skipped batch records as processed so progress can complete', async () => {
    mockSearchIndexer.indexRecordById
      .mockResolvedValueOnce({ action: 'skipped' })
      .mockResolvedValueOnce({ action: 'skipped' })
    const mockDb = { kysely: true }
    const mockBatchEm = { getKysely: () => mockDb }
    const containerWithProgress: HandlerContext = {
      resolve: jest.fn((name: string) => {
        if (name === 'searchIndexer') return mockSearchIndexer
        if (name === 'em') return mockBatchEm
        if (name === 'progressService') return { id: 'progress' }
        if (name === 'vectorEmbeddingService') return mockEmbeddingService
        if (name === 'vectorDrivers') return [mockPgvectorDriver]
        throw new Error(`Unknown service: ${name}`)
      }) as HandlerContext['resolve'],
    }
    const job = createMockJob<VectorIndexJobPayload>({
      jobType: 'batch-index',
      tenantId: 'tenant-123',
      organizationId: 'org-456',
      records: [
        { entityId: 'test:entity', recordId: 'rec-1' },
        { entityId: 'test:entity', recordId: 'rec-2' },
      ],
    })

    await handleVectorIndexJob(job, createMockJobContext(), containerWithProgress)

    expect(mockSearchIndexer.indexRecordById).toHaveBeenCalledTimes(2)
    expect(updateReindexProgress).toHaveBeenCalledWith(mockDb, 'tenant-123', 'vector', 2, 'org-456')
    expect(incrementReindexProgress).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'vector', tenantId: 'tenant-123', delta: 2 }),
    )
    expect(clearReindexLock).toHaveBeenCalledWith(mockDb, 'tenant-123', 'vector', 'org-456')
    expect(refreshCoverageSnapshot).toHaveBeenCalledWith(mockBatchEm, expect.objectContaining({
      entityType: 'test:entity',
      tenantId: 'tenant-123',
      organizationId: 'org-456',
    }))
  })

  it('clears an orphaned reindex lock instead of recreating it when no progress job is active', async () => {
    ;(hasActiveReindexProgress as jest.Mock).mockResolvedValueOnce(false)
    const mockDb = { kysely: true }
    const containerWithProgress: HandlerContext = {
      resolve: jest.fn((name: string) => {
        if (name === 'searchIndexer') return mockSearchIndexer
        if (name === 'em') return { getKysely: () => mockDb }
        if (name === 'progressService') return { id: 'progress' }
        if (name === 'vectorEmbeddingService') return mockEmbeddingService
        if (name === 'vectorDrivers') return [mockPgvectorDriver]
        throw new Error(`Unknown service: ${name}`)
      }) as HandlerContext['resolve'],
    }
    const job = createMockJob<VectorIndexJobPayload>({
      jobType: 'batch-index',
      tenantId: 'tenant-123',
      organizationId: 'org-456',
      records: [{ entityId: 'test:entity', recordId: 'rec-1' }],
    })

    await handleVectorIndexJob(job, createMockJobContext(), containerWithProgress)

    expect(mockSearchIndexer.indexRecordById).toHaveBeenCalledTimes(1)
    expect(updateReindexProgress).not.toHaveBeenCalled()
    expect(incrementReindexProgress).not.toHaveBeenCalled()
    expect(clearReindexLock).toHaveBeenCalledWith(mockDb, 'tenant-123', 'vector', 'org-456')
  })

  it('should skip a single-record index on dimension mismatch without indexing or embedding', async () => {
    mockTableDimension = 768
    mockEmbeddingService.dimension = 1536
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const job = createMockJob<VectorIndexJobPayload>({
      jobType: 'index',
      entityType: 'customers:customer_person_profile',
      recordId: 'rec-123',
      tenantId: 'tenant-123',
      organizationId: 'org-456',
    })

    await handleVectorIndexJob(job, createMockJobContext(), mockContainer)

    expect(mockSearchIndexer.indexRecordById).not.toHaveBeenCalled()
    expect(mockEmbeddingService.createEmbedding).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledTimes(1)
    warnSpy.mockRestore()
  })

  it('should still delete a record even when the provider is misconfigured', async () => {
    mockEmbeddingService.available = false
    const job = createMockJob<VectorIndexJobPayload>({
      jobType: 'delete',
      entityType: 'customers:customer_person_profile',
      recordId: 'rec-123',
      tenantId: 'tenant-123',
      organizationId: null,
    })

    await handleVectorIndexJob(job, createMockJobContext(), mockContainer)

    expect(mockSearchIndexer.deleteRecord).toHaveBeenCalled()
  })
})

describe('Fulltext Index Worker', () => {
  const mockFulltextStrategy = {
    id: 'fulltext',
    isAvailable: jest.fn().mockResolvedValue(true),
    bulkIndex: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    purge: jest.fn().mockResolvedValue(undefined),
  }

  // Mock Kysely query builder for batch-index tests
  const createKyselyChain = () => {
    const chain: any = {
      set: jest.fn(() => chain),
      where: jest.fn(() => chain),
      values: jest.fn(() => chain),
      select: jest.fn(() => chain),
      selectAll: jest.fn(() => chain),
      from: jest.fn(() => chain),
      execute: jest.fn().mockResolvedValue([]),
      executeTakeFirst: jest.fn().mockResolvedValue(undefined),
    }
    return chain
  }
  const mockDb = {
    selectFrom: jest.fn(() => createKyselyChain()),
    updateTable: jest.fn(() => createKyselyChain()),
    insertInto: jest.fn(() => createKyselyChain()),
    deleteFrom: jest.fn(() => createKyselyChain()),
  }

  const mockSearchIndexer = {
    getEntityConfig: jest.fn().mockReturnValue(null),
    indexRecordById: jest.fn().mockResolvedValue({ action: 'indexed', created: true }),
  }

  const mockEm = {
    getKysely: jest.fn().mockReturnValue(mockDb),
  }

  const mockContainer: HandlerContext = {
    resolve: jest.fn((name: string) => {
      if (name === 'searchStrategies') return [mockFulltextStrategy]
      if (name === 'em') return mockEm
      if (name === 'searchIndexer') return mockSearchIndexer
      throw new Error(`Unknown service: ${name}`)
    }) as HandlerContext['resolve'],
  }

  beforeEach(() => {
    jest.clearAllMocks()
    ;(hasActiveReindexProgress as jest.Mock).mockResolvedValue(true)
    mockFulltextStrategy.isAvailable.mockResolvedValue(true)
    mockSearchIndexer.indexRecordById.mockResolvedValue({ action: 'indexed', created: true })
  })

  it('should skip job with missing tenantId', async () => {
    const job = createMockJob<FulltextIndexJobPayload>({
      jobType: 'batch-index',
      tenantId: '',
      records: [],
    })
    const ctx = createMockJobContext()

    await handleFulltextIndexJob(job, ctx, mockContainer)

    expect(mockFulltextStrategy.bulkIndex).not.toHaveBeenCalled()
  })

  it('should index records via searchIndexer when jobType is batch-index', async () => {
    // Use minimal record format (just entityId + recordId)
    const records = [
      { entityId: 'test:entity', recordId: 'rec-1' },
      { entityId: 'test:entity', recordId: 'rec-2' },
    ]
    const job = createMockJob<FulltextIndexJobPayload>({
      jobType: 'batch-index',
      tenantId: 'tenant-123',
      records,
    })
    const ctx = createMockJobContext()

    await handleFulltextIndexJob(job, ctx, mockContainer)

    // Verify indexRecordById was called for each record
    expect(mockSearchIndexer.indexRecordById).toHaveBeenCalledTimes(2)
    expect(mockSearchIndexer.indexRecordById).toHaveBeenCalledWith({
      entityId: 'test:entity',
      recordId: 'rec-1',
      tenantId: 'tenant-123',
      organizationId: undefined,
    })
    expect(mockSearchIndexer.indexRecordById).toHaveBeenCalledWith({
      entityId: 'test:entity',
      recordId: 'rec-2',
      tenantId: 'tenant-123',
      organizationId: undefined,
    })
  })

  it('counts handled fulltext batch records as processed so progress can complete', async () => {
    mockSearchIndexer.indexRecordById
      .mockResolvedValueOnce({ action: 'skipped' })
      .mockResolvedValueOnce({ action: 'skipped' })
    const records = [
      { entityId: 'test:entity', recordId: 'rec-1' },
      { entityId: 'test:entity', recordId: 'rec-2' },
    ]
    const containerWithProgress: HandlerContext = {
      resolve: jest.fn((name: string) => {
        if (name === 'searchStrategies') return [mockFulltextStrategy]
        if (name === 'em') return mockEm
        if (name === 'searchIndexer') return mockSearchIndexer
        if (name === 'progressService') return { id: 'progress' }
        throw new Error(`Unknown service: ${name}`)
      }) as HandlerContext['resolve'],
    }
    const job = createMockJob<FulltextIndexJobPayload>({
      jobType: 'batch-index',
      tenantId: 'tenant-123',
      organizationId: 'org-456',
      records,
    })

    await handleFulltextIndexJob(job, createMockJobContext(), containerWithProgress)

    expect(mockSearchIndexer.indexRecordById).toHaveBeenCalledTimes(2)
    expect(updateReindexProgress).toHaveBeenCalledWith(mockDb, 'tenant-123', 'fulltext', 2, 'org-456')
    expect(incrementReindexProgress).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'fulltext', tenantId: 'tenant-123', delta: 2 }),
    )
    expect(clearReindexLock).toHaveBeenCalledWith(mockDb, 'tenant-123', 'fulltext', 'org-456')
  })

  it('clears an orphaned fulltext reindex lock instead of recreating it when no progress job is active', async () => {
    ;(hasActiveReindexProgress as jest.Mock).mockResolvedValueOnce(false)
    const records = [{ entityId: 'test:entity', recordId: 'rec-1' }]
    const containerWithProgress: HandlerContext = {
      resolve: jest.fn((name: string) => {
        if (name === 'searchStrategies') return [mockFulltextStrategy]
        if (name === 'em') return mockEm
        if (name === 'searchIndexer') return mockSearchIndexer
        if (name === 'progressService') return { id: 'progress' }
        throw new Error(`Unknown service: ${name}`)
      }) as HandlerContext['resolve'],
    }
    const job = createMockJob<FulltextIndexJobPayload>({
      jobType: 'batch-index',
      tenantId: 'tenant-123',
      organizationId: 'org-456',
      records,
    })

    await handleFulltextIndexJob(job, createMockJobContext(), containerWithProgress)

    expect(mockSearchIndexer.indexRecordById).toHaveBeenCalledTimes(1)
    expect(updateReindexProgress).not.toHaveBeenCalled()
    expect(incrementReindexProgress).not.toHaveBeenCalled()
    expect(clearReindexLock).toHaveBeenCalledWith(mockDb, 'tenant-123', 'fulltext', 'org-456')
  })

  it('should skip batch-index with empty records', async () => {
    const job = createMockJob<FulltextIndexJobPayload>({
      jobType: 'batch-index',
      tenantId: 'tenant-123',
      records: [],
    })
    const ctx = createMockJobContext()

    await handleFulltextIndexJob(job, ctx, mockContainer)

    expect(mockFulltextStrategy.bulkIndex).not.toHaveBeenCalled()
  })

  it('should delete record when jobType is delete', async () => {
    const job = createMockJob<FulltextIndexJobPayload>({
      jobType: 'delete',
      tenantId: 'tenant-123',
      entityId: 'test:entity',
      recordId: 'rec-123',
    })
    const ctx = createMockJobContext()

    await handleFulltextIndexJob(job, ctx, mockContainer)

    expect(mockFulltextStrategy.delete).toHaveBeenCalledWith('test:entity', 'rec-123', 'tenant-123')
  })

  it('should purge entity when jobType is purge', async () => {
    const job = createMockJob<FulltextIndexJobPayload>({
      jobType: 'purge',
      tenantId: 'tenant-123',
      entityId: 'test:entity',
    })
    const ctx = createMockJobContext()

    await handleFulltextIndexJob(job, ctx, mockContainer)

    expect(mockFulltextStrategy.purge).toHaveBeenCalledWith('test:entity', 'tenant-123')
  })

  it('should skip when fulltext strategy not configured', async () => {
    const containerWithoutStrategy: HandlerContext = {
      resolve: jest.fn(() => []) as HandlerContext['resolve'],
    }
    const job = createMockJob<FulltextIndexJobPayload>({
      jobType: 'batch-index',
      tenantId: 'tenant-123',
      records: [{ entityId: 'test', recordId: '1' }],
    })
    const ctx = createMockJobContext()

    await handleFulltextIndexJob(job, ctx, containerWithoutStrategy)

    expect(mockFulltextStrategy.bulkIndex).not.toHaveBeenCalled()
  })

  it('should throw when fulltext search is not available', async () => {
    mockFulltextStrategy.isAvailable.mockResolvedValueOnce(false)
    const job = createMockJob<FulltextIndexJobPayload>({
      jobType: 'batch-index',
      tenantId: 'tenant-123',
      records: [{ entityId: 'test', recordId: '1' }],
    })
    const ctx = createMockJobContext()

    await expect(handleFulltextIndexJob(job, ctx, mockContainer)).rejects.toThrow(
      'Fulltext search is not available'
    )
  })
})
