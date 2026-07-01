# @open-mercato/telemetry

Vendor-neutral **tracing, logging, metrics, and error reporting** for Open
Mercato, backed by a pluggable provider with **OpenTelemetry (OTLP) as the
default transport**. The app is instrumented once with vanilla OTEL, so the
backend is just an endpoint + token and any OTLP backend (New Relic, Datadog,
Grafana/Tempo, Honeycomb, SigNoz, …) is a one-line env swap.

Off by default and a cheap no-op when disabled — the heavy OTEL SDK is an
`optionalDependency`, loaded only when an OTLP backend is selected. See the spec
[`.ai/specs/2026-04-29-telemetry-and-otel.md`](../../.ai/specs/2026-04-29-telemetry-and-otel.md).

## Usage

```ts
import { logger, withSpan, counter, histogram, reportError } from '@open-mercato/telemetry'

const log = logger.child({ module: 'orders' })
log.info('order placed', { orderId })          // structured; trace_id/span_id auto-stamped

await withSpan('orders.checkout', async (span) => {   // pg/undici auto-spans nest under this
  span.setAttribute('om.tenant_id', tenantId)
  // ...
})

counter('om.errors', 1, { module: 'orders' })

try { /* ... */ } catch (err) { reportError(err, { module: 'orders' }); throw err }
```

## Enabling

Off by default (`TELEMETRY_BACKEND` unset → hard no-op, OTEL SDK never loaded).
Set in `.env` (see `apps/mercato/.env.example`):

```
TELEMETRY_BACKEND=otlp     # otlp | signoz | newrelic (all OTLP) | console | noop
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-collector>:4318
OTEL_EXPORTER_OTLP_HEADERS=<auth-header>=<key>
OTEL_SERVICE_NAME=open-mercato
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=local
```

`otlp`, `signoz`, and `newrelic` all select the **same OTLP provider** — they
differ only by endpoint + headers (modern New Relic ingests OTLP, e.g.
`OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp.eu01.nr-data.net` +
`OTEL_EXPORTER_OTLP_HEADERS=api-key=<license-key>`). `console` prints span
timings + metrics to stdout; `noop` is off.

Keep **one stable `OTEL_SERVICE_NAME`** across environments and separate them
with the `deployment.environment` resource attribute (filter/scope alerts by it).
In local dev, stdout logs are pretty-printed (`TELEMETRY_LOG_PRETTY`, default on
when `NODE_ENV=development`); deployed environments emit single-line JSON.

## Public API

| Export | Description |
| --- | --- |
| `logger` | always-on structured logger; `logger.child({ module })` |
| `withSpan(name, fn, opts?)` | run `fn` in a span; auto-records exceptions/duration |
| `currentSpan()` / `setAttributes(attrs)` | active span access |
| `counter` / `histogram` / `gauge` | metric helpers (optional UCUM `unit`) |
| `reportError(err, ctx?)` | exception on span + structured error log + `om.errors` counter |
| `captureTraceContext()` / `continueTrace(carrier, name, fn)` | cross-boundary propagation |
| `initTelemetry()` / `shutdownTelemetry()` | one-shot bootstrap + flush |
| `registerProvider(provider)` | plug a custom backend before init |

## Notes & limitations

- **The facade is server-only.** It pulls in `pino` and `node:async_hooks`, so
  importing `@open-mercato/telemetry` from a `'use client'` component breaks the
  build. All call sites are server-side (API routes, services, workers).
- **Web-process init is wired (Phase 1); worker/cross-boundary propagation is
  Phase 2.** The web process initializes telemetry from
  `apps/mercato/instrumentation.ts`. Worker/CLI processes do not run that hook;
  the active provider is therefore held on a `globalThis` singleton
  (`provider/registry.ts`) so a future worker-bootstrap init shares one provider
  across the worker's bundled-vs-source module copies. Until that lands, worker
  spans run through the no-op provider.
- **Root-per-request via a backup-header propagator.** A load balancer (e.g. GCP's)
  reads the inbound `traceparent`, makes its own span, and **rewrites** the header to
  point at that unexported span — so plain W3C extraction orphans every request under
  an infra trace the backend never sees, and root-span / trace-group views go empty.
  The global propagator fixes this with the backup-header pattern: on inject it also
  writes `x-original-traceparent` (the LB won't touch it); on extract it **continues
  from the backup when present** (our own services/jobs carry it → service-to-service
  traces survive the rewrite) and **roots on a bare `traceparent`** (the LB / an
  untrusted caller). Because the global `extract` stays functional, carrier-round-trip
  instrumentation like `bullmq-otel` works through it. The hand-rolled queue/event
  carrier uses a dedicated propagator, so it's independent. Set
  `TELEMETRY_TRUST_INBOUND_TRACE=true` to continue a bare inbound trace from a trusted
  upstream instead.
- **`console` backend does not join remote traces.** `runInRemoteSpan` starts a
  fresh local span and ignores the carrier — a dev-backend limitation, not a
  propagation bug. Cross-boundary propagation works on the OTLP backend.
- **No PII by construction.** Span attributes/logs carry opaque ids only; `pg`
  parameter-value capture is disabled (`enhancedDatabaseReporting: false`,
  regression-tested), and an email-redaction backstop (`facade/redact.ts`) scrubs
  error message + stack and span exceptions. Keep tenant/org/user ids on **span
  attributes**, never on metric labels (cardinality + cost).
- **Verify before flipping an OTLP backend on in production.** All
  `@opentelemetry/*` packages are in the app's `serverExternalPackages` so the
  bundler does not bundle them. Run one `next build && next start` smoke against a
  collector before enabling it in a real environment.

## Tests

All automated tests run in the standard jest suite (`yarn workspace
@open-mercato/telemetry test`) — no network, no database:

- **Unit** — env parsing, error serialization (PII), email redaction, span
  lifecycle (`run-span`), provider registry (global singleton + dual-copy guard).
- **Facade** — no-op-when-off, span/metric/log/error routing, propagation.
- **In-memory integration** (`otlp-integration.test.ts`) — the real provider with
  in-memory OTEL exporters: span shape, parent/child nesting (delegation model),
  cross-boundary trace propagation (consumer shares the producer's traceId),
  root-per-request, log correlation, metrics.
- **PII config regression** (`pg-pii-config.test.ts`) — locks
  `enhancedDatabaseReporting: false` so SQL parameter values can never leak.

The real OTLP wire format and real `pg` param-stripping are OpenTelemetry's own
code (tested upstream); verify them manually against a collector rather than
coupling CI to a network/database.
