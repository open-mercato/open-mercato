import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createModuleQueue } from '../factory'
import { ABANDONED_JOB_SWEEP_INTERVAL_MS } from '../strategies/async'
import { getRedisUrlOrThrow } from '@open-mercato/shared/lib/redis/connection'
import type { QueuedJob } from '../types'

type WorkerListener = (...args: unknown[]) => void

let capturedProcessor: ((job: { id?: string; data: unknown; attemptsMade: number }) => Promise<void>) | null = null
const capturedListeners = new Map<string, WorkerListener[]>()

function emit(event: string, ...args: unknown[]): void {
  for (const listener of capturedListeners.get(event) ?? []) listener(...args)
}

jest.mock('@open-mercato/shared/lib/redis/connection', () => ({
  getRedisUrlOrThrow: jest.fn(),
  parseRedisUrl: jest.requireActual('@open-mercato/shared/lib/redis/connection').parseRedisUrl,
  REDIS_WIRE_PROTOCOL: jest.requireActual('@open-mercato/shared/lib/redis/connection').REDIS_WIRE_PROTOCOL,
}))

const mockQueueGetJobs = jest.fn(async (): Promise<unknown[]> => [])

jest.mock('bullmq', () => {
  class MockQueue<T> {
    constructor(_name: string, _opts: unknown) {}
    add = jest.fn(async () => ({ id: 'bull-job-id' }))
    close = jest.fn(async () => {})
    obliterate = jest.fn(async () => {})
    getJobCounts = jest.fn(async () => ({ waiting: 0, active: 0, completed: 0, failed: 0 }))
    getJobs = mockQueueGetJobs
  }

  class MockWorker<T> {
    constructor(
      _name: string,
      processor: (job: { id?: string; data: T; attemptsMade: number }) => Promise<void>,
      _opts: unknown,
    ) {
      capturedProcessor = processor as (job: { id?: string; data: unknown; attemptsMade: number }) => Promise<void>
    }

    on = (event: string, listener: WorkerListener) => {
      const existing = capturedListeners.get(event) ?? []
      existing.push(listener)
      capturedListeners.set(event, existing)
    }

    close = jest.fn(async () => {})
  }

  return { Queue: MockQueue, Worker: MockWorker }
})

type Payload = { runId: string }

function bullJob(id: string, payload: Payload): { id: string; data: QueuedJob<Payload>; attemptsMade: number } {
  return {
    id,
    data: { id, payload, createdAt: new Date(0).toISOString() },
    attemptsMade: 0,
  }
}

/** A delivery BullMQ did not put its own id on — the payload still carries the id we minted. */
function bullJobWithoutId(
  payloadId: string,
  payload: Payload,
): { id?: string; data: QueuedJob<Payload>; attemptsMade: number } {
  return {
    id: undefined,
    data: { id: payloadId, payload, createdAt: new Date(0).toISOString() },
    attemptsMade: 0,
  }
}

type FailedSetJob = {
  id: string
  data: QueuedJob<Payload>
  failedReason: string
  remove: jest.Mock
  updateData: jest.Mock
}

/** A job as the sweep sees it in the failed set. `updateData` persists like the real driver's. */
function failedSetJob(
  id: string,
  payload: Payload,
  failedReason: string,
  metadata?: Record<string, unknown>,
): FailedSetJob {
  const record: FailedSetJob = {
    id,
    data: { id, payload, createdAt: new Date(0).toISOString(), ...(metadata ? { metadata } : {}) },
    failedReason,
    remove: jest.fn(async () => {}),
    updateData: jest.fn(async (data: QueuedJob<Payload>) => {
      record.data = data
    }),
  }
  return record
}

async function flushAsync(turns = 12): Promise<void> {
  for (let index = 0; index < turns; index += 1) {
    await Promise.resolve()
  }
}

