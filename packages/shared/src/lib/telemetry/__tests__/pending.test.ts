import {
  createBoundedPendingOperationTracker,
  DEFAULT_MAX_PENDING_OPERATIONS,
  parsePendingOperationCapacity,
} from '../pending'
import {
  collectTelemetryMetrics,
  registerTelemetryRuntime,
  resetTelemetryMetricCollectors,
  resetTelemetryRuntime,
  type TelemetryMetricPoint,
  type TelemetryRuntime,
} from '../runtime'

function createRuntime(recordMetric: (point: TelemetryMetricPoint) => void): TelemetryRuntime {
  return {
    canUseGlobalTracePropagation: () => true,
    captureTraceContext: () => ({}),
    continueTrace: (_carrier, _name, operation) => operation(),
    recordMetric,
    recordHttpDuration: () => {},
    reportError: () => {},
    shutdown: async () => {},
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

describe('parsePendingOperationCapacity', () => {
  it('accepts positive integers', () => {
    expect(parsePendingOperationCapacity('1')).toBe(1)
    expect(parsePendingOperationCapacity('512')).toBe(512)
  })

  it.each([undefined, '', '0', '-1', '1.5', 'not-a-number'])('uses the default for %p', (raw) => {
    expect(parsePendingOperationCapacity(raw)).toBe(DEFAULT_MAX_PENDING_OPERATIONS)
  })
})

describe('createBoundedPendingOperationTracker', () => {
  afterEach(() => {
    resetTelemetryMetricCollectors()
    resetTelemetryRuntime()
  })

  it('reserves capacity before invoking the factory and rejects newest work', async () => {
    const active = deferred<void>()
    const firstFactory = jest.fn(() => active.promise)
    const rejectedFactory = jest.fn(async () => 'should-not-run')
    const tracker = createBoundedPendingOperationTracker({ capacity: 1, stage: 'test' })

    const first = tracker.tryStart(firstFactory)
    const rejected = tracker.tryStart(rejectedFactory)

    expect(first.accepted).toBe(true)
    expect(rejected).toEqual({ accepted: false, pending: 1 })
    expect(firstFactory).toHaveBeenCalledTimes(1)
    expect(rejectedFactory).not.toHaveBeenCalled()
    expect(tracker.pending).toBe(1)
    expect(tracker.dropped).toBe(1)

    active.resolve()
    await tracker.flush()
    expect(tracker.pending).toBe(0)
  })

  it('turns synchronous factory failures into tracked rejected promises', async () => {
    const failure = new Error('[internal] failed synchronously')
    const tracker = createBoundedPendingOperationTracker({ capacity: 1, stage: 'test' })
    const admission = tracker.tryStart(() => {
      throw failure
    })

    expect(admission.accepted).toBe(true)
    if (!admission.accepted) throw new Error('[internal] expected operation admission')
    await expect(admission.promise).rejects.toBe(failure)
    await tracker.flush()
    expect(tracker.pending).toBe(0)
  })

  it('drains settlement waves including work admitted while an earlier wave settles', async () => {
    const firstGate = deferred<void>()
    const secondGate = deferred<void>()
    const tracker = createBoundedPendingOperationTracker({ capacity: 2, stage: 'test' })
    const first = tracker.tryStart(async () => {
      await firstGate.promise
      tracker.tryStart(() => secondGate.promise)
    })
    if (!first.accepted) throw new Error('[internal] expected operation admission')

    const flushing = tracker.flush()
    firstGate.resolve()
    await first.promise
    let flushed = false
    void flushing.then(() => {
      flushed = true
    })
    await Promise.resolve()
    expect(flushed).toBe(false)

    secondGate.resolve()
    await flushing
    expect(tracker.pending).toBe(0)
  })

  it('records exact pending, age, zero, and dropped metric points', async () => {
    const points: TelemetryMetricPoint[] = []
    registerTelemetryRuntime(createRuntime((point) => points.push(point)))
    let currentTime = 1_000
    const active = deferred<void>()
    const tracker = createBoundedPendingOperationTracker({
      capacity: 1,
      stage: 'service_write',
      now: () => currentTime,
    })

    tracker.tryStart(() => active.promise)
    currentTime = 3_500
    collectTelemetryMetrics()
    tracker.tryStart(async () => undefined)

    expect(points).toContainEqual({
      kind: 'gauge',
      name: 'om.audit_logs.pending_writes',
      value: 1,
      labels: { stage: 'service_write' },
      unit: '{task}',
    })
    expect(points).toContainEqual({
      kind: 'gauge',
      name: 'om.audit_logs.oldest_pending_age',
      value: 2.5,
      labels: { stage: 'service_write' },
      unit: 's',
    })
    expect(points).toContainEqual({
      kind: 'counter',
      name: 'om.audit_logs.dropped',
      value: 1,
      labels: { stage: 'service_write', reason: 'capacity' },
      unit: '{task}',
    })

    active.resolve()
    await tracker.flush()
    expect(points.slice(-2)).toEqual([
      {
        kind: 'gauge',
        name: 'om.audit_logs.pending_writes',
        value: 0,
        labels: { stage: 'service_write' },
        unit: '{task}',
      },
      {
        kind: 'gauge',
        name: 'om.audit_logs.oldest_pending_age',
        value: 0,
        labels: { stage: 'service_write' },
        unit: 's',
      },
    ])
  })

  it('rate-limits drop notifications without suppressing dropped metrics', async () => {
    const points: TelemetryMetricPoint[] = []
    registerTelemetryRuntime(createRuntime((point) => points.push(point)))
    let currentTime = 0
    const onDrop = jest.fn()
    const active = deferred<void>()
    const tracker = createBoundedPendingOperationTracker({
      capacity: 1,
      stage: 'crud_dispatch',
      now: () => currentTime,
      onDrop,
    })
    tracker.tryStart(() => active.promise)

    tracker.tryStart(async () => undefined)
    currentTime = 59_999
    tracker.tryStart(async () => undefined)
    currentTime = 60_000
    tracker.tryStart(async () => undefined)

    expect(onDrop).toHaveBeenCalledTimes(2)
    expect(points.filter((point) => point.name === 'om.audit_logs.dropped')).toHaveLength(3)
    active.resolve()
    await tracker.flush()
  })

  it('stops collection after disposal', async () => {
    const points: TelemetryMetricPoint[] = []
    registerTelemetryRuntime(createRuntime((point) => points.push(point)))
    const active = deferred<void>()
    const tracker = createBoundedPendingOperationTracker({ capacity: 1, stage: 'test' })
    tracker.tryStart(() => active.promise)
    tracker.dispose()

    collectTelemetryMetrics()
    expect(points).toEqual([])

    active.resolve()
    await tracker.flush()
  })
})
