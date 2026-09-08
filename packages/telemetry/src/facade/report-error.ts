import type { Attributes } from '../types'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { currentSpan } from './tracer'
import { serializeError } from './serialize'
import { counter } from './meter'
import { redactAttributes } from './redact'
import { getActiveProvider } from '../provider/registry'

const logger = createLogger('telemetry')

export type ReportErrorContext = {
  /** Owning module, e.g. 'orders'. Used as a metric label. */
  module?: string
  /**
   * Stable, enumerated fingerprint for this failure reason, as `module.reason`
   * (`data_sync.item_failed`, `queue.job_failed`). NEVER an interpolated string:
   * it is a metric label, and it is what the backend groups on.
   *
   * Grouping is why this exists. Sentry fingerprints on the stack trace and New
   * Relic on the error class, so a funnel that synthesizes one error type at one
   * line — the integration-log tee — collapses every caller into a single issue
   * without a discriminator, and SigNoz has no error grouping of its own at all.
   */
  code?: string
  /** Low-cardinality, NO-PII attributes (ids ok, never names/content). */
  attributes?: Attributes
}

/**
 * Re-entrancy guard, not a rate limit. `reportError` runs synchronously end to
 * end, so a nested call can only come from the reporting path itself throwing and
 * being reported in turn (a throwing provider hook, a redaction bug). One flag
 * turns that recursion into a no-op while keeping the original report intact.
 *
 * Volume is deliberately NOT policed here: the backend (quotas, spike
 * protection), the collector (filter/sample processors) and the SDK's batch
 * processors already bound it, and each of them drops where the drop is visible
 * and adjustable. A fourth limiter in this function would be the only one that
 * loses an error irrecoverably at the source.
 */
let reporting = false

/**
 * The error funnel. Additive — existing `console.error` calls stay valid; this
 * is the path that reaches the active backend. It:
 *   1. records the exception on the active span (errors-as-span-events),
 *   2. emits a structured error log (stack only — no PII payloads),
 *   3. increments the `om.errors` counter, labeled by `module` and `code`,
 *   4. hands the serialized error to the provider's own error sink when it has
 *      one (issue-tracker-shaped backends), in ADDITION to the three above so no
 *      path can lose signal.
 *
 * Every reported error is emitted; there is no sampling or suppression here.
 */
export function reportError(error: unknown, ctx?: ReportErrorContext): void {
  if (reporting) return
  reporting = true
  try {
    const span = currentSpan()
    if (span) {
      span.recordException(error)
      span.setStatus('error')
      // Span-level, because `recordException` takes no attributes. With several
      // reports on one span the last code wins; the per-error code always
      // survives on the log record and the metric.
      if (ctx?.code) span.setAttribute('error.code', ctx.code)
    }

    const serialized = serializeError(error)
    const attributes: Attributes = { ...(ctx?.attributes ?? {}) }
    if (ctx?.module) attributes.module = ctx.module
    if (ctx?.code) attributes['error.code'] = ctx.code
    const safeAttributes = redactAttributes(attributes)

    const safeError = new Error(serialized.message)
    safeError.name = serialized.name
    safeError.stack = serialized.stack
    logger.error('Application error reported', { ...safeAttributes, err: safeError })
    counter('om.errors', 1, errorLabels(ctx))

    const provider = getActiveProvider()
    provider.reportError?.(serialized, {
      module: ctx?.module,
      code: ctx?.code,
      attributes: safeAttributes,
    })
  } finally {
    reporting = false
  }
}

function errorLabels(ctx?: ReportErrorContext): Attributes | undefined {
  if (!ctx?.module && !ctx?.code) return undefined
  const labels: Attributes = {}
  if (ctx.module) labels.module = ctx.module
  if (ctx.code) labels.code = ctx.code
  return labels
}
