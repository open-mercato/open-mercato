import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

/**
 * Distributed-trace propagation across the enqueue → worker boundary.
 *
 * The W3C trace carrier rides on the job's `metadata._trace` (a first-class
 * metadata channel, not the user payload). Both halves are automatic — the
 * strategies call `attachTraceMetadata` at enqueue and `runJobInTrace` at
 * dispatch — so a worker joins the enqueuing request's trace with no per-worker
 * code. Everything here is a cheap no-op when telemetry is off.
 *
 * This also covers anything that rides the queue: persistent event subscribers
 * (the event bus enqueues) and outbound webhook delivery (queued) become part of
 * the originating request's trace for free.
 */
const TRACE_META_KEY = '_trace'

/**
 * Attach the active trace context to a job's metadata. Returns `metadata`
 * unchanged when telemetry is off (no active span → empty carrier), so jobs stay
 * clean unless tracing is active.
 */
export function attachTraceMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const carrier = getTelemetryRuntime()?.captureTraceContext() ?? {}
  if (Object.keys(carrier).length === 0) return metadata
  return { ...(metadata ?? {}), [TRACE_META_KEY]: carrier }
}

/**
 * Run a job handler inside a span (`queue.<queueName>`) that continues the
 * producer's trace from the carrier on `metadata`. With no carrier (or telemetry
 * off) it runs `fn` under a fresh root span — and a no-op when off. The span
 * ends when `fn` settles (sync or async).
 */
export function runJobInTrace<T>(
  queueName: string,
  metadata: Record<string, unknown> | undefined,
  fn: () => T,
): T {
  const runtime = getTelemetryRuntime()
  if (!runtime) return fn()
  return runtime.continueTrace(
    readTraceCarrier(metadata),
    `queue.${queueName}`,
    fn,
    { kind: 'consumer' },
  )
}

function readTraceCarrier(
  metadata: Record<string, unknown> | undefined,
): Record<string, string> | undefined {
  const raw = metadata?.[TRACE_META_KEY]
  if (!raw || typeof raw !== 'object') return undefined
  return raw as Record<string, string>
}
