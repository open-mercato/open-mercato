# Telemetry Package with Pluggable OTEL Backend

## TLDR

Add a new optional package **`@open-mercato/telemetry`** that gives modules a vendor-neutral observability facade — structured logger, spans, counters, histograms — backed by a pluggable `Exporter` interface. Default exporter is **OpenTelemetry (OTLP)**, shipped as an `optionalDependency`; alternative exporters (`newrelic`, `console`, `noop`) plug in through the same seam.

Telemetry is **disabled by default**. When off, the facade is a cheap no-op and the OTEL SDK is never required at runtime. When on (`OTEL_ENABLED=true` or `TELEMETRY_BACKEND=…`), the package wires standard OTEL env vars, propagates `traceparent` across queue jobs / event bus / SSE / webhooks, and auto-instruments Next.js, Postgres, fetch, and the queue worker.

The package is **opt-in**: deployments that don't need observability pay zero install/runtime cost. The package is **decoupled from any single vendor**: OTEL is the default because OTLP already covers New Relic, Datadog, Sentry, Grafana/Tempo, Honeycomb, etc., but the architecture doesn't lock anyone in.

This spec also defines how **issue #60** ("global telemetry handler for exception handling") integrates: the centralized exception pipeline routes through this facade so errors emit log records and span events with the active trace context.

**In scope:**

- New `packages/telemetry` workspace.
- Vendor-neutral facade: `logger`, `withSpan`, `counter`, `histogram`, `initTelemetry`, `Exporter`, `registerExporter`.
- Pino-based default logger; trace/span IDs auto-injected when a span is active.
- OTEL exporter (Phase 2) as optional dep; `console`/`noop`/`newrelic` adapters.
- Trace-context propagation across HTTP, queue jobs, event bus dispatch, SSE bridge, outbound webhooks.
- Auto-instrumentation of Next.js handlers, MikroORM/pg, undici/fetch, queue worker spans, event-bus spans.
- Built-in metrics: HTTP latency/error rate, queue depth/duration, subscriber duration, DB pool, cache hit ratio.
- AGENTS.md guidance for module authors.

**Out of scope:**

- Vendor-specific dashboards, alert rules, or SLOs.
- Browser/RUM telemetry and customer-portal frontend telemetry.
- Log aggregation infrastructure (shipping logs to a backend is a deployment concern).
- Replacing the existing New Relic agent in one go — Phase 2 ships the NR adapter; full retirement of `newrelic.js` is a future spec.
- A full structured-logging migration of every existing `console.*` callsite — Phase 1 migrates the noisiest, the rest is opportunistic ("Boy Scout Rule").

---

## Overview

Open Mercato today has **no shared logger**. Modules use ad-hoc `console.log/warn/error` with `[module:feature]` prefixes (e.g. `console.warn('[customers.comments] failed to enrich…', ctx)`). There is no log level control, no structured fields, no trace correlation, and no way for a module author to participate in observability beyond writing to stdout.

The only existing observability layer is **New Relic at the host process**: `newrelic.js` at the repo root, `newrelic@13.19.1` in `package.json`. The agent auto-instruments HTTP/SQL but module code can't emit custom spans, metrics, or structured logs into it without importing `newrelic` directly — which couples module code to a single vendor and an apm-license-gated SDK.

Third-party module authors, who are increasingly the consumer of `@open-mercato/core` (per the Backward Compatibility Contract in root `AGENTS.md`), have no observability seam at all today.

This spec proposes a thin, opt-in, vendor-neutral telemetry layer that fills both gaps without forcing any consumer to take on OTEL — or any specific vendor — they don't already want.

---

## Problem Statement

### P1 — No structured logger; no trace correlation in logs

Every `console.error('[messages:send-email] …', err)` produces an unstructured line that's hard to query, can't be downsampled, and has no `trace_id`/`span_id` to correlate with traces or external APM data. Operators can't ask "show me all logs for the request that failed at /api/orders" because nothing ties them together.

### P2 — Trace context dies at every boundary

Even if NR auto-instruments inbound HTTP, the trace context is dropped at:

- queue job enqueue → worker dequeue (no `traceparent` on the job),
- event bus publish → subscriber (no `traceparent` on the event envelope),
- SSE bridge from server → browser (no propagation header),
- outbound webhooks (no W3C Trace Context header on delivery).

