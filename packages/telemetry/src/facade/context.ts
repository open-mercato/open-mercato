import { AsyncLocalStorage } from 'node:async_hooks'
import type { Span } from '../types'

/**
 * Carries the facade's active span across `await` boundaries for spans created
 * via `withSpan`. (OTEL auto-instrumentation spans live in OTEL's own context;
 * the OTLP provider's `activeSpan()` bridges to those — see `currentSpan`.)
 */
export const spanStore = new AsyncLocalStorage<Span>()

export function runWithSpan<T>(span: Span, fn: () => T): T {
  return spanStore.run(span, fn)
}

export function spanFromStore(): Span | undefined {
  return spanStore.getStore()
}
