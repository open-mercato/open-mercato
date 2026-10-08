import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createLocalQueue } from '../strategies/local'
import type { QueuedJob } from '../types'
import {
  getAmbientCausation,
  reportCausationDegradation,
  runWithCausation,
  type CausationEnvelope,
} from '@open-mercato/shared/lib/causation/server'
import {
  registerTelemetryRuntime,
  resetTelemetryRuntime,
} from '@open-mercato/shared/lib/telemetry/runtime'

jest.mock('@open-mercato/shared/lib/logger', () => {
  const mocked = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  }
  mocked.child.mockImplementation(() => mocked)
  return { createLogger: jest.fn(() => mocked) }
})

jest.mock('@open-mercato/shared/lib/causation/server', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/causation/server'),
  reportCausationDegradation: jest.fn(),
}))

const reportDegradation = reportCausationDegradation as jest.MockedFunction<typeof reportCausationDegradation>
const MISSING_ENTRY = [{ kind: 'unknown', ref: 'queue:missing_causation' }]
const DETACHED_POLL_INTERVAL = 43

type TimerCallback = (...args: unknown[]) => void

const ENQUEUER: CausationEnvelope = {
  correlationId: '11111111-1111-4111-8111-111111111111',
  frames: [{ kind: 'user' }, { kind: 'subscriber', id: 'sales:reconcile', ref: 'sales.order.created' }],
  causedByLogId: '22222222-2222-4222-8222-222222222222',
}

const POLLER: CausationEnvelope = {
  correlationId: '33333333-3333-4333-8333-333333333333',
  frames: [{ kind: 'system', id: 'poller' }],
}

type StoredJob = QueuedJob<{ value: number }> & { attemptCount?: number }

