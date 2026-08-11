# @open-mercato/telemetry

Vendor-neutral tracing, metrics, log export, and error reporting for Open
Mercato, backed by a pluggable provider with OpenTelemetry (OTLP) as the default
transport.

Telemetry is explicitly opt-in. The platform checks `TELEMETRY_BACKEND` from
shared code before importing this package, so the telemetry runtime is not
evaluated when the variable is unset, `noop`, or unknown. OpenTelemetry packages
are optional dependencies and are dynamically imported only for an OTLP backend.
Package managers may still install optional dependencies; the guarantee is zero
disabled-path runtime loading, hook registration, or export traffic.

See [the telemetry spec](../../.ai/specs/2026-04-29-telemetry-and-otel.md).

## Usage

The canonical application logger remains
`@open-mercato/shared/lib/logger`. Telemetry extends it after successful
initialization with trace correlation and one remote sink; it does not create a
second logger or local output path.

```ts
import { createLogger } from '@open-mercato/shared/lib/logger'
import { withSpan, counter, reportError } from '@open-mercato/telemetry'

const log = createLogger('orders').child({ module: 'sales' })
log.info('Order placed', { orderId })

await withSpan('orders.checkout', async (span) => {
  span.setAttribute('om.tenant_id', tenantId)
  // pg/undici auto-spans nest here when OTLP is enabled
})

counter('om.errors', 1, { module: 'orders' })

try {
  // ...
} catch (error) {
  reportError(error, { module: 'orders' })
  throw error
}
```

Use `OM_LOG_LEVEL`, `OM_LOG_PRETTY`, and `OM_LOG_DESTINATION` for both the
normal local logger and telemetry-backed log export. Remote records follow the
same shared level gate as local records.

## Enabling

Leave `TELEMETRY_BACKEND` unset (or set it to `noop`) to keep telemetry off.
Unknown values also resolve to off.

```dotenv
TELEMETRY_BACKEND=otlp
TELEMETRY_SAMPLING_RATIO=0.1
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-collector>:4318
OTEL_EXPORTER_OTLP_HEADERS=<auth-header>=<key>
OTEL_SERVICE_NAME=open-mercato
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production
```

`otlp`, `signoz`, and `newrelic` select the same OTLP provider and differ
only by endpoint and headers. `console` is an explicit local span/metric
diagnostic backend.

`TELEMETRY_TRUST_INBOUND_TRACE` defaults to false. In that mode both
`traceparent` and `x-original-traceparent` from inbound/global carriers are
ignored because either header is caller-controlled. Set it to true only behind a
trusted upstream when global W3C continuation is required. The queue package's
dedicated `metadata._trace` carrier does not require this flag. The richer
`bullmq-otel` queue spans do use the process-global propagator, so they stay
disabled while this flag is false; async queues then use the dedicated carrier.

Custom providers remain supported through `registerProvider()`. Because the
default host guard deliberately imports telemetry only for built-in backend
names, a custom-provider bootstrap must import `@open-mercato/telemetry`,
register a provider whose `name` matches `TELEMETRY_BACKEND`, and call
`initTelemetry()` directly. Unregistered names remain a hard no-op.

## Existing apps

Fresh create-app scaffolds are already wired. Older apps can run:

```bash
yarn mercato telemetry init
```

The command is idempotent and supports `--dry-run`. The equivalent manual
wiring is:

```ts
// src/instrumentation.ts
import { isTelemetryBackendEnabled } from '@open-mercato/shared/lib/telemetry/runtime'

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs' && isTelemetryBackendEnabled()) {
    const { registerTelemetryForNextjs } =
      await import('@open-mercato/telemetry/nextjs')
    await registerTelemetryForNextjs()
  }
}
```

```ts
// next.config.ts — config-only entrypoint, no telemetry runtime imports
import { telemetryServerExternalPackages } from '@open-mercato/telemetry/nextjs-config'
```

```ts
// shared API dispatcher
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

getTelemetryRuntime()?.recordHttpDuration(method, route.path, status, startedAt)
getTelemetryRuntime()?.reportError(error, {
  attributes: { 'http.route': route.path },
})
```

