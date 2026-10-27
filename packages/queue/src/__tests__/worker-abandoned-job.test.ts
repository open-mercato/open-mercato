import { runWorker } from '../worker/runner'
import type { WorkerDescriptor } from '../types'

type WorkerListener = (...args: unknown[]) => void

const capturedListeners = new Map<string, WorkerListener[]>()

function emit(event: string, ...args: unknown[]): void {
  for (const listener of capturedListeners.get(event) ?? []) listener(...args)
}

jest.mock('@open-mercato/shared/lib/redis/connection', () => ({
  getRedisUrlOrThrow: jest.fn(() => 'redis://localhost:6379'),
  parseRedisUrl: jest.requireActual('@open-mercato/shared/lib/redis/connection').parseRedisUrl,
  REDIS_WIRE_PROTOCOL: jest.requireActual('@open-mercato/shared/lib/redis/connection').REDIS_WIRE_PROTOCOL,
}))

jest.mock('bullmq', () => {
  class MockQueue<T> {
    constructor(_name: string, _opts: unknown) {}
    add = jest.fn(async () => ({ id: 'bull-job-id' }))
    close = jest.fn(async () => {})
    obliterate = jest.fn(async () => {})
    getJobCounts = jest.fn(async () => ({ waiting: 0, active: 0, completed: 0, failed: 0 }))
    getJobs = jest.fn(async () => [])
  }

  class MockWorker<T> {
    constructor(_name: string, _processor: unknown, _opts: unknown) {}
    on = (event: string, listener: WorkerListener) => {
      const existing = capturedListeners.get(event) ?? []
      existing.push(listener)
      capturedListeners.set(event, existing)
    }

    close = jest.fn(async () => {})
  }

  return { Queue: MockQueue, Worker: MockWorker }
})

/**
 * Reachability, not wiring.
 *
 * The queue that runs jobs is built by `runWorker`, not by whoever enqueues them, so a callback
 * attached to the enqueueing instance is never installed on the consumer — the failure this guards
 * against is invisible to any test that asserts the option was *passed* somewhere. This one goes
 * through the path `worker --all` uses and asserts the callback actually fires.
 */
describe('runWorker — abandoned-job reporting', () => {
  beforeEach(() => {
    capturedListeners.clear()
  })

  it('installs a worker descriptor\'s onJobAbandoned on the queue it builds', async () => {
    const onJobAbandoned = jest.fn(async () => {})
    const descriptor: WorkerDescriptor = {
      id: 'test:worker',
      queue: 'test-queue',
      concurrency: 1,
      handler: async () => {},
      onJobAbandoned,
    }

    await runWorker({
      queueName: descriptor.queue,
      handler: descriptor.handler,
      concurrency: descriptor.concurrency,
      onJobAbandoned: descriptor.onJobAbandoned,
      strategy: 'async',
      gracefulShutdown: false,
      background: true,
    })

    const payload = { id: 'job-1', payload: { runId: 'run-1' }, createdAt: new Date(0).toISOString() }
    emit('failed', { id: 'job-1', data: payload }, new Error('job stalled more than allowable limit'))
    await Promise.resolve()
    await Promise.resolve()

    expect(onJobAbandoned).toHaveBeenCalledWith(payload, {
      jobId: 'job-1',
      reason: 'job stalled more than allowable limit',
    })
  })

  it('leaves the queue without one when no worker declares it', async () => {
    await runWorker({
      queueName: 'test-queue',
      handler: async () => {},
      strategy: 'async',
      gracefulShutdown: false,
      background: true,
    })

    // Nothing to assert a call against; the guarantee is that the 'failed' path stays inert, which
    // would otherwise show up as a thrown error inside the listener.
    expect(() =>
      emit('failed', { id: 'job-1', data: { id: 'job-1', payload: {}, createdAt: '' } }, new Error('job stalled more than allowable limit')),
    ).not.toThrow()
  })
})
