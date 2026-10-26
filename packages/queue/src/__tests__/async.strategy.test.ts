import { createQueue } from '../factory'
import { getRedisUrlOrThrow } from '@open-mercato/shared/lib/redis/connection'

const queueCtor = jest.fn()
const workerCtor = jest.fn()
const queueAdd = jest.fn(async () => ({ id: 'bull-job-id' }))
const queueClose = jest.fn(async () => {})
const queueObliterate = jest.fn(async () => {})
const queueGetJobs = jest.fn(async () => [])
const queueGetJob = jest.fn(async () => undefined)
const queueGetJobCounts = jest.fn(async () => ({
  waiting: 2,
  active: 1,
  completed: 3,
  failed: 4,
  delayed: 5,
}))
const workerClose = jest.fn(async () => {})
const workerOn = jest.fn()

jest.mock('@open-mercato/shared/lib/redis/connection', () => ({
  getRedisUrlOrThrow: jest.fn(),
  parseRedisUrl: jest.requireActual('@open-mercato/shared/lib/redis/connection').parseRedisUrl,
}))

jest.mock('bullmq', () => {
  class MockQueue<T> {
    constructor(name: string, opts: unknown) {
      queueCtor(name, opts)
    }

    add = queueAdd as unknown as (name: string, data: T, opts?: unknown) => Promise<{ id?: string }>
    close = queueClose
    obliterate = queueObliterate
    getJobCounts = queueGetJobCounts
    getJobs = queueGetJobs
    getJob = queueGetJob
  }

  class MockWorker<T> {
    constructor(
      name: string,
      processor: (job: { id?: string; data: T; attemptsMade: number }) => Promise<void>,
      opts: unknown,
    ) {
      workerCtor(name, processor, opts)
    }

    on = workerOn
    close = workerClose
  }

  return {
    Queue: MockQueue,
    Worker: MockWorker,
  }
})

