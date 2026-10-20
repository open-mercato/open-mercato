import { createQueue } from '../factory'
import type { QueuedJob } from '../types'
import { getRedisUrlOrThrow } from '@open-mercato/shared/lib/redis/connection'
import {
  getAmbientCausation,
  runWithCausation,
  type CausationEnvelope,
} from '@open-mercato/shared/lib/causation/server'
import {
  registerTelemetryRuntime,
  resetTelemetryRuntime,
} from '@open-mercato/shared/lib/telemetry/runtime'

type Payload = { value: number }
type BullJob = { id?: string; data: QueuedJob<Payload>; attemptsMade: number }
type Processor = (job: BullJob) => Promise<void>

const queueAdd = jest.fn(async (_name: string, _data: QueuedJob<Payload>, _opts?: unknown) => ({ id: 'bull-job-id' }))
const workerCtor = jest.fn((_name: string, _processor: Processor, _opts: unknown) => undefined)

jest.mock('@open-mercato/shared/lib/redis/connection', () => ({
  getRedisUrlOrThrow: jest.fn(),
  parseRedisUrl: jest.requireActual('@open-mercato/shared/lib/redis/connection').parseRedisUrl,
}))

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

jest.mock('bullmq', () => {
  class MockQueue {
    add = (name: string, data: QueuedJob<Payload>, opts?: unknown) => queueAdd(name, data, opts)
    close = jest.fn(async () => {})
    obliterate = jest.fn(async () => {})
    getJobCounts = jest.fn(async () => ({ waiting: 0, active: 0, completed: 0, failed: 0 }))
    getJobs = jest.fn(async () => [])
  }
  class MockWorker {
    constructor(name: string, processor: Processor, opts: unknown) {
      workerCtor(name, processor, opts)
    }
    on = jest.fn()
    close = jest.fn(async () => {})
  }
  return { Queue: MockQueue, Worker: MockWorker }
})

class MockBullMQOtel {
  constructor(public readonly tracerName: string) {}
}
jest.mock('bullmq-otel', () => ({ BullMQOtel: MockBullMQOtel }))

const ENQUEUER: CausationEnvelope = {
  correlationId: '11111111-1111-4111-8111-111111111111',
  frames: [{ kind: 'api_key', id: 'key-1' }, { kind: 'business_rule', id: 'rule-1', ref: 'run-1' }],
}

const POLLER: CausationEnvelope = {
  correlationId: '33333333-3333-4333-8333-333333333333',
  frames: [{ kind: 'system', id: 'poller' }],
}

const FORGED: CausationEnvelope = {
  correlationId: '44444444-4444-4444-8444-444444444444',
  frames: [{ kind: 'workflow', id: 'forged' }],
}

function registerRuntime(options: { globalPropagation: boolean; carrier: Record<string, string> }): string[] {
  const continued: string[] = []
  registerTelemetryRuntime({
    canUseGlobalTracePropagation: () => options.globalPropagation,
    captureTraceContext: () => options.carrier,
    continueTrace: (_carrier, name, fn) => {
      continued.push(name)
      return fn()
    },
    recordHttpDuration: () => {},
    reportError: () => {},
    shutdown: async () => {},
  })
  return continued
}

function lastEnqueuedJob(): QueuedJob<Payload> {
  const call = queueAdd.mock.calls[queueAdd.mock.calls.length - 1]
  if (!call) throw new Error('[internal] nothing was enqueued')
  return call[1]
}

function lastProcessor(): Processor {
  const call = workerCtor.mock.calls[workerCtor.mock.calls.length - 1]
  if (!call) throw new Error('[internal] no worker was created')
  return call[1]
}

function bullJob(data: QueuedJob<Payload>): BullJob {
  return { id: 'bull-job-id', data, attemptsMade: 0 }
}

