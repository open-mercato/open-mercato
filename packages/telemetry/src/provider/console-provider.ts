import type {
  LogRecord,
  MetricPoint,
  Span,
  SpanOptions,
  TelemetryProvider,
  TelemetrySignal,
  TraceCarrier,
  TraceContext,
} from '../types'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { serializeError } from '../facade/serialize'
import { runSpan } from './run-span'

const logger = createLogger('telemetry')

/**
 * Dev backend: prints span timings and metric points to stdout (via the shared
 * logger). It does NOT handle logs — the facade's logger already writes those to
 * stdout, so `emitLog` is a no-op here to avoid duplication.
 */
class ConsoleSpan implements Span {
  private readonly attributes: Record<string, unknown> = {}
  private status: 'ok' | 'error' = 'ok'
  private readonly startedAt = Date.now()

  constructor(private readonly name: string) {}

  setAttribute(key: string, value: string | number | boolean): void {
    this.attributes[key] = value
  }
  setAttributes(attributes: Record<string, string | number | boolean | undefined>): void {
    Object.assign(this.attributes, attributes)
  }
  recordException(error: unknown): void {
    this.status = 'error'
    this.attributes.exception = serializeError(error).message
  }
  setStatus(status: 'ok' | 'error'): void {
    this.status = status
  }
  end(): void {
    logger[this.status === 'error' ? 'error' : 'debug'](`Span ${this.name}`, {
      span: this.name,
      durationMs: Date.now() - this.startedAt,
      status: this.status,
    })
  }
}

export class ConsoleProvider implements TelemetryProvider {
  readonly name = 'console'
  readonly supports: readonly TelemetrySignal[] = ['traces', 'metrics']

  async start(): Promise<void> {}
  async shutdown(): Promise<void> {}

  runInSpan<T>(name: string, _options: SpanOptions, fn: (span: Span) => T): T {
    return runSpan(new ConsoleSpan(name), fn)
  }

  activeSpan(): Span | undefined {
    return undefined
  }

  activeTraceContext(): TraceContext | undefined {
    // ConsoleSpan carries no real trace ids (dev-only timing print).
    return undefined
  }

  inject(_carrier: TraceCarrier): void {}

  runInRemoteSpan<T>(_carrier: TraceCarrier, name: string, _options: SpanOptions, fn: (span: Span) => T): T {
    return runSpan(new ConsoleSpan(name), fn)
  }

  emitLog(_record: LogRecord): void {}

  recordMetric(point: MetricPoint): void {
    logger.debug(`Metric ${point.name}`, {
      metric: point.name,
      kind: point.kind,
      value: point.value,
      ...point.labels,
    })
  }
}
