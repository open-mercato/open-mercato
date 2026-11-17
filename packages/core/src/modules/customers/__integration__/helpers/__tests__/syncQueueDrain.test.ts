import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  drainSyncQueue,
  waitForLocalQueueJobsToSettle,
  type SyncQueueConsumers,
} from '../syncQueueDrain'

function createConsumers(): SyncQueueConsumers & {
  drain: jest.Mock<Promise<number>, [string]>
  awaitWorkers: jest.Mock<Promise<number>, [string]>
} {
  return {
    drain: jest.fn<Promise<number>, [string]>().mockResolvedValue(3),
    awaitWorkers: jest.fn<Promise<number>, [string]>().mockResolvedValue(2),
  }
}

describe('example customer sync queue consumption', () => {
  it.each(['true', '1', 'on', ' TRUE ', '', 'invalid'])('waits for background workers when AUTO_SPAWN_WORKERS is %p', async (value) => {
    const consumers = createConsumers()

    await expect(drainSyncQueue('events', consumers, { AUTO_SPAWN_WORKERS: value })).resolves.toBe(2)
    expect(consumers.awaitWorkers).toHaveBeenCalledWith('events')
    expect(consumers.drain).not.toHaveBeenCalled()
  })

  it('waits for background workers when AUTO_SPAWN_WORKERS is unset', async () => {
    const consumers = createConsumers()

    await expect(drainSyncQueue('events', consumers, {})).resolves.toBe(2)
    expect(consumers.awaitWorkers).toHaveBeenCalledTimes(1)
    expect(consumers.drain).not.toHaveBeenCalled()
  })

  it.each(['false', '0', 'off', ' FALSE '])('drains jobs when AUTO_SPAWN_WORKERS is %p', async (value) => {
    const consumers = createConsumers()

    await expect(drainSyncQueue('example-customers-sync-inbound', consumers, { AUTO_SPAWN_WORKERS: value })).resolves.toBe(3)
    expect(consumers.drain).toHaveBeenCalledTimes(1)
    expect(consumers.drain).toHaveBeenCalledWith('example-customers-sync-inbound')
    expect(consumers.awaitWorkers).not.toHaveBeenCalled()
  })

  it('propagates manual drain failures', async () => {
    const failure = new Error('Queue worker failed')
    const consumers = createConsumers()
    consumers.drain.mockRejectedValue(failure)

    await expect(drainSyncQueue('example-customers-sync-outbound', consumers, { AUTO_SPAWN_WORKERS: 'false' })).rejects.toBe(failure)
  })

  it('propagates background worker barrier failures', async () => {
    const failure = new Error('Timed out waiting for background workers')
    const consumers = createConsumers()
    consumers.awaitWorkers.mockRejectedValue(failure)

    await expect(drainSyncQueue('events', consumers, { AUTO_SPAWN_WORKERS: 'true' })).rejects.toBe(failure)
    expect(consumers.drain).not.toHaveBeenCalled()
  })

  it('honors the worker alias when the legacy flag is unset', async () => {
    const consumers = createConsumers()

    await expect(drainSyncQueue('events', consumers, { OM_AUTO_SPAWN_WORKERS: 'false' })).resolves.toBe(3)
    expect(consumers.drain).toHaveBeenCalledWith('events')
    expect(consumers.awaitWorkers).not.toHaveBeenCalled()
  })

  it('gives the legacy flag precedence over the worker alias', async () => {
    const consumers = createConsumers()

    await expect(drainSyncQueue('events', consumers, {
      AUTO_SPAWN_WORKERS: 'true',
      OM_AUTO_SPAWN_WORKERS: 'false',
    })).resolves.toBe(2)
    expect(consumers.awaitWorkers).toHaveBeenCalledWith('events')
    expect(consumers.drain).not.toHaveBeenCalled()
  })
})

