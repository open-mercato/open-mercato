import type { Attributes } from '../types'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { currentSpan } from './tracer'
import { serializeError } from './serialize'
import { counter } from './meter'
import { redactAttributes } from './redact'

const logger = createLogger('telemetry')

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
  const safeAttributes = redactAttributes(attributes)

  const safeError = new Error(serialized.message)
  safeError.name = serialized.name
  safeError.stack = serialized.stack
  logger.error('Application error reported', { ...safeAttributes, err: safeError })
  counter('om.errors', 1, ctx?.module ? { module: ctx.module } : undefined)
}
