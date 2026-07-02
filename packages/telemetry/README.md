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

`TELEMETRY_LOG_LEVEL` gates **both** stdout and the backend export — records below
the level never ship to the OTLP backend (controls remote volume/cost, not just
stdout noise).

## Adopting in an existing app

**Freshly scaffolded apps (`create-mercato-app`) need no code** — the template
already wires everything. Set the env above and restart.

**An app scaffolded before telemetry existed** can wire everything with one
command:

```bash
yarn mercato telemetry init          # add --dry-run to preview
```

It patches `package.json`, `.env.example` (+ `.env` if present),
`src/instrumentation.ts`, `next.config.ts`, and the API dispatcher — idempotent
and safe to re-run. If your dispatcher has been customized beyond recognition it
prints the exact snippet to paste instead of editing code it doesn't understand.
Then run `yarn install`, set `TELEMETRY_BACKEND` + the OTLP env, and rebuild.

The rest of this section documents what that command does (and how to do it by
hand). Two parts:

1. **Worker/scheduler telemetry comes with the dependency bump.** `@open-mercato/cli`
   depends on `@open-mercato/telemetry` and initializes it before the app graph
   loads, so standalone worker/scheduler processes emit spans once you update
   `@open-mercato/*` to a release that includes this package and set the env — no
   code change.

2. **Web-tier wiring is app-owned source, so add it by hand** (mirrors what the
   template contains):

   ```jsonc
   // package.json
   "dependencies":         { "@open-mercato/telemetry": "<version>" },
   "optionalDependencies": { "bullmq-otel": "^1.3.1" }   // only for BullMQ queue spans
   ```

   ```ts
   // src/instrumentation.ts
   export async function register(): Promise<void> {
     if (process.env.NEXT_RUNTIME === 'nodejs') {
       const { registerTelemetryForNextjs } = await import('@open-mercato/telemetry/nextjs')
       await registerTelemetryForNextjs()
     }
   }
   ```

   ```ts
   // next.config.ts
   import { telemetryServerExternalPackages } from '@open-mercato/telemetry/nextjs'
   // serverExternalPackages: [ ...existing, ...telemetryServerExternalPackages ]
   ```

   ```ts
   // src/app/api/[...slug]/route.ts — in the shared dispatcher chokepoint
   import { reportError } from '@open-mercato/telemetry'
   import { recordHttpDuration } from '@open-mercato/telemetry/nextjs'
   // on completion:  recordHttpDuration(method, route.path, status, startedAt)
   // in the 5xx catch: reportError(error, { attributes: { 'http.route': route.path } })
   ```

   Then `yarn install` and set the env. Everything is additive — omit
   `TELEMETRY_BACKEND` and the app behaves exactly as before.

   The `@opentelemetry/*` SDK is a transitive `optionalDependency` of
   `@open-mercato/telemetry`; you don't list the OTEL packages yourself. The
   dispatcher wiring is the only non-mechanical merge — the other three files are
   near-verbatim.

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

### `@open-mercato/telemetry/nextjs` — app-wiring helpers

A thin subpath so a Next.js app wires telemetry from imports instead of copied boilerplate. Import-safe from `next.config.ts` (it never statically pulls in `@opentelemetry/*` or the logger).

| Export | Description |
| --- | --- |
| `registerTelemetryForNextjs()` | one-line `instrumentation.ts` bootstrap: init + graceful degrade + `SIGTERM`/`SIGINT` flush; skips the edge runtime |
| `telemetryServerExternalPackages` | the full `@opentelemetry/*` list to spread into `next.config.ts` `serverExternalPackages` — single source of truth, so a partial copy can't silently disable exporting |
| `recordHttpDuration(method, route, status, startedAt)` | emit the semconv `http.server.request.duration` histogram (`route` = low-cardinality template, never the resolved path) |

## Notes & limitations

- **The facade is server-only.** It pulls in `pino` and `node:async_hooks`, so
  importing `@open-mercato/telemetry` from a `'use client'` component breaks the
  build. All call sites are server-side (API routes, services, workers).
- **Web + worker init and cross-boundary propagation are wired.** The web process
  initializes telemetry from `instrumentation.ts` (via
  `registerTelemetryForNextjs`). Worker/CLI processes do not run that hook, so
  `@open-mercato/cli` initializes telemetry in its bootstrap **before** the app
  graph loads (required so the `pg`/`undici` auto-instrumentations patch drivers
  the job handlers then load). The active provider is held on a `globalThis`
  singleton (`provider/registry.ts`) so it is shared across a worker's
  bundled-vs-source module copies. W3C trace context rides the queue job's
  `metadata._trace` carrier (auto-injected at enqueue, auto-continued at
  dispatch), which transitively covers persistent event subscribers and queued
  webhook delivery; the BullMQ (`async`) strategy delegates to `bullmq-otel` when
  an OTLP backend is active.
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
- **Next.js helpers** (`nextjs.test.ts`) — the externals list covers the full OTEL
  set (no partial-copy footgun), `recordHttpDuration` emits the semconv histogram
  (with `error.type` only on 5xx), and `registerTelemetryForNextjs` no-ops when
  off and skips the edge runtime.

The real OTLP wire format and real `pg` param-stripping are OpenTelemetry's own
code (tested upstream); verify them manually against a collector rather than
coupling CI to a network/database.
