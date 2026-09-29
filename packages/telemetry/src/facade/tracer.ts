import type { Attributes, Span, SpanOptions } from '../types'
import { getActiveProvider } from '../provider/registry'
import { runWithSpan, spanFromStore } from './context'

/**
 * Run `fn` inside a new span named `name`. The active provider owns span
 * creation + context, so any OTEL auto-instrumentation (pg/http) inside `fn`
 * nests under this span in the same trace. Exceptions and duration are recorded
 * automatically by the provider. No-op-cheap when telemetry is off.
 */
export function withSpan<T>(name: string, fn: (span: Span) => T, options?: SpanOptions): T {
  return getActiveProvider().runInSpan(name, options ?? {}, (span) =>
    runWithSpan(span, () => fn(span)),
  )
}

/** The active span (facade-created or OTEL auto-instrumented), if any. */
export function currentSpan(): Span | undefined {
  return spanFromStore() ?? getActiveProvider().activeSpan()
}

/** Set attributes on the active span, if any. */
export function setAttributes(attributes: Attributes): void {
  currentSpan()?.setAttributes(attributes)
}