This makes distributed traces unusable for any flow that crosses a worker, a subscriber, or a webhook — i.e. most non-trivial Open Mercato flows.

### P3 — No way for third-party modules to instrument

A module author building, say, an integration provider has no `withSpan('myprovider.sync.run')` to call. They can `console.log` (lost in stdout) or import `newrelic` (coupling to one vendor, breaking BC if NR is dropped). There is no platform contract for "emit a span, a counter, or a structured log."

### P4 — Coupling to OTEL concepts vs. coupling to OTEL SDK

OTEL is the de-facto standard for observability instrumentation. Spans, attributes, baggage, and W3C Trace Context are not "OTEL-specific" — they are how the entire industry models tracing now. Re-inventing them under a different name is the **OpenTracing-vs-OpenTelemetry mistake** and should not be repeated.

But the OTEL **SDK** is heavy (~3-5 MB installed, complex init, opinionated about resource detection) and not every Open Mercato deployment wants it. We need the conceptual API to feel OTEL-shaped *without* dragging the SDK into installs that don't enable telemetry.

### P5 — Coexistence with the existing New Relic agent

Existing deployments rely on `newrelic.js`. The new telemetry layer must not break them. It must be possible to (a) keep NR-only, (b) switch to OTEL-only, or (c) run NR for host-process auto-instrumentation while the new facade emits *additional* custom spans/metrics. We can't break (a) for users who haven't opted in.

### P6 — Issue #60 needs a place to land

Issue #60 calls for a centralized exception handler that consciously decides which exceptions surface vs. silently swallow. The natural home for that handler's output is the same telemetry facade — errors should be log records with span events attached to the active trace. Without the facade, #60 has nowhere to write to except `console.error` (the very pattern it's trying to fix).

---

## Proposed Solution

### S1 — New package: `@open-mercato/telemetry`

Add `packages/telemetry/` as a workspace. Layout:

```
telemetry/
├── AGENTS.md
├── README.md
├── package.json
├── src/
│   ├── index.ts                    # public exports
│   ├── facade/
│   │   ├── logger.ts               # logger interface + pino-backed default
│   │   ├── tracer.ts               # withSpan, currentSpan, setAttributes
│   │   ├── meter.ts                # counter, histogram, gauge
│   │   └── context.ts              # AsyncLocalStorage carrier for span context
│   ├── exporter/
│   │   ├── exporter.ts             # Exporter interface
│   │   ├── noop-exporter.ts
│   │   ├── console-exporter.ts
│   │   ├── otel-exporter.ts        # imports @opentelemetry/* (optional dep)
│   │   └── newrelic-exporter.ts    # imports newrelic (optional dep)
│   ├── instrumentation/
│   │   ├── nextjs.ts               # route handler / page span wrapping
│   │   ├── pg.ts                   # MikroORM/pg auto-instr
│   │   ├── undici.ts               # outbound fetch
│   │   ├── queue.ts                # span-per-job; carrier on job payload
│   │   ├── events.ts               # span-per-publish; carrier on event envelope
│   │   ├── sse.ts                  # propagate context to clients
│   │   └── webhooks.ts             # W3C Trace Context header on delivery
│   ├── env.ts                      # env parsing + telemetry config
│   ├── init.ts                     # initTelemetry()
│   └── __tests__/
└── tsconfig.json
```

Public API exports only the facade and `initTelemetry`/`registerExporter`. Module code never imports from `exporter/` or `instrumentation/` directly.

### S2 — Vendor-neutral facade

```ts
// @open-mercato/telemetry

export interface Logger {
  trace(obj: object | string, msg?: string): void
  debug(obj: object | string, msg?: string): void
  info(obj: object | string, msg?: string): void
  warn(obj: object | string, msg?: string): void
  error(obj: object | string, msg?: string): void
  fatal(obj: object | string, msg?: string): void
  child(bindings: Record<string, unknown>): Logger
}

export const logger: Logger

export interface SpanOptions {
  attributes?: Record<string, string | number | boolean>
  kind?: 'internal' | 'server' | 'client' | 'producer' | 'consumer'
}

export function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T> | T,
  opts?: SpanOptions,
): Promise<T>

export interface Span {
  setAttribute(key: string, value: string | number | boolean): void
  recordException(err: unknown): void
  setStatus(status: 'ok' | 'error', description?: string): void
  end(): void
}

export function counter(name: string, value: number, attrs?: Record<string, string>): void
export function histogram(name: string, value: number, attrs?: Record<string, string>): void
export function gauge(name: string, value: number, attrs?: Record<string, string>): void

export function initTelemetry(): Promise<void>

export interface Exporter {
  name: string
  start(): Promise<void>
  shutdown(): Promise<void>
  emitLog(record: LogRecord): void
  emitSpan(span: SpanData): void
  emitMetric(point: MetricPoint): void
}

export function registerExporter(exporter: Exporter): void
```

