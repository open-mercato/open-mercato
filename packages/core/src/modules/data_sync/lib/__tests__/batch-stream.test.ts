import {
  registerTelemetryRuntime,
  resetTelemetryRuntime,
  type TelemetryRuntime,
  type TelemetrySpanOptions,
} from '@open-mercato/shared/lib/telemetry/runtime'
import { forEachBatch } from '../batch-stream'

type RecordedSpan = {
  name: string
  options?: TelemetrySpanOptions
  attributes: Record<string, string | number | boolean | undefined>
}

/**
 * Records what the engine asked for without pulling in the telemetry package —
 * exactly the seam `withTelemetrySpan` exists to provide.
 */
function recordingRuntime(): { spans: RecordedSpan[]; dispose: () => void } {
  const spans: RecordedSpan[] = []
  const runtime: TelemetryRuntime = {
    canUseGlobalTracePropagation: () => false,
    captureTraceContext: () => ({ traceparent: 'run-carrier' }),
    continueTrace: (_carrier, _name, fn) => fn(),
    withSpan: (name, fn, options) => {
      const recorded: RecordedSpan = { name, options, attributes: {} }
      spans.push(recorded)
      return fn({
        setAttributes(attributes) {
          Object.assign(recorded.attributes, attributes)
        },
      })
    },
    recordHttpDuration: () => {},
    reportError: () => {},
    shutdown: async () => {},
  }
  return { spans, dispose: registerTelemetryRuntime(runtime) }
}

/** A generator shaped like an adapter's `streamImport`: cleanup lives in `finally`. */
function batchStream(count: number, onClose: () => void) {
  return (async function* () {
    try {
      for (let index = 0; index < count; index += 1) yield { index }
    } finally {
      onClose()
    }
  })()
}

afterEach(() => {
  resetTelemetryRuntime()
})

describe('forEachBatch adapter-stream lifecycle', () => {
  it('runs every batch and reports completion when the adapter is exhausted', async () => {
    const closed = jest.fn()
    const seen: number[] = []

    const result = await forEachBatch(
      batchStream(3, closed),
      { spanName: 'data_sync.import.batch' },
      async (batch: { index: number }) => {
        seen.push(batch.index)
        return 'continue'
      },
    )

    expect(result).toBe('completed')
    expect(seen).toEqual([0, 1, 2])
    expect(closed).toHaveBeenCalledTimes(1)
  })

  it('closes the adapter stream when a handler stops it early (cancellation)', async () => {
    const closed = jest.fn()
    const seen: number[] = []

    const result = await forEachBatch(
      batchStream(5, closed),
      { spanName: 'data_sync.import.batch' },
      async (batch: { index: number }) => {
        seen.push(batch.index)
        return batch.index === 1 ? 'stop' : 'continue'
      },
    )

    expect(result).toBe('stopped')
    expect(seen).toEqual([0, 1])
    // `for await` ran adapter `finally` blocks on an early exit; driving the
    // iterator by hand must not regress that.
    expect(closed).toHaveBeenCalledTimes(1)
  })

  it('closes the adapter stream and rethrows when a handler throws', async () => {
    const closed = jest.fn()

    await expect(
      forEachBatch(batchStream(5, closed), { spanName: 'data_sync.import.batch' }, async () => {
        throw new Error('commit failed')
      }),
    ).rejects.toThrow('commit failed')

    expect(closed).toHaveBeenCalledTimes(1)
  })

  it('lets the handler error win when closing the stream also fails', async () => {
    const stream = (async function* () {
      try {
        yield { index: 0 }
      } finally {
        throw new Error('cleanup exploded')
      }
    })()

    await expect(
      forEachBatch(stream, { spanName: 'data_sync.import.batch' }, async () => {
        throw new Error('commit failed')
      }),
    ).rejects.toThrow('commit failed')
  })

  it('surfaces a close failure when a handler stops the stream early', async () => {
    // `for await` propagates an `IteratorClose` failure on a `break`, because
    // there is no in-flight error for it to mask. An adapter whose teardown
    // fails while cancelling must not be reduced to a log line.
    const stream = (async function* () {
      try {
        yield { index: 0 }
        yield { index: 1 }
      } finally {
        throw new Error('cleanup exploded')
      }
    })()

    await expect(
      forEachBatch(stream, { spanName: 'data_sync.import.batch' }, async () => 'stop'),
    ).rejects.toThrow('cleanup exploded')
  })

  it('does not close an iterator that already completed itself', async () => {
    // Neither exhaustion nor a throwing `next()` triggers `return()` under
    // `for await` — the iterator is already done in both cases.
    const returned = jest.fn(async () => ({ value: undefined, done: true }) as IteratorResult<never>)

    const exhausting = {
      [Symbol.asyncIterator]() {
        return this
      },
      async next() {
        return { value: undefined, done: true } as IteratorResult<never>
      },
      return: returned,
    }
    await forEachBatch(exhausting, { spanName: 'data_sync.import.batch' }, async () => 'continue')
    expect(returned).not.toHaveBeenCalled()

    const failingRead = {
      [Symbol.asyncIterator]() {
        return this
      },
      async next(): Promise<IteratorResult<never>> {
        throw new Error('read failed')
      },
      return: returned,
    }
    await expect(
      forEachBatch(failingRead, { spanName: 'data_sync.import.batch' }, async () => 'continue'),
    ).rejects.toThrow('read failed')
    expect(returned).not.toHaveBeenCalled()
  })

  it('runs without telemetry registered', async () => {
    const closed = jest.fn()
    const result = await forEachBatch(
      batchStream(2, closed),
      { spanName: 'data_sync.import.batch' },
      async () => 'continue',
    )

    expect(result).toBe('completed')
    expect(closed).toHaveBeenCalledTimes(1)
  })
})

describe('forEachBatch span shape', () => {
  it('roots every batch span and links it back to the run', async () => {
    const { spans, dispose } = recordingRuntime()
    try {
      await forEachBatch(
        batchStream(2, () => {}),
        {
          spanName: 'data_sync.import.batch',
          attributes: { 'data_sync.run_id': 'run-1' },
          linkTo: { traceparent: 'run-carrier' },
        },
        async (batch: { index: number }, span) => {
          span.setAttributes({ 'data_sync.batch_index': batch.index })
          return 'continue'
        },
      )
    } finally {
      dispose()
    }

    // Two batches plus the `next()` that discovers the stream is exhausted —
    // that call does real adapter work, so it is traced too.
    expect(spans).toHaveLength(3)
    for (const span of spans) {
      expect(span.name).toBe('data_sync.import.batch')
      // Each batch starting its own trace is the point: a multi-day run must not
      // ride on the single sampling decision taken for its trigger.
      expect(span.options?.root).toBe(true)
      expect(span.options?.links).toEqual([{ traceparent: 'run-carrier' }])
      expect(span.options?.attributes).toEqual({ 'data_sync.run_id': 'run-1' })
    }
    expect(spans[0]?.attributes['data_sync.batch_index']).toBe(0)
    expect(spans[1]?.attributes['data_sync.batch_index']).toBe(1)
  })

  it('omits links when the run has no trace to link to (telemetry off at capture time)', async () => {
    const { spans, dispose } = recordingRuntime()
    try {
      await forEachBatch(
        batchStream(1, () => {}),
        { spanName: 'data_sync.export.batch' },
        async () => 'continue',
      )
    } finally {
      dispose()
    }

    expect(spans[0]?.options?.links).toBeUndefined()
  })
})
