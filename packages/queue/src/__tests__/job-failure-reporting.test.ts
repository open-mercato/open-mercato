import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createQueue } from '../factory'
import {
  registerTelemetryRuntime,
  resetTelemetryRuntime,
  type TelemetryRuntime,
} from '@open-mercato/shared/lib/telemetry/runtime'
import type { QueuedJob } from '../types'

type Reported = {
  code?: string
  attributes?: Record<string, string | number | boolean | undefined>
  message: string
}

type WorkerListener = (...args: unknown[]) => void

const capturedListeners = new Map<string, WorkerListener[]>()

jest.mock('@open-mercato/shared/lib/redis/connection', () => ({
  getRedisUrlOrThrow: jest.fn(() => 'redis://127.0.0.1:6379'),
  parseRedisUrl: jest.requireActual('@open-mercato/shared/lib/redis/connection').parseRedisUrl,
  REDIS_WIRE_PROTOCOL: 3,
}))

jest.mock('bullmq', () => {
  class MockQueue<T> {
    add = jest.fn(async () => ({ id: 'bull-job-id' }))
    close = jest.fn(async () => {})
    obliterate = jest.fn(async () => {})
    getJobCounts = jest.fn(async () => ({ waiting: 0, active: 0, completed: 0, failed: 0 }))
    getJobs = jest.fn(async () => [] as Array<{ id?: string; data?: T }>)
  }

  class MockWorker<T> {
    constructor(
      _name: string,
      _processor: (job: { id?: string; data: T; attemptsMade: number }) => Promise<void>,
      _opts: unknown,
    ) {}

    on = (event: string, listener: WorkerListener) => {
      const existing = capturedListeners.get(event) ?? []
      existing.push(listener)
      capturedListeners.set(event, existing)
    }

    close = jest.fn(async () => {})
  }

  return { Queue: MockQueue, Worker: MockWorker }
})

function runtimeStub() {
  const reported: Reported[] = []
  const runtime = {
    canUseGlobalTracePropagation: () => false,
    captureTraceContext: () => ({}),
    continueTrace: <T>(_carrier: unknown, _name: string, fn: () => T) => fn(),
    withSpan: <T>(_name: string, fn: (span: { setAttributes: () => void }) => T) => fn({ setAttributes: () => {} }),
    recordHttpDuration: () => {},
    reportError: (
      error: unknown,
      context?: { code?: string; attributes?: Record<string, string | number | boolean | undefined> },
    ) => {
      reported.push({
        code: context?.code,
        attributes: context?.attributes,
        message: error instanceof Error ? error.message : String(error),
      })
    },
    shutdown: async () => {},
  } as unknown as TelemetryRuntime
  return { runtime, reported }
}

function emit(event: string, ...args: unknown[]): void {
  for (const listener of capturedListeners.get(event) ?? []) listener(...args)
}

describe('queue job failures are reported, not only logged', () => {
  afterEach(() => {
    resetTelemetryRuntime()
    capturedListeners.clear()
  })

  describe('local strategy', () => {
    const origCwd = process.cwd()
    let tmp: string

    beforeEach(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-report-'))
      process.chdir(tmp)
    })

    afterEach(() => {
      process.chdir(origCwd)
      try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
    })

    it('reports a failed job with the queue and attempt', async () => {
      const { runtime, reported } = runtimeStub()
      registerTelemetryRuntime(runtime)
      const queue = createQueue<{ value: number }>('data-sync', 'local')
      await queue.enqueue({ value: 1 })

      await queue.process(() => { throw new Error('import batch blew up') }, { limit: 10 })

      expect(reported).toEqual([
        expect.objectContaining({
          code: 'queue.job_failed',
          message: 'import batch blew up',
          attributes: expect.objectContaining({ queue: 'data-sync', attemptNumber: 1 }),
        }),
      ])

      await queue.close()
    })

    it('reports the final drop when a job exhausts its attempts', async () => {
      const { runtime, reported } = runtimeStub()
      registerTelemetryRuntime(runtime)
      const queue = createQueue<{ value: number }>('data-sync', 'local')
      await queue.enqueue({ value: 1 })

      const queuePath = path.join('.mercato', 'queue', 'data-sync', 'queue.json')
      const jobs = JSON.parse(fs.readFileSync(queuePath, 'utf8')) as Array<Record<string, unknown>>
      jobs[0].attemptCount = 2
      jobs[0].availableAt = undefined
      fs.writeFileSync(queuePath, JSON.stringify(jobs, null, 2), 'utf8')

      await queue.process(() => { throw new Error('permanent') }, { limit: 10 })

      expect(reported.map((entry) => entry.code)).toEqual(['queue.job_failed', 'queue.job_exhausted'])

      await queue.close()
    })

    it('is a no-op with telemetry off', async () => {
      const queue = createQueue<{ value: number }>('data-sync', 'local')
      await queue.enqueue({ value: 1 })

      const result = await queue.process(() => { throw new Error('boom') }, { limit: 10 })

      expect(result?.failed).toBe(1)

      await queue.close()
    })
  })

  describe('async strategy', () => {
    it('reports a job the queue failed, alongside the log line', async () => {
      const { runtime, reported } = runtimeStub()
      registerTelemetryRuntime(runtime)
      const queue = createQueue<{ runId: string }>('data-sync', 'async')
      await queue.process(async () => {})

      const job: { id: string; data: QueuedJob<{ runId: string }> } = {
        id: 'job-1',
        data: { id: 'job-1', payload: { runId: 'run-1' }, createdAt: new Date(0).toISOString() },
      }
      emit('failed', job, new Error('handler rethrew after marking the run failed'))

      expect(reported).toEqual([
        expect.objectContaining({
          code: 'queue.job_failed',
          message: 'handler rethrew after marking the run failed',
          attributes: expect.objectContaining({ queue: 'data-sync', jobId: 'job-1' }),
        }),
      ])

      await queue.close()
    })

    it('reports a worker-level error', async () => {
      const { runtime, reported } = runtimeStub()
      registerTelemetryRuntime(runtime)
      const queue = createQueue<{ runId: string }>('data-sync', 'async')
      await queue.process(async () => {})

      emit('error', new Error('redis connection lost'))

      expect(reported).toEqual([
        expect.objectContaining({ code: 'queue.worker_error', message: 'redis connection lost' }),
      ])

      await queue.close()
    })
  })
})