describe('Queue - async strategy', () => {
  const getRedisUrlOrThrowMock = getRedisUrlOrThrow as jest.MockedFunction<typeof getRedisUrlOrThrow>

  beforeEach(() => {
    jest.clearAllMocks()
    getRedisUrlOrThrowMock.mockReturnValue('rediss://default:secret@example.com:6380/1')
  })

  it('passes parsed Redis connection fields to BullMQ for env-based async config', async () => {
    const queue = createQueue<{ value: number }>('test-queue', 'async', {
      concurrency: 3,
    })

    await queue.enqueue({ value: 42 })
    await queue.process(async () => {})

    expect(queueCtor).toHaveBeenCalledWith('test-queue', {
      connection: {
        host: 'example.com',
        port: 6380,
        username: 'default',
        password: 'secret',
        db: 1,
        tls: {},
        family: undefined,
        protocol: 2,
      },
    })
    expect(workerCtor).toHaveBeenCalledWith(
      'test-queue',
      expect.any(Function),
      {
        connection: {
          host: 'example.com',
          port: 6380,
          username: 'default',
          password: 'secret',
          db: 1,
          tls: {},
          family: undefined,
          protocol: 2,
        },
        concurrency: 3,
      },
    )
  })

  it('preserves URL connection semantics when converting to BullMQ fields', async () => {
    const queue = createQueue<{ value: number }>('test-queue', 'async', {
      connection: {
        url: 'rediss://user:secret@example.com:6380/4?family=6',
      },
    })

    await queue.enqueue({ value: 42 })

    expect(queueCtor).toHaveBeenCalledWith('test-queue', {
      connection: {
        host: 'example.com',
        port: 6380,
        username: 'user',
        password: 'secret',
        db: 4,
        tls: {},
        family: 6,
        protocol: 2,
      },
    })
  })

  it('enqueues jobs with retry attempts and exponential backoff', async () => {
    const queue = createQueue<{ value: number }>('test-queue', 'async')

    await queue.enqueue({ value: 42 })

    expect(queueAdd).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ payload: { value: 42 } }),
      expect.objectContaining({
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { count: 100 },
        removeOnFail: 1000,
      }),
    )

    await queue.close()
  })

  it('threads queue retry, lock-duration and stalled-job options to BullMQ', async () => {
    const queue = createQueue<{ value: number }>('test-queue', 'async', {
      attempts: 5,
      lockDuration: 120_000,
      maxStalledCount: 10,
    })

    await queue.enqueue({ value: 42 })
    await queue.process(async () => {})

    expect(queueAdd).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ payload: { value: 42 } }),
      expect.objectContaining({ attempts: 5 }),
    )
    expect(workerCtor).toHaveBeenCalledWith(
      'test-queue',
      expect.any(Function),
      expect.objectContaining({ lockDuration: 120_000, maxStalledCount: 10 }),
    )
  })

  it('leaves BullMQ on its own lock and stall defaults when the options are unset', async () => {
    const queue = createQueue<{ value: number }>('test-queue', 'async', {})

    await queue.process(async () => {})

    const workerOptions = workerCtor.mock.calls[0]?.[2] as Record<string, unknown>
    expect(workerOptions).not.toHaveProperty('lockDuration')
    expect(workerOptions).not.toHaveProperty('maxStalledCount')
  })

  it('removeQueuedJobsByScope removes only queued jobs matching tenant scope', async () => {
    const removeMatching = jest.fn(async () => {})
    const removeAutoIndex = jest.fn(async () => {})
    const removeOtherOrg = jest.fn(async () => {})
    const removeOtherTenant = jest.fn(async () => {})
    queueGetJobs.mockResolvedValueOnce([
      {
        data: { payload: { tenantId: 'tenant-1', organizationId: 'org-1', jobType: 'batch-index', value: 1 } },
        remove: removeMatching,
      },
      {
        data: { payload: { tenantId: 'tenant-1', organizationId: 'org-1', jobType: 'index', value: 2 } },
        remove: removeAutoIndex,
      },
      {
        data: { payload: { tenantId: 'tenant-1', organizationId: 'org-2', value: 2 } },
        remove: removeOtherOrg,
      },
      {
        data: { payload: { tenantId: 'tenant-2', organizationId: 'org-1', value: 3 } },
        remove: removeOtherTenant,
      },
    ])
    const queue = createQueue<{ tenantId: string; organizationId?: string | null; value: number }>(
      'test-queue',
      'async',
    )

    const result = await queue.removeQueuedJobsByScope!({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      jobTypes: ['batch-index'],
    })

    expect(queueGetJobs).toHaveBeenCalledWith(
      ['waiting', 'delayed', 'prioritized', 'paused', 'waiting-children'],
      0,
      -1,
    )
    expect(result.removed).toBe(1)
    expect(removeMatching).toHaveBeenCalledTimes(1)
    expect(removeAutoIndex).not.toHaveBeenCalled()
    expect(removeOtherOrg).not.toHaveBeenCalled()
    expect(removeOtherTenant).not.toHaveBeenCalled()
  })

  it('keeps structured Redis options when host-based config is used', async () => {
    const queue = createQueue<{ value: number }>('test-queue', 'async', {
      connection: {
        host: 'redis.internal',
        port: 6380,
        username: 'default',
        password: 'secret',
        db: 6,
        tls: {},
      },
    })

    await queue.enqueue({ value: 42 })

    expect(queueCtor).toHaveBeenCalledWith('test-queue', {
      connection: {
        host: 'redis.internal',
        port: 6380,
        username: 'default',
        password: 'secret',
        db: 6,
        tls: {},
      },
    })
  })
})