`logger`, `withSpan`, `counter`, `histogram`, `gauge` are **always** available. When telemetry is disabled, calls are short-circuited to a noop after a single `enabled === false` check. The facade itself has no heavy dependencies.

### S3 — Pluggable Exporter, OTEL as default

The package registers exporters through the `Exporter` interface. Built-in implementations:

| Exporter | Deps | Activation |
|---|---|---|
| `noop` | none | default when `OTEL_ENABLED` is unset |
| `console` | `pino` (pretty in dev) | `TELEMETRY_BACKEND=console` |
| `otel` | `@opentelemetry/*` (optional) | `OTEL_ENABLED=true` or `TELEMETRY_BACKEND=otel` |
| `newrelic` | `newrelic` (optional, already in repo) | `TELEMETRY_BACKEND=newrelic` |

OTEL packages live in `optionalDependencies`:

```jsonc
{
  "optionalDependencies": {
    "@opentelemetry/api": "^1.x",
    "@opentelemetry/sdk-node": "^0.x",
    "@opentelemetry/exporter-trace-otlp-http": "^0.x",
    "@opentelemetry/exporter-metrics-otlp-http": "^0.x",
    "@opentelemetry/exporter-logs-otlp-http": "^0.x",
    "@opentelemetry/instrumentation-pg": "^0.x",
    "@opentelemetry/instrumentation-undici": "^0.x"
  }
}
```

`otel-exporter.ts` is the **only** file that imports from `@opentelemetry/*`. Loading is dynamic (`await import('@opentelemetry/sdk-node')`) so the OTEL packages are resolved only when the exporter is actually constructed.

Custom exporters register via `registerExporter()` from app bootstrap before `initTelemetry()`.

### S4 — Activation and configuration

`initTelemetry()` is called once from:

- `apps/mercato/instrumentation.ts` (Next.js standard hook),
- worker bootstrap (`packages/queue` worker entrypoint),
- any custom standalone entry (e.g. CLI long-running commands).

No-op when `OTEL_ENABLED` is unset and no `TELEMETRY_BACKEND` is set.

Env variables:

| Var | Purpose |
|---|---|
| `OTEL_ENABLED` | shorthand toggle; `true` selects the OTEL exporter |
| `TELEMETRY_BACKEND` | explicit selector: `otel \| newrelic \| console \| noop` |
| `TELEMETRY_LOG_LEVEL` | `trace \| debug \| info \| warn \| error \| fatal` (default `info`) |
| `TELEMETRY_SAMPLING_RATIO` | `0.0`–`1.0` (default `1.0` dev / `0.1` prod) |
| `OTEL_SERVICE_NAME` | standard OTEL var |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | standard OTEL var |
| `OTEL_EXPORTER_OTLP_HEADERS` | standard OTEL var |
| `OTEL_RESOURCE_ATTRIBUTES` | standard OTEL var |

All standard OTEL env vars from the OpenTelemetry environment-variable spec are honored when the OTEL exporter is selected.

### S5 — Trace-context propagation

The package owns one `AsyncLocalStorage<SpanContext>` so `withSpan(name, fn)` works across `await` boundaries without consumers having to pass span objects manually.

Boundaries that need explicit propagation get one-line helpers from `instrumentation/`:

- **Queue jobs** — `enqueueWithContext()` injects `traceparent`/`tracestate` into the job payload's `meta`. The worker reads it and resumes the trace before invoking the handler. Job payload schema gains an optional `meta.traceparent` / `meta.tracestate` (additive, non-breaking). Existing jobs without context are handled (start a fresh root span).
- **Event bus** — `publishWithContext()` puts `traceparent` on the event envelope; subscribers resume the parent. Existing event subscribers continue to receive the full payload unchanged; the trace header is added under `envelope.traceparent` (additive).
- **SSE bridge** — server-emitted events include `traceparent` so the client (`useAppEvent`/`useOperationProgress`) can correlate. Browser-side correlation is opt-in (browser RUM is out of scope; this just makes it possible later).
- **Outbound webhooks** — `packages/webhooks` delivery wraps `fetch` so `traceparent` and `tracestate` headers are added per the W3C Trace Context spec, alongside existing Standard Webhooks signing.