describe('Queue - async strategy causation', () => {
  const previousFlag = process.env.OM_CAUSATION

  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.OM_CAUSATION
    ;(getRedisUrlOrThrow as jest.MockedFunction<typeof getRedisUrlOrThrow>).mockReturnValue('redis://localhost:6379/0')
  })

  afterEach(() => {
    resetTelemetryRuntime()
  })

  afterAll(() => {
    if (previousFlag === undefined) delete process.env.OM_CAUSATION
    else process.env.OM_CAUSATION = previousFlag
  })

  it('attaches causation without telemetry and restores it in the worker instead of the poller context', async () => {
    const queue = createQueue<Payload>('plain-queue', 'async')
    await runWithCausation(ENQUEUER, () => queue.enqueue({ value: 1 }))

    const stored = lastEnqueuedJob()
    expect(stored.metadata).toEqual({ _causation: ENQUEUER })

    const seen: Array<CausationEnvelope | null> = []
    await runWithCausation(POLLER, () =>
      queue.process(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1))
        seen.push(getAmbientCausation())
      }),
    )
    await runWithCausation(POLLER, () => lastProcessor()(bullJob(stored)))

    expect(seen).toEqual([ENQUEUER])
  })

  it('attaches causation next to the built-in trace carrier', async () => {
    const continued = registerRuntime({ globalPropagation: false, carrier: { traceparent: 'async-carrier' } })
    const queue = createQueue<Payload>('carrier-queue', 'async')
    await runWithCausation(ENQUEUER, () => queue.enqueue({ value: 2 }))

    const stored = lastEnqueuedJob()
    expect(stored.metadata).toEqual({ _trace: { traceparent: 'async-carrier' }, _causation: ENQUEUER })

    const seen: Array<CausationEnvelope | null> = []
    await queue.process(async () => { seen.push(getAmbientCausation()) })
    await lastProcessor()(bullJob(stored))

    expect(continued).toEqual(['queue.carrier-queue'])
    expect(seen).toEqual([ENQUEUER])
  })

  it('attaches causation even when bullmq-otel owns trace propagation and skips the carrier', async () => {
    const continued = registerRuntime({ globalPropagation: true, carrier: { traceparent: 'ignored' } })
    const queue = createQueue<Payload>('otel-queue', 'async')
    await runWithCausation(ENQUEUER, () => queue.enqueue({ value: 3 }))

    const stored = lastEnqueuedJob()
    expect(stored.metadata).toEqual({ _causation: ENQUEUER })

    const seen: Array<CausationEnvelope | null> = []
    await queue.process(async () => { seen.push(getAmbientCausation()) })
    await runWithCausation(POLLER, () => lastProcessor()(bullJob(stored)))

    expect(continued).toEqual([])
    expect(seen).toEqual([ENQUEUER])
  })

  it('omits metadata entirely when there is neither a trace carrier nor ambient causation', async () => {
    const queue = createQueue<Payload>('empty-queue', 'async')
    await queue.enqueue({ value: 4 })
    expect(lastEnqueuedJob()).not.toHaveProperty('metadata')
  })

  it('runs a job without causation metadata under a fresh unknown entry, never the poller context', async () => {
    const queue = createQueue<Payload>('legacy-queue', 'async')
    const seen: Array<CausationEnvelope | null> = []
    await runWithCausation(POLLER, () => queue.process(async () => { seen.push(getAmbientCausation()) }))

    const legacyJob: QueuedJob<Payload> = { id: 'legacy-1', payload: { value: 5 }, createdAt: new Date().toISOString() }
    await runWithCausation(POLLER, () => lastProcessor()(bullJob(legacyJob)))
    await runWithCausation(ENQUEUER, () =>
      lastProcessor()(bullJob({ ...legacyJob, metadata: { _causation: { correlationId: '', frames: [] } } })),
    )

    expect(seen).toHaveLength(2)
    expect(seen[0]?.frames).toEqual([{ kind: 'unknown', ref: 'queue:missing_causation' }])
    expect(seen[1]?.frames).toEqual([{ kind: 'unknown', ref: 'queue:invalid_causation' }])
    for (const envelope of seen) {
      expect(envelope?.correlationId).not.toBe(POLLER.correlationId)
      expect(envelope?.correlationId).not.toBe(ENQUEUER.correlationId)
    }
  })

  it('isolates concurrently processed jobs from each other', async () => {
    const queue = createQueue<Payload>('concurrent-queue', 'async', { concurrency: 2 })
    const seen = new Map<number, CausationEnvelope | null>()
    await queue.process(async (job) => {
      await new Promise((resolve) => setTimeout(resolve, job.payload.value === 1 ? 5 : 1))
      seen.set(job.payload.value, getAmbientCausation())
    })
    const processor = lastProcessor()
    const first: QueuedJob<Payload> = {
      id: 'job-1',
      payload: { value: 1 },
      createdAt: new Date().toISOString(),
      metadata: { _causation: ENQUEUER },
    }
    const second: QueuedJob<Payload> = {
      id: 'job-2',
      payload: { value: 2 },
      createdAt: new Date().toISOString(),
      metadata: { _causation: FORGED },
    }

    await Promise.all([processor(bullJob(first)), processor(bullJob(second))])

    expect(seen.get(1)).toEqual(ENQUEUER)
    expect(seen.get(2)).toEqual(FORGED)
  })

  it('propagates handler failures unchanged so BullMQ keeps its retry semantics', async () => {
    const queue = createQueue<Payload>('failing-queue', 'async')
    const failure = new Error('[internal] handler failed')
    await queue.process(async () => { throw failure })

    await expect(lastProcessor()(bullJob({
      id: 'job-1',
      payload: { value: 6 },
      createdAt: new Date().toISOString(),
      metadata: { _causation: ENQUEUER },
    }))).rejects.toBe(failure)
  })

  it('attaches and restores nothing when the kill switch is off', async () => {
    process.env.OM_CAUSATION = 'off'
    const queue = createQueue<Payload>('disabled-queue', 'async')
    await runWithCausation(ENQUEUER, () => queue.enqueue({ value: 7 }))
    expect(lastEnqueuedJob()).not.toHaveProperty('metadata')

    const seen: Array<CausationEnvelope | null> = []
    await queue.process(async () => { seen.push(getAmbientCausation()) })
    await runWithCausation(POLLER, () =>
      lastProcessor()(bullJob({
        id: 'job-1',
        payload: { value: 7 },
        createdAt: new Date().toISOString(),
        metadata: { _causation: ENQUEUER },
      })),
    )

    expect(seen).toEqual([null])
  })
})
