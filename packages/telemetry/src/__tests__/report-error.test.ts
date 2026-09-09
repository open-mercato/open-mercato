import { reportError } from '../index'
import {
  resetLoggerExtension,
  resetLoggerRegistry,
} from '@open-mercato/shared/lib/logger'
import { resetTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { initTelemetry, resetTelemetryInit } from '../init'
import { registerProvider, resetActiveProvider } from '../provider/registry'
import { resetTelemetryEnvCache } from '../env'
import { runSpan } from '../provider/run-span'
import type { Attributes, LogRecord, MetricPoint, Span, SpanOptions, TelemetryProvider, TraceCarrier } from '../types'

type ReportedError = {
  error: NonNullable<LogRecord['error']>
  context: { module?: string; code?: string; attributes?: Attributes }
}

class RecordingSpan implements Span {
  attributes: Record<string, unknown> = {}
  exceptions: unknown[] = []
  status: 'ok' | 'error' = 'ok'
  setAttribute(key: string, value: string | number | boolean): void {
    this.attributes[key] = value
  }
  setAttributes(attributes: Record<string, string | number | boolean | undefined>): void {
    Object.assign(this.attributes, attributes)
  }
  recordException(error: unknown): void {
    this.exceptions.push(error)
  }
  setStatus(status: 'ok' | 'error'): void {
    this.status = status
  }
  end(): void {}
}

/**
 * `withErrorSink` opts the provider into the optional `reportError` hook, so one
 * harness covers both a provider that implements it and a provider that predates
 * it (the third-party compatibility case the contract exists to protect).
 */
function recordingProvider(options?: { withErrorSink?: boolean; onReportError?: () => void }) {
  const span = new RecordingSpan()
  const logs: LogRecord[] = []
  const metrics: MetricPoint[] = []
  const reported: ReportedError[] = []
  const provider: TelemetryProvider = {
    name: 'console',
    supports: ['traces', 'metrics', 'logs', 'errors'],
    async start() {},
    async shutdown() {},
    runInSpan<T>(_name: string, _options: SpanOptions, fn: (s: Span) => T): T {
      return runSpan(span, fn)
    },
    activeSpan: () => span,
    activeTraceContext: () => undefined,
    inject: () => {},
    runInRemoteSpan<T>(_carrier: TraceCarrier, _name: string, _options: SpanOptions, fn: (s: Span) => T): T {
      return runSpan(span, fn)
    },
    emitLog: (record) => logs.push(record),
    recordMetric: (point) => metrics.push(point),
    ...(options?.withErrorSink
      ? {
        reportError: (error: NonNullable<LogRecord['error']>, context: ReportedError['context']) => {
          reported.push({ error, context })
          options.onReportError?.()
        },
      }
      : {}),
  }
  return { provider, span, logs, metrics, reported }
}

async function activate(provider: TelemetryProvider): Promise<void> {
  process.env.TELEMETRY_BACKEND = 'console'
  registerProvider(provider)
  await initTelemetry()
}

function errorLogs(logs: LogRecord[]): LogRecord[] {
  return logs.filter((record) => record.level === 'error')
}

describe('reportError policy', () => {
  beforeEach(() => {
    resetActiveProvider()
    resetTelemetryInit()
    resetTelemetryEnvCache()
    resetLoggerExtension()
    resetLoggerRegistry()
    resetTelemetryRuntime()
    delete process.env.TELEMETRY_BACKEND
  })

  afterEach(() => {
    delete process.env.TELEMETRY_BACKEND
  })

  it('stamps the code on the span, the log record and the metric label', async () => {
    const { provider, span, logs, metrics } = recordingProvider()
    await activate(provider)

    reportError(new Error('item rejected'), {
      module: 'data_sync',
      code: 'data_sync.item_failed',
      attributes: { runId: 'run-1' },
    })

    expect(span.attributes['error.code']).toBe('data_sync.item_failed')
    expect(span.status).toBe('error')
    const record = errorLogs(logs)[0]
    expect(record?.attributes?.['error.code']).toBe('data_sync.item_failed')
    expect(record?.attributes?.runId).toBe('run-1')
    expect(metrics.find((metric) => metric.name === 'om.errors')?.labels).toEqual({
      module: 'data_sync',
      'error.code': 'data_sync.item_failed',
    })
  })

  it('leaves callers that pass no code exactly as they were', async () => {
    const { provider, span, logs, metrics } = recordingProvider()
    await activate(provider)

    reportError(new Error('boom'), { module: 'crud' })

    expect(metrics.find((metric) => metric.name === 'om.errors')?.labels).toEqual({ module: 'crud' })
    expect(errorLogs(logs)[0]?.attributes?.['error.code']).toBeUndefined()
    expect(span.attributes['error.code']).toBeUndefined()
    expect(span.exceptions).toHaveLength(1)
  })

  it('reports every occurrence — no sampling, no suppression', async () => {
    const { provider, logs, metrics, reported } = recordingProvider({ withErrorSink: true })
    await activate(provider)

    for (let index = 0; index < 115; index += 1) {
      reportError(new Error('same failure'), { module: 'data_sync', code: 'data_sync.item_failed' })
    }

    expect(errorLogs(logs)).toHaveLength(115)
    expect(reported).toHaveLength(115)
    expect(metrics.filter((metric) => metric.name === 'om.errors')).toHaveLength(115)
  })

  it('hands the provider a serialized, redacted error in addition to span, log and metric', async () => {
    const { provider, span, logs, metrics, reported } = recordingProvider({ withErrorSink: true })
    await activate(provider)

    reportError(new Error('no user for jan.kowalski@example.com'), {
      module: 'integrations',
      code: 'integrations.log_error',
      attributes: { authorization: 'Bearer sk_live_abc', integrationId: 'sync_akeneo' },
    })

    expect(reported).toHaveLength(1)
    expect(reported[0]?.error.name).toBe('Error')
    expect(reported[0]?.error.message).toBe('no user for [redacted-email]')
    expect(reported[0]?.context.code).toBe('integrations.log_error')
    expect(reported[0]?.context.module).toBe('integrations')
    expect(reported[0]?.context.attributes?.authorization).toBe('[redacted]')
    expect(reported[0]?.context.attributes?.integrationId).toBe('sync_akeneo')
    // Carried once, in the context — a provider author following the README recipe
    // should not find it in `extra` as well as `tags`.
    expect(reported[0]?.context.attributes?.['error.code']).toBeUndefined()
    // The hook is additive: the built-in path still fires, so a provider that
    // implements it cannot make signal disappear.
    expect(span.exceptions).toHaveLength(1)
    expect(errorLogs(logs)).toHaveLength(1)
    expect(metrics.some((metric) => metric.name === 'om.errors')).toBe(true)
  })

  it('does not recurse when the reporting path itself reports', async () => {
    let nested = 0
    const { provider, logs, reported } = recordingProvider({
      withErrorSink: true,
      onReportError: () => {
        nested += 1
        if (nested > 5) return
        reportError(new Error('failure inside the error sink'), { module: 'telemetry' })
      },
    })
    await activate(provider)

    reportError(new Error('original failure'), { module: 'data_sync', code: 'data_sync.item_failed' })

    expect(reported).toHaveLength(1)
    expect(reported[0]?.error.message).toBe('original failure')
    expect(errorLogs(logs)).toHaveLength(1)
  })

  it('survives a provider whose error sink throws, without losing any built-in signal', async () => {
    const { provider, span, logs, metrics } = recordingProvider({
      withErrorSink: true,
      onReportError: () => {
        throw new Error('sentry transport is down')
      },
    })
    await activate(provider)

    // `reportError` is called from catch blocks that still have work to do after
    // it — rethrowing the caller's error, returning a 500 with its correlation
    // header. A third-party hook must never be able to take that with it.
    expect(() =>
      reportError(new Error('item rejected'), { module: 'data_sync', code: 'data_sync.item_failed' }),
    ).not.toThrow()

    expect(span.exceptions).toHaveLength(1)
    expect(span.attributes['error.code']).toBe('data_sync.item_failed')
    expect(errorLogs(logs)).toHaveLength(1)
    expect(metrics.filter((metric) => metric.name === 'om.errors')).toHaveLength(1)
  })

  it('is unaffected by a provider without the optional error sink', async () => {
    const { provider, logs } = recordingProvider()
    await activate(provider)

    expect(() => reportError(new Error('boom'), { module: 'queue', code: 'queue.job_failed' })).not.toThrow()
    expect(errorLogs(logs)).toHaveLength(1)
  })
})
