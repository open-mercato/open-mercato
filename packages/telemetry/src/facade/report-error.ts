import type { Attributes, LogRecord } from '../types'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { currentSpan } from './tracer'
import { serializeError } from './serialize'
import { counter } from './meter'
import { redactAttributes } from './redact'
import { getActiveProvider } from '../provider/registry'

const logger = createLogger('telemetry')

/**
 * The single attribute name the code is published under, on all three built-in
 * surfaces. One spelling, so a query written against the span also works against
 * the log record and the metric.
 */
const CODE_ATTRIBUTE = 'error.code'

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
 * Re-entrancy guard, not a rate limit. A plain module-level flag, which is
 * sufficient only because `reportError` runs synchronously end to end: a nested
 * call can therefore come from nothing but the reporting path itself — a provider
 * whose error sink reports its own failures, a log bridge that reports. One flag
 * turns that recursion into a no-op while keeping the original report intact. Add
 * an `await` anywhere in this funnel and the flag has to become async-context
 * scoped, or concurrent reports will suppress each other.
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
 *   3. increments the `om.errors` counter, labeled by `module` and `error.code`,
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
      if (ctx?.code) span.setAttribute(CODE_ATTRIBUTE, ctx.code)
    }

    const serialized = serializeError(error)
    const attributes: Attributes = { ...(ctx?.attributes ?? {}) }
    if (ctx?.module) attributes.module = ctx.module
    if (ctx?.code) attributes[CODE_ATTRIBUTE] = ctx.code
    const safeAttributes = redactAttributes(attributes)

    const safeError = new Error(serialized.message)
    safeError.name = serialized.name
    safeError.stack = serialized.stack
    logger.error('Application error reported', { ...safeAttributes, err: safeError })
    counter('om.errors', 1, errorLabels(ctx))

    reportToProvider(serialized, ctx, safeAttributes)
  } finally {
    reporting = false
  }
}

/**
 * Hand the error to the provider's own sink, when it has one.
 *
 * Guarded, and that is the whole point of the function: `reportError` is called
 * from `catch` blocks that still have work to do after it — the API dispatcher
 * records a duration metric, emits its lifecycle event and rethrows the original
 * error; the CRUD factory returns a 500 carrying its `x-request-id`. This hook is
 * implemented by third parties, so one that throws would take all of that with it
 * and replace the caller's error with the telemetry provider's. The interface
 * documents the hook as non-throwing; this is what makes that a property of the
 * funnel rather than a request to its implementors.
 */
function reportToProvider(
  serialized: NonNullable<LogRecord['error']>,
  ctx: ReportErrorContext | undefined,
  safeAttributes: Attributes,
): void {
  try {
    const provider = getActiveProvider()
    if (!provider.reportError) return
    // `code` travels in the context. Repeating it in the attributes would land it
    // in a provider's tags AND its extra data for anyone following the README recipe.
    const providerAttributes: Attributes = { ...safeAttributes }
    delete providerAttributes[CODE_ATTRIBUTE]
    provider.reportError(serialized, {
      module: ctx?.module,
      code: ctx?.code,
      attributes: providerAttributes,
    })
  } catch (sinkError) {
    logger.warn('Telemetry provider error sink failed', { err: sinkError as Error })
  }
}

function errorLabels(ctx?: ReportErrorContext): Attributes | undefined {
  if (!ctx?.module && !ctx?.code) return undefined
  const labels: Attributes = {}
  if (ctx.module) labels.module = ctx.module
  if (ctx.code) labels[CODE_ATTRIBUTE] = ctx.code
  return labels
}