describe('Queue - async strategy - introspection (#3105)', () => {
  const getRedisUrlOrThrowMock = getRedisUrlOrThrow as jest.MockedFunction<typeof getRedisUrlOrThrow>

  beforeEach(() => {
    jest.clearAllMocks()
    getRedisUrlOrThrowMock.mockReturnValue('rediss://default:secret@example.com:6380/1')
  })

  it('getJobCounts requests and returns the optional delayed count', async () => {
    const queue = createQueue<{ value: number }>('test-queue', 'async')

    const counts = await queue.getJobCounts()

    expect(queueGetJobCounts).toHaveBeenCalledWith('waiting', 'active', 'completed', 'failed', 'delayed')
    expect(counts.delayed).toBe(5)
  })

  it('getFailedJobsSummary allow-lists fields, never includes a payload key, and clamps a client-supplied limit', async () => {
    queueGetJobs.mockResolvedValueOnce([
      {
        id: 'job-1',
        name: 'test-queue',
        data: { id: 'job-1', payload: { tenantId: 'tenant-1', secret: 'do-not-leak' }, createdAt: '2026-01-01T00:00:00.000Z' },
        failedReason: `x${'y'.repeat(600)} password=do-not-leak`,
        attemptsMade: 3,
        finishedOn: 1_700_000_000_000,
      },
    ])
    const queue = createQueue<{ tenantId: string; secret: string }>('test-queue', 'async')

    const summary = await queue.getFailedJobsSummary!(500)

    // Clamped to the server cap (50), not the caller-supplied 500.
    expect(queueGetJobs).toHaveBeenCalledWith(['failed'], 0, 49)
    expect(summary).toHaveLength(1)
    expect(summary[0]).toMatchObject({
      id: 'job-1',
      queue: 'test-queue',
      errorCode: 'queue.handler_error',
      attemptsMade: 3,
      failedAt: 1_700_000_000_000,
    })
    expect(summary[0]).not.toHaveProperty('failedReason')
    expect(JSON.stringify(summary[0])).not.toContain('do-not-leak')
    expect(summary[0]).not.toHaveProperty('data')
  })

  it('getProcessingStats computes avg/last/p95/wait from a bounded newest-first sample and never reads payload', async () => {
    queueGetJobs.mockResolvedValueOnce([
      { id: 'c3', name: 'test-queue', timestamp: 1000, processedOn: 1100, finishedOn: 1300, data: { payload: { secret: 'x' } } },
      { id: 'c2', name: 'test-queue', timestamp: 2000, processedOn: 2050, finishedOn: 2150 },
      { id: 'c1', name: 'test-queue', timestamp: 3000, processedOn: 3010, finishedOn: 3020 },
    ])
    const queue = createQueue<{ secret: string }>('test-queue', 'async')

    const stats = await queue.getProcessingStats!({ sampleSize: 1000 })

    // Clamped to the server cap (200), not the caller-supplied 1000.
    expect(queueGetJobs).toHaveBeenCalledWith(['completed'], 0, 199)
    expect(stats.sampleSize).toBe(3)
    // Newest-first: the first job in the mocked array is treated as "last completed".
    expect(stats.lastProcessingMs).toBe(200) // 1300 - 1100
    expect(stats.lastCompletedAt).toBe(1300)
    expect(stats.avgProcessingMs).toBeCloseTo((200 + 100 + 10) / 3)
    expect(stats.avgWaitMs).toBeCloseTo((100 + 50 + 10) / 3)
    expect(stats.fidelity).toBe('exact')
    expect(JSON.stringify(stats)).not.toContain('secret')
  })

  it('getProcessingStats filters the sample by job type', async () => {
    queueGetJobs.mockResolvedValueOnce([
      { id: 'a', name: 'uuid-a', data: { payload: { jobType: 'type-a' } }, timestamp: 0, processedOn: 10, finishedOn: 20 },
      { id: 'b', name: 'uuid-b', data: { payload: { jobType: 'type-b' } }, timestamp: 0, processedOn: 100, finishedOn: 200 },
    ])
    const queue = createQueue('test-queue', 'async')

    const stats = await queue.getProcessingStats!({ type: 'type-b' })

    expect(stats.sampleSize).toBe(1)
    expect(stats.lastProcessingMs).toBe(100)
  })

  it('getProcessingStats returns a defined-but-empty result for an empty queue', async () => {
    queueGetJobs.mockResolvedValueOnce([])
    const queue = createQueue('test-queue', 'async')

    const stats = await queue.getProcessingStats!()

    expect(stats).toMatchObject({ sampleSize: 0, fidelity: 'exact' })
    expect(stats.avgProcessingMs).toBeUndefined()
  })

  it('getInFlightJobsSummary reports runningMs for active jobs and never reads payload', async () => {
    const now = 1_700_000_010_000
    jest.spyOn(Date, 'now').mockReturnValue(now)
    queueGetJobs.mockResolvedValueOnce([
      { id: 'active-1', name: 'test-queue', processedOn: now - 4000, data: { payload: { secret: 'x' } } },
    ])
    const queue = createQueue('test-queue', 'async')

    const inFlight = await queue.getInFlightJobsSummary!({ state: 'active', limit: 500 })

    expect(queueGetJobs).toHaveBeenCalledWith(['active'], 0, 49, true) // clamped to 50, oldest first
    expect(inFlight).toEqual([
      expect.objectContaining({ id: 'active-1', state: 'active', startedAt: now - 4000, runningMs: 4000 }),
    ])
    expect(inFlight[0].ageMs).toBeUndefined()
    expect(JSON.stringify(inFlight)).not.toContain('secret')
  })

  it('getInFlightJobsSummary reports ageMs for waiting jobs and honors the type filter', async () => {
    const now = 1_700_000_010_000
    jest.spyOn(Date, 'now').mockReturnValue(now)
    queueGetJobs.mockResolvedValueOnce([
      { id: 'w-1', name: 'uuid-1', data: { payload: { jobType: 'match' } }, timestamp: now - 9000 },
      { id: 'w-2', name: 'uuid-2', data: { payload: { jobType: 'other' } }, timestamp: now - 1000 },
    ])
    const queue = createQueue('test-queue', 'async')

    const inFlight = await queue.getInFlightJobsSummary!({ state: 'waiting', type: 'match', limit: 10 })

    expect(inFlight).toHaveLength(1)
    expect(inFlight[0]).toMatchObject({ id: 'w-1', state: 'waiting', ageMs: 9000 })
    expect(inFlight[0].startedAt).toBeUndefined()
    expect(inFlight[0].runningMs).toBeUndefined()
  })

  it('getRecentJobs unwraps the QueuedJob envelope so data is the caller payload, newest-first, bounded', async () => {
    queueGetJobs.mockImplementation(async (types: string[]) =>
      types[0] === 'waiting'
        ? [{ id: 'job-2', name: 'test-queue', data: { id: 'job-2', payload: { secret: 'second' }, createdAt: '2026-01-02T00:00:00.000Z' } }]
        : [],
    )
    const queue = createQueue<{ secret: string }>('test-queue', 'async')

    const jobs = await queue.getRecentJobs!({ limit: 500 })
    queueGetJobs.mockImplementation(async () => [])

    // One bounded read per state (clamped to the server cap of 100), merged by recency afterwards.
    for (const state of ['waiting', 'active', 'delayed', 'failed', 'completed']) {
      expect(queueGetJobs).toHaveBeenCalledWith([state], 0, 99)
    }
    expect(jobs).toEqual([
      expect.objectContaining({ id: 'job-2', queue: 'test-queue', data: { secret: 'second' } }),
    ])
  })

  it('getRecentJobs resolves a single job by id, bounded to exactly one, regardless of limit', async () => {
    queueGetJob.mockResolvedValueOnce({
      id: 'job-9',
      data: { id: 'job-9', payload: { secret: 'only-this-one' }, createdAt: '2026-01-01T00:00:00.000Z' },
    })
    const queue = createQueue<{ secret: string }>('test-queue', 'async')

    const jobs = await queue.getRecentJobs!({ id: 'job-9', limit: 100 })

    expect(queueGetJob).toHaveBeenCalledWith('job-9')
    expect(queueGetJobs).not.toHaveBeenCalled()
    expect(jobs).toEqual([
      expect.objectContaining({ id: 'job-9', data: { secret: 'only-this-one' } }),
    ])
  })

  it('getRecentJobs returns an empty array for an unknown id', async () => {
    queueGetJob.mockResolvedValueOnce(undefined)
    const queue = createQueue('test-queue', 'async')

    await expect(queue.getRecentJobs!({ id: 'missing', limit: 10 })).resolves.toEqual([])
  })
})
