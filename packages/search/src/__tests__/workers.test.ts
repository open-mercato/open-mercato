import { QueuedJob, JobContext } from '@open-mercato/queue'
import { VectorIndexJobPayload } from '../queue/vector-indexing'
import { MeilisearchIndexJobPayload } from '../queue/meilisearch-indexing'

type HandlerContext = { resolve: <T = unknown>(name: string) => T }

// Mock dependencies before importing workers
jest.mock('@/lib/indexers/error-log', () => ({
  recordIndexerError: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@open-mercato/core/modules/query_index/lib/coverage', () => ({
  applyCoverageAdjustments: jest.fn().mockResolvedValue(undefined),
  createCoverageAdjustments: jest.fn().mockReturnValue([]),
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

import { handleVectorIndexJob } from '../modules/search/workers/vector-index.worker'
import { handleMeilisearchIndexJob } from '../modules/search/workers/meilisearch-index.worker'

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

  const mockContainer: HandlerContext = {
    resolve: jest.fn((name: string) => {
      if (name === 'searchIndexer') return mockSearchIndexer
      if (name === 'em') return null
      if (name === 'eventBus') return null
      if (name === 'vectorEmbeddingService') return { updateConfig: jest.fn() }
      throw new Error(`Unknown service: ${name}`)
    }) as HandlerContext['resolve'],
  }

  beforeEach(() => {
    jest.clearAllMocks()
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
})

describe('Meilisearch Index Worker', () => {
  const mockMeilisearchStrategy = {
    id: 'meilisearch',
    isAvailable: jest.fn().mockResolvedValue(true),
    bulkIndex: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    purge: jest.fn().mockResolvedValue(undefined),
  }

  const mockContainer: HandlerContext = {
    resolve: jest.fn((name: string) => {
      if (name === 'searchStrategies') {
        return [mockMeilisearchStrategy]
      }
      throw new Error(`Unknown service: ${name}`)
    }) as HandlerContext['resolve'],
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should skip job with missing tenantId', async () => {
    const job = createMockJob<MeilisearchIndexJobPayload>({
      jobType: 'batch-index',
      tenantId: '',
      records: [],
    })
    const ctx = createMockJobContext()

    await handleMeilisearchIndexJob(job, ctx, mockContainer)

    expect(mockMeilisearchStrategy.bulkIndex).not.toHaveBeenCalled()
  })

  it('should bulk index records when jobType is batch-index', async () => {
    const records = [
      { entityId: 'test:entity', recordId: 'rec-1', tenantId: 'tenant-123', fields: { name: 'Test 1' } },
      { entityId: 'test:entity', recordId: 'rec-2', tenantId: 'tenant-123', fields: { name: 'Test 2' } },
    ]
    const job = createMockJob<MeilisearchIndexJobPayload>({
      jobType: 'batch-index',
      tenantId: 'tenant-123',
      records,
    })
    const ctx = createMockJobContext()

    await handleMeilisearchIndexJob(job, ctx, mockContainer)

    expect(mockMeilisearchStrategy.bulkIndex).toHaveBeenCalledWith(records)
  })

  it('should skip batch-index with empty records', async () => {
    const job = createMockJob<MeilisearchIndexJobPayload>({
      jobType: 'batch-index',
      tenantId: 'tenant-123',
      records: [],
    })
    const ctx = createMockJobContext()

    await handleMeilisearchIndexJob(job, ctx, mockContainer)

    expect(mockMeilisearchStrategy.bulkIndex).not.toHaveBeenCalled()
  })

  it('should delete record when jobType is delete', async () => {
    const job = createMockJob<MeilisearchIndexJobPayload>({
      jobType: 'delete',
      tenantId: 'tenant-123',
      entityId: 'test:entity',
      recordId: 'rec-123',
    })
    const ctx = createMockJobContext()

    await handleMeilisearchIndexJob(job, ctx, mockContainer)

    expect(mockMeilisearchStrategy.delete).toHaveBeenCalledWith('test:entity', 'rec-123', 'tenant-123')
  })

  it('should purge entity when jobType is purge', async () => {
    const job = createMockJob<MeilisearchIndexJobPayload>({
      jobType: 'purge',
      tenantId: 'tenant-123',
      entityId: 'test:entity',
    })
    const ctx = createMockJobContext()

    await handleMeilisearchIndexJob(job, ctx, mockContainer)

    expect(mockMeilisearchStrategy.purge).toHaveBeenCalledWith('test:entity', 'tenant-123')
  })

  it('should skip when Meilisearch strategy not configured', async () => {
    const containerWithoutStrategy: HandlerContext = {
      resolve: jest.fn(() => []) as HandlerContext['resolve'],
    }
    const job = createMockJob<MeilisearchIndexJobPayload>({
      jobType: 'batch-index',
      tenantId: 'tenant-123',
      records: [{ entityId: 'test', recordId: '1', tenantId: 'tenant-123', fields: {} }],
    })
    const ctx = createMockJobContext()

    await handleMeilisearchIndexJob(job, ctx, containerWithoutStrategy)

    expect(mockMeilisearchStrategy.bulkIndex).not.toHaveBeenCalled()
  })

  it('should throw when Meilisearch is not available', async () => {
    mockMeilisearchStrategy.isAvailable.mockResolvedValueOnce(false)
    const job = createMockJob<MeilisearchIndexJobPayload>({
      jobType: 'batch-index',
      tenantId: 'tenant-123',
      records: [{ entityId: 'test', recordId: '1', tenantId: 'tenant-123', fields: {} }],
    })
    const ctx = createMockJobContext()

    await expect(handleMeilisearchIndexJob(job, ctx, mockContainer)).rejects.toThrow(
      'Meilisearch is not available'
    )
  })
})