describe('local queue background worker barrier', () => {
  const queueName = 'events'
  let baseDir: string

  type QueuedJobFixture = string | { id: string; attemptCount?: number; availableAt?: string }

  async function writeQueuedJobs(jobs: QueuedJobFixture[]): Promise<void> {
    const queueFile = path.join(baseDir, queueName, 'queue.json')
    const stagingFile = `${queueFile}.${randomUUID()}.tmp`
    const storedJobs = jobs.map((job) => ({
      ...(typeof job === 'string' ? { id: job } : job),
      payload: { event: 'example.todo.deleted' },
      createdAt: new Date().toISOString(),
    }))
    await fs.mkdir(path.dirname(queueFile), { recursive: true })
    await fs.writeFile(stagingFile, JSON.stringify(storedJobs))
    await fs.rename(stagingFile, queueFile)
  }

  function inOneHour(): string {
    return new Date(Date.now() + 60 * 60 * 1000).toISOString()
  }

  async function waitForPolls(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 40))
  }

  beforeEach(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'om-sync-queue-barrier-'))
  })

  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true })
  })

  it('resolves immediately when the queue file does not exist', async () => {
    await expect(waitForLocalQueueJobsToSettle(queueName, { baseDir, timeoutMs: 50, pollIntervalMs: 5 })).resolves.toBe(0)
  })

  it('resolves immediately when the queue holds no jobs', async () => {
    await writeQueuedJobs([])

    await expect(waitForLocalQueueJobsToSettle(queueName, { baseDir, timeoutMs: 50, pollIntervalMs: 5 })).resolves.toBe(0)
  })

  it('stays pending until every job queued at call time has been handled', async () => {
    await writeQueuedJobs(['probe-job', 'other-job'])
    let settled = false
    const barrier = waitForLocalQueueJobsToSettle(queueName, { baseDir, timeoutMs: 5_000, pollIntervalMs: 5 })
      .then((count) => {
        settled = true
        return count
      })

    await waitForPolls()
    expect(settled).toBe(false)

    await writeQueuedJobs(['other-job'])
    await waitForPolls()
    expect(settled).toBe(false)

    await writeQueuedJobs([])
    await expect(barrier).resolves.toBe(2)
  })

  it('does not wait for jobs enqueued after the barrier started', async () => {
    await writeQueuedJobs(['probe-job'])
    const barrier = waitForLocalQueueJobsToSettle(queueName, { baseDir, timeoutMs: 5_000, pollIntervalMs: 5 })

    await waitForPolls()
    await writeQueuedJobs(['later-job'])

    await expect(barrier).resolves.toBe(1)
  })

  it('treats a failed attempt rescheduled for retry as handled, like a manual drain', async () => {
    await writeQueuedJobs(['probe-job'])
    let settled = false
    const barrier = waitForLocalQueueJobsToSettle(queueName, { baseDir, timeoutMs: 5_000, pollIntervalMs: 5 })
      .then((count) => {
        settled = true
        return count
      })

    await waitForPolls()
    expect(settled).toBe(false)

    await writeQueuedJobs([{ id: 'probe-job', attemptCount: 1, availableAt: inOneHour() }])
    await expect(barrier).resolves.toBe(1)
  })

  it('keeps waiting for a retried job until its next attempt', async () => {
    await writeQueuedJobs([{ id: 'probe-job', attemptCount: 1 }])
    let settled = false
    const barrier = waitForLocalQueueJobsToSettle(queueName, { baseDir, timeoutMs: 5_000, pollIntervalMs: 5 })
      .then((count) => {
        settled = true
        return count
      })

    await waitForPolls()
    expect(settled).toBe(false)

    await writeQueuedJobs([{ id: 'probe-job', attemptCount: 2, availableAt: inOneHour() }])
    await expect(barrier).resolves.toBe(1)
  })

  it('does not wait for jobs scheduled after the call', async () => {
    await writeQueuedJobs([{ id: 'scheduled-job', availableAt: inOneHour() }])

    await expect(waitForLocalQueueJobsToSettle(queueName, { baseDir, timeoutMs: 50, pollIntervalMs: 5 })).resolves.toBe(0)
  })

  it('times out while a queued job is still waiting for a worker', async () => {
    await writeQueuedJobs(['probe-job'])

    await expect(waitForLocalQueueJobsToSettle(queueName, { baseDir, timeoutMs: 30, pollIntervalMs: 5 }))
      .rejects.toThrow(/settle 1 of 1 job\(s\) in local queue "events"/)
  })
})
