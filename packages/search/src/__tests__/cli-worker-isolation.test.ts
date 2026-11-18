import type { JobContext, JobHandler, QueuedJob } from '@open-mercato/queue'
import type { VectorIndexJobPayload } from '../queue/vector-indexing'

const mockCreateContainer = jest.fn()
const mockRunWorker = jest.fn()
const mockHandleVectorJob = jest.fn()
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: () => mockCreateContainer() }))
jest.mock('@open-mercato/shared/lib/redis/connection', () => ({ getRedisUrlOrThrow: () => 'redis://localhost:6379' }))
jest.mock('@open-mercato/core/modules/query_index/lib/reindexer', () => ({ reindexEntity: jest.fn(), DEFAULT_REINDEX_PARTITIONS: 1 }))
jest.mock('@open-mercato/queue/worker', () => ({ runWorker: (...args: unknown[]) => mockRunWorker(...args) }))
jest.mock('../modules/search/workers/vector-index.worker', () => ({ handleVectorIndexJob: (...args: unknown[]) => mockHandleVectorJob(...args) }))

import commands from '../modules/search/cli'
import { VECTOR_INDEXING_QUEUE_NAME } from '../queue/vector-indexing'

describe('legacy vector CLI worker isolation', () => {
  const originalQueueStrategy = process.env.QUEUE_STRATEGY

  beforeEach(() => {
    jest.resetAllMocks()
    process.env.QUEUE_STRATEGY = 'async'
  })

  afterAll(() => {
    if (originalQueueStrategy === undefined) delete process.env.QUEUE_STRATEGY
    else process.env.QUEUE_STRATEGY = originalQueueStrategy
  })

  async function workerHandler(): Promise<JobHandler<VectorIndexJobPayload>> {
    const command = commands.find((entry) => entry.command === 'worker')
    if (!command) throw new Error('[internal] Missing worker command')
    await command.run([VECTOR_INDEXING_QUEUE_NAME, '--concurrency=2'])
    return mockRunWorker.mock.calls[0][0].handler
  }

  it('uses separate containers for overlapping tenants and disposes both', async () => {
    const first = { resolve: jest.fn(), dispose: jest.fn() }
    const second = { resolve: jest.fn(), dispose: jest.fn() }
    mockCreateContainer.mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    let releaseFirst: (() => void) | undefined
    mockHandleVectorJob.mockImplementationOnce(() => new Promise<void>((resolve) => { releaseFirst = resolve }))
    const handler = await workerHandler()
    const context = { jobId: 'job', attempt: 1 } as JobContext
    const firstJob = handler({ payload: { tenantId: 'tenant-a' } } as QueuedJob<VectorIndexJobPayload>, context)
    await Promise.resolve()
    try {
      await handler({ payload: { tenantId: 'tenant-b' } } as QueuedJob<VectorIndexJobPayload>, context)
      mockHandleVectorJob.mock.calls[0][2].resolve('vectorEmbeddingService')
      mockHandleVectorJob.mock.calls[1][2].resolve('vectorEmbeddingService')
      expect(first.resolve).toHaveBeenCalledWith('vectorEmbeddingService')
      expect(second.resolve).toHaveBeenCalledWith('vectorEmbeddingService')
      expect(second.dispose).toHaveBeenCalledTimes(1)
      expect(first.dispose).not.toHaveBeenCalled()
    } finally {
      releaseFirst?.()
      await firstJob
    }
    expect(first.dispose).toHaveBeenCalledTimes(1)
  })

  it('disposes the job container on failure', async () => {
    const container = { resolve: jest.fn(), dispose: jest.fn() }
    const failure = new Error('[internal] Indexing failed')
    mockCreateContainer.mockResolvedValue(container)
    mockHandleVectorJob.mockRejectedValue(failure)
    const handler = await workerHandler()
    await expect(handler({ payload: { tenantId: 'tenant-a' } } as QueuedJob<VectorIndexJobPayload>, {} as JobContext)).rejects.toBe(failure)
    expect(container.dispose).toHaveBeenCalledTimes(1)
  })
})