### S6 — Auto-instrumentation surfaces (Phase 2)

When `OTEL_ENABLED=true`, `initTelemetry()` registers:

- **Next.js** — wrap route handlers (`/api/**`) and page renders. `http.method`, `http.route`, `http.status_code`, `om.tenant_id`, `om.organization_id` (when authenticated). Name: `HTTP <METHOD> <route>`.
- **MikroORM/pg** — `@opentelemetry/instrumentation-pg` for raw queries; we add a thin MikroORM-level span layer that names spans after the entity (`db.find Customer`, `db.persist Order`).
- **Outbound HTTP** — `@opentelemetry/instrumentation-undici` covers Node fetch.
- **Queue worker** — span per job (`queue.<queue-name> <job-id>`), attributes for queue name, attempt, duration. Errors recorded.
- **Event bus** — span per dispatch (`event.<event-id>`), child span per subscriber.
- **Cache** — `cache.get`/`cache.set` spans (lightweight; under sampling).

Built-in metrics (Phase 2):

| Metric | Type | Labels |
|---|---|---|
| `om.http.requests` | counter | route, method, status_class |
| `om.http.duration` | histogram | route, method |
| `om.queue.jobs` | counter | queue, status (ok/error) |
| `om.queue.duration` | histogram | queue |
| `om.queue.depth` | gauge | queue |
| `om.event.subscribers.duration` | histogram | event_id |
| `om.db.pool.in_use` / `om.db.pool.idle` | gauge | — |
| `om.cache.hits` / `om.cache.misses` | counter | layer, namespace |

All metric labels are **low-cardinality only**. Tenant/organization IDs are emitted as **span attributes**, never as metric labels (metric explosion + cost).

### S7 — Coexistence with New Relic

The `newrelic.js` agent and the new facade are not mutually exclusive:

- `TELEMETRY_BACKEND` unset → only the NR agent runs (today's behavior, unchanged).
- `TELEMETRY_BACKEND=otel` → OTEL exporter runs; NR agent can be disabled via existing NR env (`NEW_RELIC_ENABLED=false`) or left running for host-level traces in parallel (best-effort; double-spanning is documented).
- `TELEMETRY_BACKEND=newrelic` → custom spans/metrics are forwarded into NR's API via the NR adapter, complementing the agent's auto-instrumentation.

Long-term, retiring `newrelic.js` in favor of the OTEL exporter (which can ship to NR via OTLP) is a follow-up spec, not part of this work.

### S8 — Issue #60 integration

`packages/telemetry` exposes a thin error-funnel helper:

```ts
import { reportError } from '@open-mercato/telemetry'

// in a global handler / route wrapper
try { … } catch (err) { reportError(err, { module: 'orders', op: 'create' }); throw err }
```

`reportError` records the error on the active span, emits a structured log record, and increments an `om.errors` counter labeled by `module`. This gives #60 a single, vendor-neutral place to centralize "which exceptions are loud, which are silent" without each call site re-implementing the policy.

The exception-pipeline policy (silent vs. loud, sampling, rate-limiting noisy errors) is owned by #60's spec; this spec only provides the conduit.

---

## Architecture

### Layering

```
┌─────────────────────────────────────────────────────┐
│  module code (apps/, packages/core/src/modules/*)   │
│    logger.warn(...)   withSpan(...)   counter(...)  │
└──────────────────────┬──────────────────────────────┘
                       │  facade (always loaded, ~no deps)
                       ▼
┌─────────────────────────────────────────────────────┐
│           @open-mercato/telemetry/facade             │
│   AsyncLocalStorage<SpanContext>   level routing     │
└──────────────────────┬──────────────────────────────┘
                       │  Exporter interface
                       ▼
┌──────────┬──────────┬──────────┬─────────────────────┐
│  noop    │ console  │   otel   │   newrelic   │ ... │
│ (default)│  (pino)  │ (OTLP)   │  (NR API)    │     │
└──────────┴──────────┴──────────┴──────────────┴─────┘
```

### Trace-context propagation across boundaries

```
Inbound HTTP request
  ├─ Next.js instrumentation → start span
  │   ├─ AsyncLocalStorage carrier
  │   ├─ enqueueJob(..., { meta }) → meta.traceparent injected
  │   │     │
  │   │     └─► Worker → reads meta.traceparent → resumes trace → child span
  │   │
  │   ├─ events.emit('module.entity.action', payload)
  │   │     │
  │   │     └─► envelope.traceparent set → subscribers resume trace
  │   │
  │   ├─ webhook delivery → fetch with `traceparent` header
  │   │
  │   └─ SSE event → emitted with `traceparent` for client correlation
  │
  └─ end span; export via active Exporter
```

### Coexistence with existing observability

The facade is **purely additive**. Today's `console.*` callsites remain valid; the Phase 1 migration replaces only the noisiest. The New Relic agent continues to work; choosing an exporter is orthogonal to whether NR is loaded.

---

## Data Models

No new database tables.

**Schema deltas (additive, non-breaking):**

- Queue job payload schema gains optional `meta.traceparent: string` and `meta.tracestate?: string`. Existing jobs in flight without these fields continue to work (worker starts a fresh root span).
- Event envelope (in-memory shape only) gains optional `envelope.traceparent: string` and `envelope.tracestate?: string`. Persistent events stored in the event-store table get these fields in their payload JSON; reading legacy events without the fields is a no-op.

These are **wire-compatible**: subscribers and worker handlers ignore unknown envelope/meta fields today.

---

## API Contracts

### Public TypeScript surface (`@open-mercato/telemetry`)

| Export | Description |
|---|---|
| `logger` | always-on `Logger` instance; child loggers via `logger.child({ module: 'x' })` |
| `withSpan(name, fn, opts?)` | runs `fn` inside a span; auto-records exceptions and durations |
| `counter / histogram / gauge` | metric helpers |
| `initTelemetry()` | one-shot init from app/worker entrypoint |
| `registerExporter(exporter)` | plug a custom backend |
| `reportError(err, ctx?)` | error funnel for #60 integration |
| Types: `Logger`, `Span`, `SpanOptions`, `Exporter`, `LogRecord`, `SpanData`, `MetricPoint` | |

### HTTP API contracts

This package adds **no API routes**. It augments existing HTTP surfaces with span/metric emission only.

### Env contract

See **S4 — Activation and configuration** above. All variables are documented in `packages/telemetry/README.md`.

### Backward compatibility

Per the **Backward Compatibility Contract** in root `AGENTS.md`:

| Surface | Risk | Mitigation |
|---|---|---|
| Type definitions | none — package is new | — |
| Function signatures | none — package is new | — |
| Import paths | new package — STABLE from day 1; alias re-export from `@open-mercato/shared/lib/telemetry` if package boundary is later moved | — |
| Event IDs | none — no new events | — |
| Database schema | no schema changes | — |
| ACL feature IDs | none | — |
| Generated file contracts | none | — |
| Queue job payload | adds optional `meta.traceparent` | additive, ignored by older workers |
| Event envelope | adds optional `traceparent` | additive, ignored by older subscribers |

The package is **strictly additive** to the platform. Disabling it returns the system to current behavior.

---

## Phasing

### Phase 1 — Facade + structured logger (no OTEL dep)

- Create `packages/telemetry` with facade + pino-backed default logger.
- `console`/`noop` exporters only.
- `initTelemetry()` callable from `apps/mercato/instrumentation.ts`.
- AGENTS.md update with module-author guidance.
- Migrate the noisiest `console.*` callsites in `packages/core` and workers to `logger.*`. Remaining sites migrate opportunistically (Boy Scout Rule).
- No new runtime deps for users who don't import the package.

### Phase 2 — OTEL backend + auto-instrumentation

- Add `@opentelemetry/*` to `optionalDependencies`.
- OTEL exporter, OTLP traces/metrics/logs.
- Auto-instrumentation: Next.js, pg, undici, queue worker, event bus.
- Trace-context propagation: queue, events, SSE, webhooks.
- Built-in metrics catalog (S6).
- New Relic adapter for parallel/legacy use.

### Phase 3 — Exception pipeline integration

- Depends on issue #60 spec landing.
- Centralized exception handler routes through `reportError()`.
- Errors emit log records + span events with active trace context.
- Policy (silent vs. loud, sampling, rate-limiting) owned by #60's spec.

Each phase ships as its own PR. Phase 1 is independently valuable (modules get a real logger).

---

## Risks & Impact Review

| # | Risk | Severity | Affected area | Mitigation | Residual |
|---|---|---|---|---|---|
| R1 | OTEL SDK is heavy when enabled (~3-5 MB installed, init cost ~50-200 ms) | Medium | Bundle size + cold start when opt-in | `optionalDependencies`; off by default; dynamic `import()` in exporter; no runtime cost when disabled | Low — only deployments that opt in pay |
| R2 | Performance overhead of always-on tracing under high RPS | Medium | API latency | Default sampling 100% dev / 10% prod via `TELEMETRY_SAMPLING_RATIO`; counters/histograms are O(1) per call; AsyncLocalStorage carrier is cheap | Low |
| R3 | Double instrumentation when NR agent + OTEL both enabled | Low | Span explosion in vendor UI | Document recommended config; default exporter selector is exclusive; NR adapter for combined-vendor case | Low |
| R4 | Tenant/organization data leaking into low-cardinality metric labels (cost explosion in vendor) | High | Metrics ingest cost | Documented MUST rule: tenant/org IDs only as **span attributes**, never as metric labels; lint rule planned (out of scope here) | Low if rule followed |
| R5 | `console.*` migration drift — Phase 1 leaves many sites un-migrated | Low | Inconsistent log shape during transition | Boy Scout Rule; both forms remain valid; log levels filterable independently | Low |
| R6 | Trace-context fields polluting persistent event-store records | Low | DB rows slightly larger | Fields are short (~55 bytes for `traceparent`); only set when telemetry is active; opt-out per-publisher possible | Negligible |
| R7 | better-known issue: AsyncLocalStorage doesn't survive some edge cases (top-level setTimeout in worker pools) | Low | Lost trace context on rare boundaries | Document; provide `runWithContext(ctx, fn)` escape hatch | Low |
| R8 | Pinning the OTEL SDK version too tightly causes peer-dep churn | Medium | Upgrade friction for consumers | Pin only the exporter & instrumentation-pg/undici; let `@opentelemetry/api` float on caret; document upgrade procedure | Low |
| R9 | New Relic retirement timeline unclear; users may run both indefinitely | Low | Doc/operational complexity | Phase 2 ships NR adapter; deprecation plan is a follow-up spec, not this one | Low |
| R10 | Silent exporter failures (OTLP endpoint unreachable) hide telemetry | Low | Observability gap | Exporter writes its own start/shutdown errors via `console.error`; `om.telemetry.exporter.errors` counter fed by the noop fallback | Low |

---

## Final Compliance Report

- **New package** under `packages/` per root `AGENTS.md` ("Where to Put Code" rules). Naming `@open-mercato/telemetry` follows the convention.
- **No cross-module ORM relationships**: package adds no entities; queue/event additions are payload-only and additive.
- **Env-driven config**, no hardcoded vendor endpoints.
- **No raw `fetch`** in module code: package's outbound instrumentation wraps undici at the global level only.
- **Backward Compatibility Contract**: all 13 contract surfaces reviewed in API Contracts → Backward compatibility. No surface broken; queue/event payload extensions are additive per surface category 8 (additive-only DB schema) and 5 (event payload fields additive-only).
- **AGENTS.md guidance**: Phase 1 ships a `packages/telemetry/AGENTS.md` describing logger usage, span naming conventions, and the metric-label cardinality rule (R4).
- **Module decoupling**: package never imports from `packages/core/src/modules/*`. Modules opt in by importing the facade.
- **Generated files**: package adds nothing under `apps/mercato/.mercato/generated/`.

Touched areas (Phase 2/3, for reviewer awareness):
- `packages/queue` — payload `meta.traceparent` (additive).
- `packages/events` — envelope `traceparent` (additive).
- `packages/webhooks` — outbound delivery wraps `traceparent` header.
- `apps/mercato/instrumentation.ts` — calls `initTelemetry()`.

---

## Related

- **#60** — `feat: add global telemetry handler for exception handling`. Phase 3 of this spec implements the conduit; #60 owns the policy. Specs should be co-reviewed.

---

## Changelog

- **2026-04-29** — Initial draft (spec-only). No code yet.
