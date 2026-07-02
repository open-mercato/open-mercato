import type { Attributes } from '../types'
import { currentSpan } from './tracer'
import { writeRecord } from './logger'
import { serializeError } from './serialize'
import { counter } from './meter'

export type ReportErrorContext = {
  /** Owning module, e.g. 'orders'. Used as the only metric label. */
  module?: string
  /** Low-cardinality, NO-PII attributes (ids ok, never names/content). */
  attributes?: Attributes
}

/**
 * The error funnel. Additive — existing `console.error` calls stay valid; this
 * is the path that reaches the active backend. It:
 *   1. records the exception on the active span (errors-as-span-events),
 *   2. emits a structured error log (stack only — no PII payloads),
 *   3. increments the `om.errors` counter, labeled by `module` only.
 */
export function reportError(error: unknown, ctx?: ReportErrorContext): void {
  const span = currentSpan()
  if (span) {
    span.recordException(error)
    span.setStatus('error')
  }

  const serialized = serializeError(error)
  const attributes: Attributes = { ...(ctx?.attributes ?? {}) }
  if (ctx?.module) attributes.module = ctx.module

  writeRecord({ level: 'error', message: serialized.message, attributes, error: serialized })
  counter('om.errors', 1, ctx?.module ? { module: ctx.module } : undefined)
}