describe('onJobAbandoned', () => {
  const getRedisUrlOrThrowMock = getRedisUrlOrThrow as jest.MockedFunction<typeof getRedisUrlOrThrow>
  const originalStrategy = process.env.QUEUE_STRATEGY

  beforeEach(() => {
    jest.clearAllMocks()
    capturedProcessor = null
    capturedListeners.clear()
    getRedisUrlOrThrowMock.mockReturnValue('redis://localhost:6379')
    mockQueueGetJobs.mockResolvedValue([])
    process.env.QUEUE_STRATEGY = 'async'
  })

  afterEach(() => {
    if (originalStrategy === undefined) delete process.env.QUEUE_STRATEGY
    else process.env.QUEUE_STRATEGY = originalStrategy
  })

  it('fires with the job payload when the queue fails a job it never handed to the handler', async () => {
    const onJobAbandoned = jest.fn(async () => {})
    const queue = createModuleQueue<Payload>('test-queue', { onJobAbandoned })
    await queue.process(async () => {})

    const job = bullJob('job-1', { runId: 'run-1' })
    emit('failed', job, new Error('job stalled more than allowable limit'))
    await Promise.resolve()

    expect(onJobAbandoned).toHaveBeenCalledTimes(1)
    expect(onJobAbandoned).toHaveBeenCalledWith(job.data, {
      jobId: 'job-1',
      reason: 'job stalled more than allowable limit',
    })
  })

  it('does not fire when the handler ran and threw — that failure is the handler\'s own', async () => {
    const onJobAbandoned = jest.fn(async () => {})
    const handlerError = new Error('import batch blew up')
    const queue = createModuleQueue<Payload>('test-queue', { onJobAbandoned })
    await queue.process(async () => {
      throw handlerError
    })

    const job = bullJob('job-1', { runId: 'run-1' })
    await expect(capturedProcessor!(job)).rejects.toThrow(handlerError)
    emit('failed', job, handlerError)
    await Promise.resolve()

    expect(onJobAbandoned).not.toHaveBeenCalled()
  })

  it('fires for the abandonment reason BullMQ writes when a job outruns its started limit', async () => {
    const onJobAbandoned = jest.fn(async () => {})
    const queue = createModuleQueue<Payload>('test-queue', { onJobAbandoned })
    await queue.process(async () => {})

    const job = bullJob('job-1', { runId: 'run-1' })
    emit('failed', job, new Error('job started more than allowable limit'))
    await Promise.resolve()

    expect(onJobAbandoned).toHaveBeenCalledWith(job.data, {
      jobId: 'job-1',
      reason: 'job started more than allowable limit',
    })
  })

  it('fires when the same worker earlier ran an attempt of the job that stalled out', async () => {
    // The zombie case: this process entered the processor for an attempt that hung past the lock
    // duration, and the final, abandoned delivery lands back in the same process. Classification
    // must not depend on what this worker remembers doing.
    const onJobAbandoned = jest.fn(async () => {})
    const queue = createModuleQueue<Payload>('test-queue', { onJobAbandoned, concurrency: 2 })
    let releaseZombie = () => {}
    await queue.process(async () => {
      await new Promise<void>((resolve) => {
        releaseZombie = resolve
      })
    })

    const job = bullJob('job-1', { runId: 'run-1' })
    void capturedProcessor!(job) // still hanging, exactly like the stalled attempt
    emit('failed', job, new Error('job stalled more than allowable limit'))
    await Promise.resolve()

    expect(onJobAbandoned).toHaveBeenCalledTimes(1)
    releaseZombie()
  })

  it('reports each abandoned job when several failures arrive together', async () => {
    const onJobAbandoned = jest.fn(async () => {})
    const queue = createModuleQueue<Payload>('test-queue', { onJobAbandoned, concurrency: 2 })
    await queue.process(async () => {})

    const handlerFailure = bullJob('job-threw', { runId: 'run-1' })
    const abandoned = bullJob('job-abandoned', { runId: 'run-2' })
    emit('failed', handlerFailure, new Error('import batch blew up'))
    emit('failed', abandoned, new Error('job stalled more than allowable limit'))
    await Promise.resolve()

    expect(onJobAbandoned).toHaveBeenCalledTimes(1)
    expect(onJobAbandoned).toHaveBeenCalledWith(abandoned.data, {
      jobId: 'job-abandoned',
      reason: 'job stalled more than allowable limit',
    })
  })

  it('reports an abandoned job that carries no job id of its own', async () => {
    const onJobAbandoned = jest.fn(async () => {})
    const queue = createModuleQueue<Payload>('test-queue', { onJobAbandoned })
    await queue.process(async () => {})

    const job = bullJobWithoutId('payload-1', { runId: 'run-1' })
    emit('failed', job, new Error('job stalled more than allowable limit'))
    await Promise.resolve()

    expect(onJobAbandoned).toHaveBeenCalledWith(job.data, {
      jobId: null,
      reason: 'job stalled more than allowable limit',
    })
  })

  it('stays quiet when the queue cannot produce the job at all', async () => {
    const onJobAbandoned = jest.fn(async () => {})
    const queue = createModuleQueue<Payload>('test-queue', { onJobAbandoned })
    await queue.process(async () => {})

    emit('failed', undefined, new Error('job stalled more than allowable limit'))
    emit('failed', { id: 'job-1' }, new Error('job stalled more than allowable limit'))
    await Promise.resolve()

    expect(onJobAbandoned).not.toHaveBeenCalled()
  })

  it('drains an in-flight report on close so a shutdown cannot truncate a repair', async () => {
    let finishReport = () => {}
    const reportFinished = jest.fn()
    const onJobAbandoned = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finishReport = () => {
            reportFinished()
            resolve()
          }
        }),
    )
    const queue = createModuleQueue<Payload>('test-queue', { onJobAbandoned })
    await queue.process(async () => {})

    emit('failed', bullJob('job-1', { runId: 'run-1' }), new Error('job stalled more than allowable limit'))
    await Promise.resolve()
    expect(reportFinished).not.toHaveBeenCalled()

    const closed = queue.close()
    let closedEarly = false
    void closed.then(() => {
      closedEarly = !reportFinished.mock.calls.length
    })
    await Promise.resolve()
    expect(closedEarly).toBe(false)

    finishReport()
    await closed
    expect(reportFinished).toHaveBeenCalledTimes(1)
  })

  it('swallows a throwing hook so the reporting cannot kill the worker', async () => {
    const onJobAbandoned = jest.fn(async () => {
      throw new Error('reporting failed')
    })
    const queue = createModuleQueue<Payload>('test-queue', { onJobAbandoned })
    await queue.process(async () => {})

    const job = bullJob('job-1', { runId: 'run-1' })
    expect(() => emit('failed', job, new Error('job stalled more than allowable limit'))).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()

    expect(onJobAbandoned).toHaveBeenCalledTimes(1)
  })

  it('sweeps the failed set on worker start and delivers reports nobody was alive to send', async () => {
    const abandoned = failedSetJob('job-a', { runId: 'run-a' }, 'job stalled more than allowable limit')
    const handlerFailure = failedSetJob('job-b', { runId: 'run-b' }, 'import batch blew up')
    const alreadyReported = failedSetJob('job-c', { runId: 'run-c' }, 'job stalled more than allowable limit', {
      abandonReportedAt: '2026-01-01T00:00:00.000Z',
    })
    mockQueueGetJobs.mockResolvedValue([abandoned, handlerFailure, alreadyReported])

    const onJobAbandoned = jest.fn(async () => {})
    const queue = createModuleQueue<Payload>('test-queue', { onJobAbandoned })
    await queue.process(async () => {})
    await flushAsync()

    expect(onJobAbandoned).toHaveBeenCalledTimes(1)
    expect(onJobAbandoned).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-a' }), {
      jobId: 'job-a',
      reason: 'job stalled more than allowable limit',
    })
    expect(abandoned.data.metadata?.abandonReportedAt).toEqual(expect.any(String))
    expect(handlerFailure.updateData).not.toHaveBeenCalled()
    expect(alreadyReported.updateData).not.toHaveBeenCalled()
    expect(abandoned.remove).not.toHaveBeenCalled()
    await queue.close()
  })

  it('retries an undelivered report on the next sweep instead of losing it', async () => {
    jest.useFakeTimers()
    try {
      const abandoned = failedSetJob('job-a', { runId: 'run-a' }, 'job stalled more than allowable limit')
      mockQueueGetJobs.mockResolvedValue([abandoned])

      const onJobAbandoned = jest
        .fn<Promise<void>, [unknown, unknown]>()
        .mockRejectedValueOnce(new Error('db down'))
        .mockResolvedValue(undefined)
      const queue = createModuleQueue<Payload>('test-queue', { onJobAbandoned })
      await queue.process(async () => {})
      await flushAsync()

      expect(onJobAbandoned).toHaveBeenCalledTimes(1)
      expect(abandoned.updateData).not.toHaveBeenCalled()

      jest.advanceTimersByTime(ABANDONED_JOB_SWEEP_INTERVAL_MS)
      await flushAsync()

      expect(onJobAbandoned).toHaveBeenCalledTimes(2)
      expect(abandoned.updateData).toHaveBeenCalledTimes(1)
      await queue.close()
    } finally {
      jest.useRealTimers()
    }
  })

  it('acknowledges a delivered report so later sweeps do not repeat it', async () => {
    jest.useFakeTimers()
    try {
      const job = failedSetJob('job-1', { runId: 'run-1' }, 'job stalled more than allowable limit')
      const onJobAbandoned = jest.fn(async () => {})
      const queue = createModuleQueue<Payload>('test-queue', { onJobAbandoned })
      await queue.process(async () => {})
      await flushAsync()

      emit('failed', job, new Error('job stalled more than allowable limit'))
      await flushAsync()
      expect(onJobAbandoned).toHaveBeenCalledTimes(1)
      expect(job.data.metadata?.abandonReportedAt).toEqual(expect.any(String))

      mockQueueGetJobs.mockResolvedValue([job])
      jest.advanceTimersByTime(ABANDONED_JOB_SWEEP_INTERVAL_MS)
      await flushAsync()

      expect(onJobAbandoned).toHaveBeenCalledTimes(1)
      await queue.close()
    } finally {
      jest.useRealTimers()
    }
  })

  it('does not report a job twice while its first report is still in flight', async () => {
    const job = failedSetJob('job-1', { runId: 'run-1' }, 'job stalled more than allowable limit')
    mockQueueGetJobs.mockResolvedValue([job])

    let finishReport = () => {}
    const onJobAbandoned = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finishReport = resolve
        }),
    )
    const queue = createModuleQueue<Payload>('test-queue', { onJobAbandoned })
    await queue.process(async () => {})
    await flushAsync()
    expect(onJobAbandoned).toHaveBeenCalledTimes(1)

    emit('failed', job, new Error('job stalled more than allowable limit'))
    await flushAsync()
    expect(onJobAbandoned).toHaveBeenCalledTimes(1)

    finishReport()
    await flushAsync()
    expect(job.updateData).toHaveBeenCalledTimes(1)
    await queue.close()
  })

  it('is not forwarded to the local strategy, which cannot abandon a job', async () => {
    process.env.QUEUE_STRATEGY = 'local'
    const originalCwd = process.cwd()
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-abandoned-'))
    process.chdir(tmp)

    try {
      const onJobAbandoned = jest.fn(async () => {})
      const queue = createModuleQueue<Payload>('test-queue', { onJobAbandoned })
      expect(queue.strategy).toBe('local')

      await queue.enqueue({ runId: 'run-1' })
      const result = await queue.process(
        async () => {
          throw new Error('handler failed')
        },
        { limit: 1 },
      )

      expect(result.failed).toBe(1)
      expect(onJobAbandoned).not.toHaveBeenCalled()
      await queue.close()
    } finally {
      process.chdir(originalCwd)
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})
