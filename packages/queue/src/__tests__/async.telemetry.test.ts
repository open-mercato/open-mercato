// An OTLP backend must be active for the async strategy to delegate tracing to
// bullmq-otel. Set before any module reads the (memoized) telemetry env, and
// restored afterwards — process.env is shared across test files in the same
// jest worker, and a leaked 'otlp' backend breaks sibling telemetry tests.
const originalTelemetryBackend = process.env.TELEMETRY_BACKEND
process.env.TELEMETRY_BACKEND = 'otlp'

afterAll(() => {
  if (originalTelemetryBackend === undefined) delete process.env.TELEMETRY_BACKEND
  else process.env.TELEMETRY_BACKEND = originalTelemetryBackend
})

import { createQueue } from '../factory'
import { getRedisUrlOrThrow } from '@open-mercato/shared/lib/redis/connection'
import {
  registerTelemetryRuntime,
  resetTelemetryRuntime,
} from '@open-mercato/shared/lib/telemetry/runtime'

const queueCtor = jest.fn()
const workerCtor = jest.fn()
const queueAdd = jest.fn(async () => ({ id: 'bull-job-id' }))

jest.mock('@open-mercato/shared/lib/redis/connection', () => ({
  getRedisUrlOrThrow: jest.fn(),
}))

jest.mock('bullmq', () => {
  class MockQueue<T> {
    constructor(name: string, opts: unknown) {
      queueCtor(name, opts)
    }
    add = queueAdd as unknown as (name: string, data: T, opts?: unknown) => Promise<{ id?: string }>
    close = jest.fn(async () => {})
    obliterate = jest.fn(async () => {})
    getJobCounts = jest.fn(async () => ({ waiting: 0, active: 0, completed: 0, failed: 0 }))
  }
  class MockWorker<T> {
    constructor(
      name: string,
      _processor: (job: { id?: string; data: T; attemptsMade: number }) => Promise<void>,
      opts: unknown,
    ) {
      workerCtor(name, _processor, opts)
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

describe('Queue - async strategy telemetry wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getRedisUrlOrThrow as jest.MockedFunction<typeof getRedisUrlOrThrow>).mockReturnValue(
      'rediss://default:secret@example.com:6380/1',
    )
    registerTelemetryRuntime({
      canUseGlobalTracePropagation: () => true,
      captureTraceContext: () => ({}),
      continueTrace: (_carrier, _name, fn) => fn(),
      recordHttpDuration: () => {},
      reportError: () => {},
      shutdown: async () => {},
    })
  })

  afterEach(() => {
    resetTelemetryRuntime()
  })

  it('wires bullmq-otel into BOTH the queue and worker when they resolve concurrently', async () => {
    const queue = createQueue<{ value: number }>('trace-queue', 'async', { concurrency: 3 })

    // Resolve enqueue (Queue) and process (Worker) concurrently: both hit the
    // shared telemetry resolution at once. The memoized in-flight promise must
    // hand both the SAME bullmq-otel instance — never one with, one without.
    await Promise.all([queue.enqueue({ value: 1 }), queue.process(async () => {})])

    const queueOpts = queueCtor.mock.calls[0]?.[1] as { telemetry?: unknown }
    const workerOpts = workerCtor.mock.calls[0]?.[2] as { telemetry?: unknown }
    expect(queueOpts.telemetry).toBeInstanceOf(MockBullMQOtel)
    expect(workerOpts.telemetry).toBeInstanceOf(MockBullMQOtel)
    expect(queueOpts.telemetry).toBe(workerOpts.telemetry)
  })

  it('omits the metadata._trace carrier when bullmq-otel owns propagation', async () => {
    const queue = createQueue<{ value: number }>('trace-queue', 'async')

    await queue.enqueue({ value: 42 })

    const jobData = queueAdd.mock.calls[0]?.[1] as Record<string, unknown>
    expect(jobData).not.toHaveProperty('metadata')
  })

  it('uses the dedicated carrier when global propagation is not explicitly trusted', async () => {
    resetTelemetryRuntime()
    registerTelemetryRuntime({
      canUseGlobalTracePropagation: () => false,
      captureTraceContext: () => ({ traceparent: 'secure-carrier' }),
      continueTrace: (_carrier, _name, fn) => fn(),
      recordHttpDuration: () => {},
      reportError: () => {},
      shutdown: async () => {},
    })
    const queue = createQueue<{ value: number }>('secure-trace-queue', 'async')

    await queue.enqueue({ value: 7 })

    const queueOpts = queueCtor.mock.calls[0]?.[1] as { telemetry?: unknown }
    const jobData = queueAdd.mock.calls[0]?.[1] as {
      metadata?: { _trace?: { traceparent?: string } }
    }
    expect(queueOpts.telemetry).toBeUndefined()
    expect(jobData.metadata?._trace?.traceparent).toBe('secure-carrier')
  })
})
