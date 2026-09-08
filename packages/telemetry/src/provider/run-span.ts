import type { Span } from '../types'

function isThenable(value: unknown): value is Promise<unknown> {
  return (
    value != null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  )
}

/**
 * Run `fn(span)` and end `span` when it settles — synchronously for sync
 * returns, on resolve/reject for promises. Exceptions (sync throw or rejected
 * promise) are recorded on the span and re-thrown. Shared by the console and
 * OTLP providers so async spans get correct durations.
 */
export function runSpan<T>(span: Span, fn: (span: Span) => T): T {
  let result: T
  try {
    result = fn(span)
  } catch (error) {
    span.recordException(error)
    span.setStatus('error')
    span.end()
    throw error
  }

  if (isThenable(result)) {
    return result.then(
      (value) => {
        span.end()
        return value
      },
      (error) => {
        span.recordException(error)
        span.setStatus('error')
        span.end()
        throw error
      },
    ) as T
  }

  span.end()
  return result
}
