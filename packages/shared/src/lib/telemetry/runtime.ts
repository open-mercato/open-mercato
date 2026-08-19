export type TelemetryTraceCarrier = Record<string, string>

export type TelemetrySpanAttributes = Record<string, string | number | boolean | undefined>

export type TelemetrySpanKind = 'internal' | 'server' | 'client' | 'producer' | 'consumer'

/** The subset of the telemetry package's `Span` that bridge consumers need. */
export type TelemetrySpan = {
  setAttributes(attributes: TelemetrySpanAttributes): void
  /**
   * Rename an in-flight span whose identity is only known once it has run.
   * Optional so a bootstrap predating it still satisfies the contract — call it
   * as `span.updateName?.(…)`.
   */
  updateName?(name: string): void
}

export type TelemetrySpanOptions = {
  kind?: TelemetrySpanKind
  attributes?: TelemetrySpanAttributes
  /** Start a new trace so the sampler decides for this span alone. */
  root?: boolean
  /** Causal links to other traces, as W3C carriers. */
  links?: TelemetryTraceCarrier[]
}

export type TelemetryRuntime = {
  /**
   * True only when the active SDK may safely use the process-global W3C
   * propagator for cross-boundary extraction.
   */
  canUseGlobalTracePropagation(): boolean
  captureTraceContext(): TelemetryTraceCarrier
  continueTrace<T>(
    carrier: TelemetryTraceCarrier | undefined,
    name: string,
    fn: () => T,
    options?: { kind?: 'internal' | 'server' | 'client' | 'producer' | 'consumer' },
  ): T
  /**
   * Optional so an older bootstrap that predates span support still satisfies
   * the contract; consumers go through `withTelemetrySpan` and degrade to
   * running `fn` untraced.
   */
  withSpan?<T>(name: string, fn: (span: TelemetrySpan) => T, options?: TelemetrySpanOptions): T
  recordHttpDuration(method: string, route: string, status: number, startedAt: number): void
  reportError(
    error: unknown,
    context?: {
      module?: string
      attributes?: Record<string, string | number | boolean | undefined>
    },
  ): void
  shutdown(): Promise<void>
}

const GLOBAL_KEY = Symbol.for('@open-mercato/shared.telemetryRuntime')
const ENABLED_BACKENDS = new Set(['console', 'signoz', 'newrelic', 'otlp'])

type TelemetryRuntimeStore = {
  active?: TelemetryRuntime
}

function store(): TelemetryRuntimeStore {
  const globalStore = globalThis as unknown as Record<symbol, TelemetryRuntimeStore | undefined>
  let current = globalStore[GLOBAL_KEY]
  if (!current) {
    current = {}
    globalStore[GLOBAL_KEY] = current
  }
  return current
}

/**
 * This check is intentionally owned by shared code so hosts can decide whether
 * to dynamically import the telemetry package without evaluating that package.
 */
export function isTelemetryBackendEnabled(raw?: string): boolean {
  const value = raw ?? (
    typeof process === 'undefined'
      ? undefined
      : process.env.TELEMETRY_BACKEND
  )
  return ENABLED_BACKENDS.has((value ?? '').trim().toLowerCase())
}

export function registerTelemetryRuntime(runtime: TelemetryRuntime): () => void {
  store().active = runtime
  return () => {
    const current = store()
    if (current.active === runtime) current.active = undefined
  }
}

export function getTelemetryRuntime(): TelemetryRuntime | undefined {
  return store().active
}

/** Test-only: clear the process-wide telemetry bridge. */
export function resetTelemetryRuntime(): void {
  store().active = undefined
}

const NOOP_SPAN: TelemetrySpan = { setAttributes() {} }

/**
 * Run `fn` inside a span, from a package that must not depend on
 * `@open-mercato/telemetry`. With telemetry off this is `fn` plus one global
 * lookup — no span object is allocated and the OTEL SDK is never reached.
 *
 * Pass `root: true` for the unit of work a long-lived job should be sampled and
 * rendered by (a batch, a page) so the job is not one trace under one sampling
 * decision, and `links` to keep the causal chain back to what triggered it.
 */
export function withTelemetrySpan<T>(
  name: string,
  fn: (span: TelemetrySpan) => T,
  options?: TelemetrySpanOptions,
): T {
  const runtime = getTelemetryRuntime()
  if (!runtime?.withSpan) return fn(NOOP_SPAN)
  return runtime.withSpan(name, fn, options)
}

/**
 * The active trace as a carrier, for use as a `links` entry. `undefined` when
 * telemetry is off or nothing is active, which `withTelemetrySpan` treats as
 * "no link" rather than an invalid one.
 */
export function captureTelemetryTrace(): TelemetryTraceCarrier | undefined {
  const carrier = getTelemetryRuntime()?.captureTraceContext()
  return carrier && Object.keys(carrier).length > 0 ? carrier : undefined
}