describe('Queue - local strategy causation', () => {
  const previousFlag = process.env.OM_CAUSATION
  let baseDir: string

  function readJobs(queueName: string): StoredJob[] {
    return JSON.parse(fs.readFileSync(path.join(baseDir, queueName, 'queue.json'), 'utf8'))
  }

  beforeEach(() => {
    delete process.env.OM_CAUSATION
    reportDegradation.mockClear()
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-causation-'))
  })

  afterEach(() => {
    jest.restoreAllMocks()
    resetTelemetryRuntime()
    try { fs.rmSync(baseDir, { recursive: true, force: true }) } catch {}
  })

  afterAll(() => {
    if (previousFlag === undefined) delete process.env.OM_CAUSATION
    else process.env.OM_CAUSATION = previousFlag
  })

  it('attaches the enqueuer envelope and restores it in the handler instead of the poller context', async () => {
    const queue = createLocalQueue<{ value: number }>('causation-queue', { baseDir })
    await runWithCausation(ENQUEUER, () => queue.enqueue({ value: 1 }))

    const [stored] = readJobs('causation-queue')
    expect(stored.metadata).toEqual({ _causation: ENQUEUER })

    const seen: Array<CausationEnvelope | null> = []
    const result = await runWithCausation(POLLER, () =>
      queue.process(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1))
        seen.push(getAmbientCausation())
      }, { limit: 10 }),
    )

    expect(result).toEqual({ processed: 1, failed: 0, lastJobId: stored.id })
    expect(seen).toEqual([ENQUEUER])
    expect(reportDegradation).not.toHaveBeenCalled()
    await queue.close()
  })

  it('carries causation alongside the trace carrier when telemetry is active', async () => {
    const carriers: Array<Record<string, string> | undefined> = []
    registerTelemetryRuntime({
      canUseGlobalTracePropagation: () => false,
      captureTraceContext: () => ({ traceparent: 'local-carrier' }),
      continueTrace: (carrier, _name, fn) => {
        carriers.push(carrier)
        return fn()
      },
      recordHttpDuration: () => {},
      reportError: () => {},
      shutdown: async () => {},
    })
    const queue = createLocalQueue<{ value: number }>('traced-queue', { baseDir })
    await runWithCausation(ENQUEUER, () => queue.enqueue({ value: 2 }))

    const [stored] = readJobs('traced-queue')
    expect(stored.metadata).toEqual({ _trace: { traceparent: 'local-carrier' }, _causation: ENQUEUER })

    const seen: Array<CausationEnvelope | null> = []
    await queue.process(() => { seen.push(getAmbientCausation()) }, { limit: 10 })

    expect(carriers).toEqual([{ traceparent: 'local-carrier' }])
    expect(seen).toEqual([ENQUEUER])
    await queue.close()
  })

  it('runs a job without causation metadata under a marked unknown entry and reports the degradation', async () => {
    const queue = createLocalQueue<{ value: number }>('legacy-queue', { baseDir })
    await queue.enqueue({ value: 3 })

    const [stored] = readJobs('legacy-queue')
    expect(stored).not.toHaveProperty('metadata')

    const seen: Array<CausationEnvelope | null> = []
    await runWithCausation(POLLER, () =>
      queue.process(() => { seen.push(getAmbientCausation()) }, { limit: 10 }),
    )

    expect(seen).toHaveLength(1)
    expect(seen[0]?.frames).toEqual(MISSING_ENTRY)
    expect(seen[0]?.correlationId).not.toBe(POLLER.correlationId)
    expect(seen[0]?.correlationId).not.toBe(ENQUEUER.correlationId)
    expect(reportDegradation).toHaveBeenCalledTimes(1)
    expect(reportDegradation).toHaveBeenCalledWith('queue_missing_envelope', { queue: 'legacy-queue' })
    await queue.close()
  })

  it('runs a job with a corrupted stored envelope under a marked unknown entry and reports it as invalid', async () => {
    const queue = createLocalQueue<{ value: number }>('corrupted-queue', { baseDir })
    await runWithCausation(ENQUEUER, () => queue.enqueue({ value: 3 }))
    const [stored] = readJobs('corrupted-queue')
    fs.writeFileSync(
      path.join(baseDir, 'corrupted-queue', 'queue.json'),
      JSON.stringify([{ ...stored, metadata: { _causation: { correlationId: '', frames: [] } } }]),
    )

    const seen: Array<CausationEnvelope | null> = []
    await queue.process(() => { seen.push(getAmbientCausation()) }, { limit: 10 })

    expect(seen).toHaveLength(1)
    expect(seen[0]?.frames).toEqual([{ kind: 'unknown', ref: 'queue:invalid_causation' }])
    expect(seen[0]?.correlationId).not.toBe(ENQUEUER.correlationId)
    expect(reportDegradation).toHaveBeenCalledTimes(1)
    expect(reportDegradation).toHaveBeenCalledWith('queue_invalid_envelope', { queue: 'corrupted-queue' })
    await queue.close()
  })

  it('isolates the causation of consecutive jobs in one batch', async () => {
    const queue = createLocalQueue<{ value: number }>('mixed-queue', { baseDir })
    await runWithCausation(ENQUEUER, () => queue.enqueue({ value: 1 }))
    await queue.enqueue({ value: 2 })

    const seen = new Map<number, CausationEnvelope | null>()
    await queue.process((job) => { seen.set(job.payload.value, getAmbientCausation()) }, { limit: 10 })

    expect(seen.get(1)).toEqual(ENQUEUER)
    expect(seen.get(2)?.frames).toEqual(MISSING_ENTRY)
    expect(getAmbientCausation()).toBeNull()
    await queue.close()
  })

  it('keeps failure accounting unchanged and preserves causation on the retried job', async () => {
    const queue = createLocalQueue<{ value: number }>('failing-queue', { baseDir })
    await runWithCausation(ENQUEUER, () => queue.enqueue({ value: 4 }))

    const seen: Array<CausationEnvelope | null> = []
    const result = await queue.process(() => {
      seen.push(getAmbientCausation())
      throw new Error('[internal] boom')
    }, { limit: 10 })

    expect(result.processed).toBe(0)
    expect(result.failed).toBe(1)
    expect(seen).toEqual([ENQUEUER])
    const [retried] = readJobs('failing-queue')
    expect(retried.attemptCount).toBe(1)
    expect(retried.metadata).toEqual({ _causation: ENQUEUER })
    await queue.close()
  })

  it('attaches and restores nothing when the kill switch is off', async () => {
    process.env.OM_CAUSATION = 'off'
    const queue = createLocalQueue<{ value: number }>('disabled-queue', { baseDir })
    await runWithCausation(ENQUEUER, () => queue.enqueue({ value: 5 }))

    const [stored] = readJobs('disabled-queue')
    expect(stored).not.toHaveProperty('metadata')

    const seen: Array<CausationEnvelope | null> = []
    await runWithCausation(POLLER, () =>
      queue.process(() => { seen.push(getAmbientCausation()) }, { limit: 10 }),
    )

    expect(seen).toEqual([null])
    expect(reportDegradation).not.toHaveBeenCalled()
    await queue.close()
  })

  it('creates the long-lived poller, retry timer and file watcher outside the caller causation context', async () => {
    const realSetTimeout = global.setTimeout
    const realSetInterval = global.setInterval
    const realWatch = fs.watch
    const retryTimerCreated: Array<CausationEnvelope | null> = []
    const retryTimerFired: Array<CausationEnvelope | null> = []
    const pollerCreated: Array<CausationEnvelope | null> = []
    const watcherCreated: Array<CausationEnvelope | null> = []

    jest.spyOn(global, 'setTimeout').mockImplementation(((callback: TimerCallback, delay?: number, ...args: unknown[]) => {
      if (delay !== DETACHED_POLL_INTERVAL) return realSetTimeout(callback, delay, ...args)
      retryTimerCreated.push(getAmbientCausation())
      return realSetTimeout(() => {
        retryTimerFired.push(getAmbientCausation())
        callback(...args)
      }, delay)
    }) as unknown as typeof setTimeout)
    jest.spyOn(global, 'setInterval').mockImplementation(((callback: TimerCallback, delay?: number, ...args: unknown[]) => {
      pollerCreated.push(getAmbientCausation())
      return realSetInterval(callback, delay, ...args)
    }) as unknown as typeof setInterval)
    jest.spyOn(fs, 'watch').mockImplementation(((...args: Parameters<typeof fs.watch>) => {
      watcherCreated.push(getAmbientCausation())
      return realWatch(...args)
    }) as typeof fs.watch)

    const queue = createLocalQueue<{ value: number }>('detached-queue', {
      baseDir,
      pollInterval: DETACHED_POLL_INTERVAL,
    })
    await queue.enqueue({ value: 6 }, { delayMs: 60_000 })

    const handled: number[] = []
    await runWithCausation(ENQUEUER, async () => {
      const result = await queue.process((job) => { handled.push(job.payload.value) })
      expect(result).toEqual({ processed: -1, failed: -1, lastJobId: undefined })
      expect(getAmbientCausation()).toEqual(ENQUEUER)
    })
    await new Promise((resolve) => realSetTimeout(resolve, DETACHED_POLL_INTERVAL * 3))
    await queue.close()

    expect(handled).toEqual([])
    expect(watcherCreated).toEqual([null])
    expect(pollerCreated).toEqual([null])
    expect(retryTimerCreated.length).toBeGreaterThan(0)
    expect(retryTimerCreated.every((envelope) => envelope === null)).toBe(true)
    expect(retryTimerFired.length).toBeGreaterThan(0)
    expect(retryTimerFired.every((envelope) => envelope === null)).toBe(true)
  })
})