The CLI and queue worker use the same explicit-backend check before their dynamic
telemetry import. Queue enqueue/dispatch code talks only to the shared runtime
bridge, so the package is not loaded on the disabled path.

## Public API

| Export | Description |
| --- | --- |
| `withSpan(name, fn, opts?)` | Run `fn` in a provider-owned span. `opts.root` starts a new trace; `opts.links` attaches causal links (see [Long-lived jobs](#long-lived-jobs-root-spans)) |
| `currentSpan()` / `setAttributes(attrs)` | Active span access |
| `counter` / `histogram` / `gauge` | Metric helpers |
| `reportError(err, ctx?)` | Span exception + shared error log + `om.errors` |
| `captureTraceContext()` / `continueTrace(...)` | Dedicated cross-boundary propagation |
| `initTelemetry()` / `shutdownTelemetry()` | Opt-in bootstrap and flush |
| `registerProvider(provider)` | Register a custom provider for an enabled backend name |

`@open-mercato/telemetry/nextjs` exports the runtime
`registerTelemetryForNextjs()` and `recordHttpDuration()` helpers.
`@open-mercato/telemetry/nextjs-config` separately exports only
`telemetryServerExternalPackages` for build configuration.

### Long-lived jobs: root spans

Trace context propagates from the request that triggered a job through the queue
into the worker, and `ParentBasedSampler` only decides sampling at a trace's
**root**. A job that runs for hours therefore inherits one decision made on a
request from long before it: below `TELEMETRY_SAMPLING_RATIO=1.0` an entire run
can emit nothing at all, and at `1.0` the run becomes one unrenderable trace.

Give the unit of work you actually analyse — a batch, a page — its own trace, and
link it back so the causal chain survives:

```ts
import { withSpan, captureTraceContext } from '@open-mercato/telemetry'

const runTrace = captureTraceContext() // the triggering job's trace

for (const batch of batches) {
  await withSpan('import.batch', async (span) => {
    span.setAttributes({ 'import.batch_index': batch.index })
    await processBatch(batch)
  }, { root: true, links: [runTrace] })
}
```

Each batch now samples independently (no run is ever a total blind spot) and each
trace stays small enough to render. `links` takes W3C **carriers**, so it accepts
both `captureTraceContext()` and a carrier received from another process; empty
or malformed carriers are dropped rather than emitted as invalid links.

### Emitting spans without depending on this package

Packages that must not take a dependency on `@open-mercato/telemetry` use the
shared runtime bridge instead. With telemetry off, `withTelemetrySpan` is `fn`
plus one global lookup — no span is allocated and the OTEL SDK is never reached.

```ts
import {
  withTelemetrySpan,
  captureTelemetryTrace,
} from '@open-mercato/shared/lib/telemetry/runtime'

const runTrace = captureTelemetryTrace() // undefined when telemetry is off

await withTelemetrySpan('data_sync.import.batch', async (span) => {
  span.setAttributes({ 'data_sync.batch_index': index })
  await processBatch()
}, { root: true, links: runTrace ? [runTrace] : undefined })
```

`packages/core/src/modules/data_sync/lib/batch-stream.ts` is the reference
consumer.

## Security and privacy

- Explicit off is absolute: custom providers cannot override an unset/noop
  backend, and no process-wide logger/runtime hooks are registered.
- Secret-looking attribute keys (including exact `token`) are masked, while
  benign keys such as `token_count` remain intact.
- Error serialization includes only name, message, and stack. Arbitrary thrown
  objects are never JSON-stringified.
- Redaction runs again at the OTLP provider boundary for log bodies, error
  fields, span attributes, and metric labels.
- Postgres parameter-value capture is locked off with
  `enhancedDatabaseReporting: false`.
- Metric labels must remain low-cardinality and must never contain tenant,
  organization, or user IDs.

The package is server-only because span context uses `node:async_hooks`.

## Validation

```bash
yarn workspace @open-mercato/telemetry build
yarn workspace @open-mercato/telemetry test
yarn typecheck
```
