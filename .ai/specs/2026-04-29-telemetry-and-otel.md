# Telemetry Package with Pluggable OTLP Backend

## TLDR

Add a new optional package **`@open-mercato/telemetry`** that gives modules a vendor-neutral observability facade — structured logger, spans, counters, histograms, and an error funnel (`reportError`) — backed by a pluggable `TelemetryProvider` interface. The default provider speaks **OpenTelemetry (OTLP)**, shipped as an optional dependency; alternative providers (`console`, `noop`) plug in through the same seam. Any OTLP backend (New Relic, Datadog, Grafana/Tempo, Honeycomb, SigNoz, …) is a one-line env change — no adapter, no vendor SDK.

Telemetry is **disabled by default**. When off, the facade short-circuits after a single `enabled === false` check and the OTEL SDK is never required at runtime. When on (`TELEMETRY_BACKEND=…`), the package wires standard OTEL env vars, auto-instruments Next.js / Postgres / fetch, and propagates W3C trace context across queue jobs, the event bus, the SSE bridge, and outbound webhooks.

The package is **opt-in**: deployments that don't need observability pay zero install/runtime cost. It is **decoupled from any single vendor**: OTLP is the transport because it already covers every major backend, but the architecture locks no one in.

This design reflects a **working reference implementation** (Phase 1 + Phase 2 built and validated end-to-end against live OTLP backends). The notable corrections it produced — a **provider delegation model** for tracing (not a finished-span sink), a `globalThis` provider registry that survives bundled-vs-source worker module copies, queue trace carriers on the job `metadata` channel, and a first-class PII-hygiene posture — are folded into the sections below.

This spec also defines how **issue #60** ("global telemetry handler for exception handling") integrates: `reportError` is the conduit (shipped in Phase 1); #60 owns the policy (which exceptions are loud vs. silent, sampling, rate-limiting).

**In scope:**

- New `packages/telemetry` workspace.
- Vendor-neutral facade: `logger`, `withSpan`, `counter`, `histogram`, `gauge`, `reportError`, `initTelemetry`, `TelemetryProvider`, `registerProvider`.
- Pino-based default logger; `trace_id`/`span_id` auto-stamped when a span is active.
- OTLP provider (delegation model) as an optional dep; `console`/`noop` providers with no heavy deps.
- Error reporting via OTLP exception records on the active span + a structured error log + an `om.errors` counter.
- W3C trace-context propagation across HTTP, queue jobs, event bus dispatch, SSE bridge, outbound webhooks.
- Auto-instrumentation of Next.js handlers, MikroORM/pg, undici/fetch, the queue worker, and event-bus dispatch.
- PII-hygiene posture: `pg` parameter-value capture disabled, an email-redaction backstop, tenant/org/user IDs as opaque span attributes only.
- Built-in metrics: standard `http.server.request.duration` plus `om.*` for what has no semconv equivalent.
- AGENTS.md guidance for module authors.

**Out of scope:**

- Vendor-specific dashboards, alert rules, or SLOs.
- Browser/RUM telemetry and customer-portal frontend telemetry.
- Log aggregation infrastructure (shipping logs to a backend is a deployment concern).
- Replacing the existing New Relic agent in one go — modern NR ingests OTLP, so it is reachable as a plain OTLP backend; full retirement of the legacy `newrelic.js` host agent is a future spec.
- A full structured-logging migration of every existing `console.*` callsite — Phase 1 migrates the noisiest, the rest is opportunistic ("Boy Scout Rule").
- **AI SDK call instrumentation.** Open Mercato ships the Vercel AI SDK (`ai@^6`) across `core`/`search`/`ai-assistant`, but no call site enables `experimental_telemetry` today, so this package emits no `ai.*` spans on its own. Turning it on is per-call-site (or chokepoint) opt-in that belongs to the AI module, concentrates the prompt/completion PII-review burden, and does not lift from any reference implementation. It is a **follow-up owned by `ai-assistant`** (see S6) — once telemetry is enabled, the OTEL tracer this package installs makes those spans light up with one change at the model-factory chokepoint.

---

## Overview

Open Mercato today has **no shared logger**. Modules use ad-hoc `console.log/warn/error` with `[module:feature]` prefixes (e.g. `console.warn('[customers.comments] failed to enrich…', ctx)`). There is no log level control, no structured fields, no trace correlation, and no way for a module author to participate in observability beyond writing to stdout.

The only existing observability layer is **New Relic at the host process**: `newrelic@^14` in `package.json` (root and `apps/mercato`). The agent auto-instruments HTTP/SQL but module code can't emit custom spans, metrics, or structured logs into it without importing `newrelic` directly — which couples module code to a single vendor and an apm-license-gated SDK.

Third-party module authors, who are increasingly the consumer of `@open-mercato/core` (per the Backward Compatibility Contract in root `AGENTS.md`), have no observability seam at all today.

This spec proposes a thin, opt-in, vendor-neutral telemetry layer that fills both gaps without forcing any consumer to take on OTEL — or any specific vendor — they don't already want.

---

## Problem Statement

### P1 — No structured logger; no trace correlation in logs

Every `console.error('[messages:send-email] …', err)` produces an unstructured line that's hard to query, can't be downsampled, and has no `trace_id`/`span_id` to correlate with traces or external APM data. Operators can't ask "show me all logs for the request that failed at /api/orders" because nothing ties them together.

### P2 — Trace context dies at every boundary

Even if NR auto-instruments inbound HTTP, the trace context is dropped at:

- queue job enqueue → worker dequeue (no trace carrier on the job),
- event bus publish → subscriber (no trace carrier on the event envelope),
- SSE bridge from server → browser (no propagation header),
- outbound webhooks (no W3C Trace Context header on delivery).

This makes distributed traces unusable for any flow that crosses a worker, a subscriber, or a webhook — i.e. most non-trivial Open Mercato flows.

### P3 — No way for third-party modules to instrument

A module author building, say, an integration provider has no `withSpan('myprovider.sync.run')` to call. They can `console.log` (lost in stdout) or import `newrelic` (coupling to one vendor, breaking BC if NR is dropped). There is no platform contract for "emit a span, a counter, or a structured log."

### P4 — Coupling to OTEL concepts vs. coupling to OTEL SDK

OTEL is the de-facto standard for observability instrumentation. Spans, attributes, baggage, and W3C Trace Context are not "OTEL-specific" — they are how the entire industry models tracing now. Re-inventing them under a different name is the **OpenTracing-vs-OpenTelemetry mistake** and should not be repeated.

But the OTEL **SDK** is heavy (~3-5 MB installed, complex init, opinionated about resource detection) and not every Open Mercato deployment wants it. We need the conceptual API to feel OTEL-shaped *without* dragging the SDK into installs that don't enable telemetry.

### P5 — Coexistence with the existing New Relic agent

Existing deployments rely on `newrelic`. The new telemetry layer must not break them. It must be possible to (a) keep NR-only, (b) switch to OTEL-only, or (c) run NR for host-process auto-instrumentation while the new facade emits *additional* custom spans/metrics. We can't break (a) for users who haven't opted in.

### P6 — Issue #60 needs a place to land

Issue #60 calls for a centralized exception handler that consciously decides which exceptions surface vs. silently swallow. The natural home for that handler's output is the same telemetry facade — errors should be log records with span exceptions attached to the active trace. Without the facade, #60 has nowhere to write to except `console.error` (the very pattern it's trying to fix).

---

## Proposed Solution

### S1 — New package: `@open-mercato/telemetry`

Add `packages/telemetry/` as a workspace. Layout:

```
telemetry/
├── AGENTS.md
├── README.md
├── package.json
├── build.mjs / watch.mjs            # esbuild, mirrors packages/queue
├── src/
│   ├── index.ts                     # public facade exports
│   ├── facade/
│   │   ├── logger.ts                # logger interface + pino-backed default
│   │   ├── tracer.ts                # withSpan, currentSpan, setAttributes
│   │   ├── meter.ts                 # counter, histogram, gauge (optional UCUM unit)
│   │   ├── context.ts               # AsyncLocalStorage carrier for span context
│   │   ├── report-error.ts          # reportError funnel (span exception + error log + counter)
│   │   ├── propagation.ts           # captureTraceContext / continueTrace
│   │   ├── redact.ts                # redactPii backstop (emails)
│   │   └── serialize.ts             # serializeError (stack-only, cause-folded, PII-safe)
│   ├── provider/
│   │   ├── provider.ts              # TelemetryProvider interface + capability flags
│   │   ├── registry.ts              # registerProvider / resolve-from-env (globalThis-held)
│   │   ├── noop-provider.ts
│   │   ├── console-provider.ts      # pino pretty in dev
│   │   ├── otlp-provider.ts         # the ONLY file importing @opentelemetry/* (optional dep)
│   │   └── run-span.ts              # shared sync+async span lifecycle helper
│   ├── instrumentation/
│   │   ├── nextjs.ts                # route handler / page span wrapping
│   │   ├── pg.ts                    # MikroORM/pg auto-instr (param-value capture OFF)
│   │   ├── undici.ts                # outbound fetch
│   │   ├── queue.ts                 # span-per-job; carrier on job payload
│   │   ├── events.ts               # span-per-publish; carrier on event envelope
│   │   ├── sse.ts                   # propagate context to clients
│   │   └── webhooks.ts              # W3C Trace Context header on delivery
│   ├── env.ts                       # env parsing + telemetry config
│   ├── init.ts                      # initTelemetry()
│   └── __tests__/
└── tsconfig.json
```

Public API exports only the facade and `initTelemetry`/`registerProvider`. Module code never imports from `provider/` or `instrumentation/` directly.

**Why a package, not an app module.** Telemetry is a cross-cutting platform concern that `packages/{core,queue,events,webhooks,cli,ui}` must be able to import to do propagation and auto-instrumentation. Dependency direction only flows packages → app, so a module under `apps/mercato/src/modules/` could never be imported by those packages — which would make Phase 2 (boundary propagation) impossible. A package is also the only form that ships to third-party module authors as a stable `@open-mercato/telemetry` import, satisfying the Backward Compatibility Contract's "give module authors a seam" goal. (A reference implementation built this as an `@app` module only because that deployment could not add workspace packages; its facade was kept package-shaped precisely so it could lift to `packages/telemetry` here.)

### S2 — Vendor-neutral facade + provider delegation model

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

export interface Span {
  setAttribute(key: string, value: string | number | boolean): void
  recordException(err: unknown): void
  setStatus(status: 'ok' | 'error', description?: string): void
  end(): void
}

export function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T> | T,
  opts?: SpanOptions,
): Promise<T>

export function counter(name: string, value: number, attrs?: Record<string, string>, unit?: string): void
export function histogram(name: string, value: number, attrs?: Record<string, string>, unit?: string): void
export function gauge(name: string, value: number, attrs?: Record<string, string>, unit?: string): void

export function reportError(err: unknown, ctx?: Record<string, unknown>): void

export function initTelemetry(): Promise<void>
export function registerProvider(provider: TelemetryProvider): void
```

`logger`, `withSpan`, `counter`, `histogram`, `gauge`, `reportError` are **always** available. When telemetry is disabled, calls short-circuit to a noop after a single `enabled === false` check. The facade itself has no heavy dependencies.

#### The `TelemetryProvider` interface — tracing is delegation, not a span sink

```ts
export type TelemetrySignal = 'traces' | 'metrics' | 'logs' | 'errors'

export interface TelemetryProvider {
  name: string
  supports: TelemetrySignal[]                 // capability flags — unsupported signals no-op
  start(): Promise<void>
  shutdown(): Promise<void>                    // forceFlush + provider teardown

  // Tracing uses a DELEGATION model: the provider creates the span and runs `fn`
  // inside its active context, so OTEL auto-instrumentation (pg/http/undici) nests
  // under it in one trace.
  runInSpan<T>(name: string, options: SpanOptions, fn: (span: Span) => T): T
  activeSpan(): Span | undefined

  // Cross-boundary propagation (Phase 2): write the active trace context into a
  // carrier, and continue a trace from a carrier under a new active span.
  inject(carrier: Record<string, string>): void
  runInRemoteSpan<T>(carrier: Record<string, string>, name: string, options: SpanOptions, fn: (span: Span) => T): T

  // Logs and metrics stay sink-style (fire-and-forget).
  emitLog(record: LogRecord): void
  recordMetric(point: MetricPoint): void

  // Lets logger stamp trace_id/span_id onto stdout lines (undefined for noop/console).
  activeTraceContext?(): { traceId: string; spanId: string } | undefined
}
```

> **Tracing must be delegation, not an `emitSpan(SpanData)` sink** — this is the single most important correction the reference implementation produced. An earlier sketch had the facade own the span lifecycle and hand a *finished* `SpanData` to the provider. That cannot work with real OTEL auto-instrumentation: the `pg`/HTTP/undici instrumentations create their own spans and read the parent from **OTEL's active-span context**. A finished-span sink is never the active parent, so auto-spans orphan into separate traces and the headline "follow a request into its DB queries" waterfall never forms. So the provider owns span creation and runs `fn` inside the span's active context (`runInSpan`), recording exceptions/duration on settle (a shared `run-span.ts` helper handles sync + async uniformly). `activeSpan()` bridges `reportError`/`currentSpan` to whatever span is active — including auto-instrumented ones. Logs/metrics are genuinely fire-and-forget, so they remain sinks. This mirrors OTEL's own `startActiveSpan` shape.

The facade resolves **one active provider** from `TELEMETRY_BACKEND` and, for each emitted signal, calls the matching method only if `supports` includes it (else no-op).

### S3 — Pluggable provider, OTLP as default

Built-in providers:

| Provider | Deps | Activation |
|---|---|---|
| `noop` | none | default when `TELEMETRY_BACKEND` is unset |
| `console` | `pino` (pretty in dev) | `TELEMETRY_BACKEND=console` |
| `otlp` | `@opentelemetry/*` (optional) | `TELEMETRY_BACKEND=otlp` (also accepts vendor aliases like `newrelic`, `signoz` → same OTLP provider, different endpoint) |

OTEL packages live in **`optionalDependencies`**, declared `optional` via `peerDependenciesMeta` (the pattern `packages/queue` already uses for `bullmq`), so installs that don't enable telemetry never resolve them:

```jsonc
{
  "optionalDependencies": {
    "@opentelemetry/api": "^1.x",
    "@opentelemetry/core": "^1.x",
    "@opentelemetry/sdk-node": "^0.x",
    "@opentelemetry/exporter-trace-otlp-http": "^0.x",
    "@opentelemetry/exporter-metrics-otlp-http": "^0.x",
    "@opentelemetry/exporter-logs-otlp-http": "^0.x",
    "@opentelemetry/instrumentation-pg": "^0.x",
    "@opentelemetry/instrumentation-undici": "^0.x"
  }
}
```

`otlp-provider.ts` is the **only** file that imports from `@opentelemetry/*`, loaded via dynamic `await import()` so the SDK resolves only when the provider is actually constructed. The OTEL packages are externalized from the build.

**Worker-bundle copies share one provider via `globalThis`.** The CLI worker bootstrap esbuild-bundles the generated DI registry, which can pull in a *private copy* of the telemetry module while job handlers load the *source* copy. To stop init setting the provider on one copy while handlers read a still-noop other, the resolved active provider is held on a `globalThis` registry key (`registry.ts`). Both copies — and any future bundling boundary — share the single instance.

Backends with no OTLP-native endpoint, or that need richer per-signal control, can register a custom provider via `registerProvider()` from app bootstrap before `initTelemetry()`.

### S4 — Activation and configuration

`initTelemetry()` is called once from:

- `apps/mercato/instrumentation.ts` (Next.js standard hook; to be added — none exists today),
- the **CLI entry** in `packages/cli` (`bin.ts`) — for every bootstrap-requiring command (worker, scheduler, …), *before* the app module graph loads. Worker processes do not run `instrumentation.ts`.
- any custom standalone entry (e.g. long-running CLI commands).

All call paths are idempotent. No-op when `TELEMETRY_BACKEND` is unset.

**Load-order requirement (worker/scheduler DB spans).** OpenTelemetry's `pg`/`undici` auto-instrumentation only records spans for a module required *after* the SDK has started. A worker process loads MikroORM's Postgres driver (`@mikro-orm/postgresql` → `pg`) during CLI bootstrap and per-job container creation. If `initTelemetry()` runs only inside `runWorker` (after bootstrap), the `pg` queries inside job handlers emit **no spans** — the trace shows only the bullmq-otel `add`/`process`/`complete` envelope, with an empty job body. The fix: `bin.ts` calls `initTelemetry()` **before** it dynamically imports the mercato entry (so nothing app-side loads `pg` first). Verified end-to-end against a live OTLP backend: unfixed worker → `process` span with zero `pg` children; fixed worker → the full `findPendingVerification` query tree nested under `process <queue>`. (The in-process `runWorker` init remains as an idempotent fallback.)

Env variables:

| Var | Purpose |
|---|---|
| `TELEMETRY_BACKEND` | selector: `otlp \| console \| noop` (vendor aliases such as `newrelic`/`signoz` map to `otlp`); default unset = `noop`/off |
| `TELEMETRY_LOG_LEVEL` | `trace \| debug \| info \| warn \| error \| fatal` (default `info`) — gates **both** stdout **and** the OTLP backend export, so below-level records never ship to the backend (remote volume/cost control, not just stdout) |
| `TELEMETRY_LOG_PRETTY` | human-readable stdout logs (default on in dev) |
| `TELEMETRY_SAMPLING_RATIO` | `0.0`–`1.0` (default `1.0` dev / `0.1` prod) |
| `OTEL_SERVICE_NAME` | standard OTEL var (one stable service name across environments) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | standard OTEL var |
| `OTEL_EXPORTER_OTLP_HEADERS` | standard OTEL var (e.g. ingestion key) |
| `OTEL_RESOURCE_ATTRIBUTES` | standard OTEL var (carry `deployment.environment` here to separate envs under one service) |

All standard OTEL env vars from the OpenTelemetry environment-variable spec are honored when the OTLP provider is selected. Switching backend is changing `TELEMETRY_BACKEND` + its endpoint/headers; adding another OTLP backend later is **no new code**.

### S5 — Trace-context propagation

The package owns one `AsyncLocalStorage<SpanContext>` so `withSpan(name, fn)` works across `await` boundaries without consumers passing span objects manually.

Boundaries that need explicit propagation get one-line helpers (`captureTraceContext()` / `continueTrace(carrier, name, fn)`) and, where the platform owns the boundary, automatic wrapping:

- **Queue jobs (per-strategy split)** — Open Mercato's queue has two strategies, handled by the best mechanism for each:
  - **`local`** (file-based; dev default, no-Redis fallback) — W3C context rides on the job's **`metadata._trace` carrier**. `QueuedJob` already has an (unused) `metadata` field; the strategy threads it through, so the carrier uses this **first-class metadata channel** rather than polluting the user payload. **Zero per-callsite code**: `packages/queue` auto-injects at `enqueue` (`attachTraceMetadata`) and auto-continues at dispatch (`runJobInTrace(name, job.metadata, …)` → `continueTrace(carrier, \`queue.${queue}\`, …, { kind: 'consumer' })`). Jobs without a carrier start a fresh root span (additive, non-breaking).
  - **`async`** (BullMQ; prod) — when an OTLP backend is active (`isOtelSdkBackend()`), the strategy delegates to **`bullmq-otel`** (passed as the `telemetry` option to the BullMQ `Queue` + `Worker`), which emits richer BullMQ-internal spans (`add`/`process`, queue-wait, attempts) and propagates context via the **global** propagator — which works precisely because the backup-header propagator (below) keeps the global `extract` functional. Our `metadata._trace` carrier is **skipped on this path** to avoid double-instrumentation. When telemetry is off / a non-OTEL backend is selected / `bullmq-otel` isn't installed, it gracefully falls back to the `metadata._trace` carrier. `bullmq-otel` is an optional dependency.
  - **Because events and webhooks ride the queue, both mechanisms cover them too** (see below) — the consumer (events worker / webhook delivery worker) runs inside whichever trace context the active strategy restored.
- **Event bus** — persistent (queue-backed) subscribers are covered automatically: the event bus enqueues `{ event, payload, options }`, so the queue carrier links the subscriber dispatch to the publisher's trace with no event-bus code. Ephemeral (in-process) subscribers run synchronously inside `emit()`, in the publisher's async-context span, so they are already in-trace. (A named `event.<id>` child span per dispatch is an optional refinement, not required for continuity.)
- **Outbound webhooks** — delivery is queued (`enqueueWebhookDelivery` → worker), so it inherits the queue carrier: the delivery worker runs inside the continued trace, and the `undici` auto-instrumentation then injects `traceparent`/`tracestate` onto the outbound `fetch` automatically (alongside the existing Standard Webhooks signing). No webhooks-package change needed.
- **SSE bridge (deferred)** — server-emitted events could include `traceparent` so the client (`useAppEvent`/`useOperationProgress`) can correlate. This is **out of scope** (browser RUM is out of scope), so it is not wired; the server emit point (`events` SSE route) is the place to add it later.

> **Root-per-request behind a proxy/load balancer (backup-header propagator).** Some infra (e.g. GCP's load balancer) reads the inbound `traceparent`, creates its own span, and **rewrites** `traceparent` to point at that unexported span — so a plain W3C extract makes every request a child of an infra trace the backend never sees, and root-span / "trace groups" views come up empty. The OTLP provider's **global propagator** solves this with the industry backup-header pattern: on inject it also writes `x-original-traceparent` (which the LB leaves untouched); on extract it **continues from the backup when present** (our own services/jobs carry it — so service-to-service traces survive the LB rewrite) and **roots when only a bare `traceparent` is present** (the LB or an untrusted external caller). `TELEMETRY_TRUST_INBOUND_TRACE=true` flips the bare branch to continue. This keeps the global `extract` **functional** — so carrier-round-tripping instrumentation like **`bullmq-otel`** (which inject/extract via the global propagator) works through it — rather than the earlier blunt no-op-extract that crippled all global extraction. Our hand-rolled queue/event carrier is independent (it uses a dedicated `queuePropagator` directly), so it is unaffected either way.

### S6 — Auto-instrumentation surfaces

When `TELEMETRY_BACKEND` is set, `initTelemetry()` registers:

- **Next.js** — wrap route handlers (`/api/**`) and page renders. `http.method`, `http.route`, `http.status_code`, `om.tenant_id`, `om.organization_id` (when authenticated). The shared API handler chokepoint is the natural hook for hand-rolled routes.
- **MikroORM/pg** — `@opentelemetry/instrumentation-pg` for raw queries (every Knex/MikroORM SQL query becomes a span with duration → DB-call monitoring + slow-query view). **Parameter-value capture is disabled** (`enhancedDatabaseReporting: false`, centralized and regression-tested) — see Privacy.
- **Outbound HTTP** — `@opentelemetry/instrumentation-undici` covers Node fetch.
- **Queue worker** — span per job (`queue.<queue-name>`), attributes for queue name, attempt, duration. Errors recorded. Continues the producer trace (S5).
- **Event bus** — span per dispatch (`event.<event-id>`), child span per subscriber.
- **Cache** — `cache.get`/`cache.set` spans (lightweight; under sampling).

> **AI SDK spans are a follow-up owned by `ai-assistant`, not part of this package.** Open Mercato ships the Vercel AI SDK (`ai@^6`) across `core`/`search`/`ai-assistant`, and the OTLP provider installs a global tracer the AI SDK can emit into — but the SDK only emits `ai.*` spans when a call passes `experimental_telemetry: { isEnabled: true }`, which no call site does today. Enabling it is per-call-site (or chokepoint) opt-in, concentrates the prompt/completion PII-review burden, and is module-owned. The clean home is the **model-factory chokepoint** (`packages/ai-assistant/.../model-factory.ts` / `packages/shared/src/lib/ai/llm-provider.ts`): enable telemetry once there with `recordInputs`/`recordOutputs` **forced off** so prompts/completions never reach spans, rather than editing all 15 call sites. Tracked as a follow-up; this PR ships no AI instrumentation.

Built-in metrics — prefer **OpenTelemetry semantic-convention** instruments where one exists, reserve `om.*` for what has none:

| Metric | Type | Labels | Notes |
|---|---|---|---|
| `http.server.request.duration` | histogram (`s`) | `http.request.method`, `http.route`, `http.response.status_code`, `error.type` | semconv standard; request count derives from histogram count |
| `om.errors` | counter | `module` | app-specific; no semconv equivalent |
| `om.queue.jobs` / `om.queue.duration` | counter / histogram | queue, status | partial — RED is also derivable by the backend from queue spans |
| `om.queue.depth` | gauge | queue | needs a core queue hook |
| `om.event.subscribers.duration` | histogram | event_id | |
| `om.db.pool.in_use` / `om.db.pool.idle` | gauge | — | needs a core ORM hook |
| `om.cache.hits` / `om.cache.misses` | counter | layer, namespace | needs a core cache hook |

All metric labels are **low-cardinality only**. Tenant/organization/user IDs are emitted as **span attributes**, never as metric labels (metric explosion + cost).

### S7 — Coexistence with New Relic

The legacy `newrelic.js` agent and the new facade are not mutually exclusive:

- `TELEMETRY_BACKEND` unset → only the NR agent runs, if configured (today's behavior, unchanged).
- `TELEMETRY_BACKEND=otlp` pointed at any backend → the OTLP provider runs; the NR agent can be disabled via existing NR env (`NEW_RELIC_ENABLED=false`) or left running for host-level traces in parallel (best-effort; double-spanning is documented).
- **Modern New Relic ingests OTLP** (`otlp.nr-data.net`), so NR is reachable as a plain OTLP backend — a one-env-var switch, **no adapter and no proprietary SDK**. The pluggable provider model keeps a custom NR-API adapter possible via `registerProvider()` if a deployment ever needs the agent's proprietary feature set, but it is not required.

Long-term, retiring the legacy `newrelic.js` host agent in favor of the OTLP provider (which ships to NR via OTLP) is a follow-up spec, not part of this work.

### S8 — Error reporting and issue #60 integration

`reportError` ships in **Phase 1** as the vendor-neutral conduit — it needs no vendor SDK:

```ts
import { reportError } from '@open-mercato/telemetry'

// in a global handler / route wrapper
try { … } catch (err) { reportError(err, { module: 'orders', op: 'create' }); throw err }
```

`reportError`:
1. records the exception on the **active span** (`span.recordException(err)` + `setStatus('error')`),
2. emits a structured `logger.error` record (OTLP log),
3. increments the `om.errors` counter (labeled by `module` only).

It is wired into the platform's shared error seam (the API handler wrapper → `reportError` on 5xx; 4xx stays a `logger.warn`). The error payload is PII-scrubbed (stack-only, cause-folded; `redactPii` backstop — see Privacy).

The **policy** layer — which exceptions are loud vs. silent, sampling, rate-limiting noisy errors — is owned by **issue #60's spec** (Phase 3). This spec only provides the conduit; #60 plugs its policy in front of `reportError`.

---

## Privacy — PII hygiene

Telemetry can leak personal data through logs, error payloads, AI prompts/completions, and — most insidiously — **captured SQL parameter values**. The posture is **don't-emit** rather than scrub, with an active redaction backstop:

- **No PII in span attributes or logs.** Spans/logs carry `tenant_id`/`organization_id`/`user_id` (opaque UUIDs) only — never names, emails, message content, or record values. Callers pass no PII.
- **`pg` parameter-value capture disabled.** `@opentelemetry/instrumentation-pg` runs with `enhancedDatabaseReporting: false`, centralized in a single `PG_INSTRUMENTATION_OPTIONS` constant and locked by a regression test — bound SQL parameters can contain user data, so we capture statement *shape* without values. With DB tracing as a headline feature, this is the main server-side leak vector.
- **AI prompt/completion content (follow-up).** This PR ships no AI instrumentation (S6). When `ai-assistant` later enables AI SDK telemetry at the model-factory chokepoint, it MUST force `recordInputs: false` / `recordOutputs: false` so prompts/completions never reach spans.
- **Redaction backstop.** `redactPii()` scrubs the highest-signal leaked identifier — email addresses — from error-log message + stack (`serializeError`) and from span exceptions (covering both `reportError` and the auto record-on-throw path). Intentionally conservative (emails only) to preserve UUID/debug fidelity; the single point to extend if a new leak vector appears.
- **Data residency is a deployment choice.** Because the transport is plain OTLP, the backend (and its region) is an env change; this spec makes no hosting decision.

---

## Architecture

### Layering

```
┌─────────────────────────────────────────────────────┐
│  module code (apps/, packages/*/src/modules/*)      │
│  logger.warn(...) withSpan(...) reportError(err)    │
│  counter(...)                                        │
└──────────────────────┬──────────────────────────────┘
                       │  facade (always loaded, ~no deps)
                       ▼
┌─────────────────────────────────────────────────────┐
│           @open-mercato/telemetry/facade             │
│  AsyncLocalStorage<SpanContext>  level routing       │
│  capability gate                                     │
└──────────────────────┬──────────────────────────────┘
                       │  ONE active TelemetryProvider (globalThis-held)
                       ▼
┌──────────┬──────────┬─────────────────────────────────┐
│  noop    │ console  │  otlp → any OTLP backend         │
│ (default)│  (pino)  │  traces · metrics · logs · err   │
└──────────┴──────────┴─────────────────────────────────┘
```

### Trace-context propagation across boundaries

```
Inbound HTTP request
  ├─ Next.js instrumentation → start span (proxy traceparent ignored on extract)
  │   ├─ AsyncLocalStorage carrier
  │   ├─ pg / undici auto-spans nest via OTEL active context
  │   ├─ enqueueJob(...) → job.metadata._trace injected automatically
  │   │     └─► Worker dispatch → continueTrace(metadata._trace) → child span
  │   │        (also covers persistent event subscribers + webhook delivery)
  │   ├─ events.emit('module.entity.action', payload)
  │   │     └─► envelope.traceparent set → subscribers resume trace
  │   ├─ webhook delivery → fetch with `traceparent` header
  │   └─ SSE event → emitted with `traceparent` for client correlation
  │
  └─ end span; forceFlush; export via active provider
```

### Coexistence with existing observability

The facade is **purely additive**. Today's `console.*` callsites remain valid; Phase 1 migrates only the noisiest. The New Relic agent continues to work; choosing a provider is orthogonal to whether NR is loaded.

---

## Data Models

No new database tables.

**Schema deltas (additive, non-breaking):**

- `QueuedJob.metadata` gains an optional `_trace` carrier (`{ traceparent?: string, tracestate?: string }`). `metadata` already exists on the type but was unused; both queue strategies now thread it through (the first-class metadata channel), so the carrier never touches the user payload. Existing jobs in flight without it continue to work (worker starts a fresh root span). Persistent events and queued webhook deliveries inherit this automatically since they ride the queue.

This is **wire-compatible**: worker handlers read `job.payload`, not `job.metadata`, so they are entirely unaffected; the carrier is invisible to them.

---

## API Contracts

### Public TypeScript surface (`@open-mercato/telemetry`)

| Export | Description |
|---|---|
| `logger` | always-on `Logger` instance; child loggers via `logger.child({ module: 'x' })` |
| `withSpan(name, fn, opts?)` | runs `fn` inside a span; auto-records exceptions and durations |
| `counter / histogram / gauge` | metric helpers (optional UCUM `unit`) |
| `reportError(err, ctx?)` | error funnel: span exception + error log + `om.errors` counter |
| `captureTraceContext()` / `continueTrace(carrier, name, fn)` | producer/consumer propagation across async boundaries |
| `initTelemetry()` | one-shot init from app/worker entrypoint |
| `registerProvider(provider)` | plug a custom backend before init |
| Types: `Logger`, `Span`, `SpanOptions`, `TelemetryProvider`, `TelemetrySignal`, `LogRecord`, `MetricPoint`, `TraceCarrier` | |

### HTTP API contracts

This package adds **no API routes**. It augments existing HTTP surfaces with span/metric emission only. An optional read-only "telemetry status" backend page (active provider + health) may be added later as a thin core module re-exporting from the package.

### Env contract

See **S4 — Activation and configuration**. All variables are documented in `packages/telemetry/README.md`.

### Backward compatibility

Per the **Backward Compatibility Contract** in root `AGENTS.md`:

| Surface | Risk | Mitigation |
|---|---|---|
| Type definitions | none — package is new | — |
| Function signatures | none — package is new | — |
| Import paths | new package — STABLE from day 1 | alias re-export from `@open-mercato/shared/lib/telemetry` if the boundary is later moved |
| Event IDs | none — no new events | — |
| Database schema | no schema changes | — |
| ACL feature IDs | none (optional `telemetry.view` if a status page lands) | declared in `acl.ts` with `setup.ts` default-role grant if added |
| Generated file contracts | none | — |
| Queue job metadata | adds optional `metadata._trace` | additive; handlers read `payload`, not `metadata` |

The package is **strictly additive** to the platform. Disabling it returns the system to current behavior.

---

## Phasing

Phases are **development milestones**; the contribution lands upstream as **one coordinated set** (the cross-package wiring in queue/events/webhooks/cli only makes sense together).

### Phase 1 — Facade + structured logger + within-process tracing + error reporting

- Create `packages/telemetry` with facade + pino-backed default logger.
- `noop`/`console` providers and the `otlp` provider (delegation model), OTEL deps optional + dynamic import.
- Within-process auto-instrumentation: Next.js, `pg` (param-value capture off), undici. (AI SDK spans are a follow-up owned by `ai-assistant` — see S6.)
- `reportError` wired into the shared API handler error seam; `om.errors` + `http.server.request.duration`.
- `initTelemetry()` from `apps/mercato/instrumentation.ts` (to be added) with `forceFlush` on shutdown.
- Log↔trace correlation (`trace_id`/`span_id` stamped onto stdout lines).
- PII-hygiene posture (S6 Privacy) + `redactPii` backstop.
- AGENTS.md update with module-author guidance (logger usage, span naming, metric-label cardinality rule).
- Migrate the noisiest `console.*` callsites in `packages/core` and workers; the rest opportunistically.

### Phase 2 — Cross-boundary propagation + worker telemetry + metrics

- Worker-process init via `runWorker` in `packages/queue` (the single bootstrap every standalone worker passes through; idempotent, so in-process workers re-use the web init); `globalThis` provider registry.
- W3C trace context across the queue on the `metadata._trace` channel — auto-inject at `enqueue` + auto-continue at the strategy dispatch (`local` and `async`), zero per-worker code. **This single change also covers persistent event subscribers and outbound webhook delivery**, since both ride the queue. Ephemeral (in-process) subscribers are already in-trace (synchronous within `emit()`). SSE-bridge `traceparent` is deferred (browser RUM out of scope).
- Queue/webhook/event RED metrics are derived by the backend from the spans emitted above (matching the Phase 1 stance); explicit `om.queue.*` counters and depth/pool gauges remain a follow-up (need extra core hooks).
- Root-per-request propagator (ignore inbound HTTP trace context behind a proxy) — shipped in Phase 1's OTLP provider.

### Phase 3 — Exception-pipeline policy + optional status page

- Depends on issue #60's spec landing.
- Centralized exception handler routes through `reportError()` with policy (silent vs. loud, sampling, rate-limiting).
- Optional read-only "telemetry status" backend page.

---

## Testing

All tests run in the existing jest suites (`yarn workspace … test`) — no network, no database, no extra runner — so a downstream consumer (incl. upstream) inherits zero new CI burden.

**`packages/telemetry` (50 tests):**
- Units — env parsing/defaults; PII email redaction; error serialization (stack-only, cause-folded, no leaked props, redacted email); `runSpan` sync/async/throw lifecycle; provider registry incl. the **global-singleton dual-copy guard** (the worker-bundle invariant).
- **Backend log-level gating** (`logger-level.test.ts`) — below-level records (`trace`/`debug`/`info` under `TELEMETRY_LOG_LEVEL=warn`, `debug` under the default) must **not** reach `provider.emitLog`, so the configured level controls remote export volume — not just stdout. Fails against the earlier ungated export.
- Facade — no-op-when-off; span/metric/log/error routing; `captureTraceContext`/`continueTrace`.
- **Real-provider integration** (in-memory OTEL exporters) — span shape + undefined-attr dropping; parent/child **delegation nesting**; `inject()` W3C `traceparent`; **cross-boundary traceId continuity**; the **backup-header propagator** (inject writes `x-original-traceparent`; extract continues from the backup even when `traceparent` is rewritten by an LB, and roots on a bare `traceparent` with no backup); log↔trace correlation; metrics; and a **span-level PII redaction** assertion (leaked email scrubbed from the span exception).
- **PII config regression** — locks `enhancedDatabaseReporting === false` so SQL parameter values can never be captured.
- **pg auto-instrumentation (spawned-subprocess)** — proves an OTLP-backed provider actually instruments `pg` so a query emits a `pg.query` span. Runs in a real child process (jest's module system does not exercise require-in-the-middle faithfully); no DB (a dead-port connection still drives the query path). This is the capability the CLI worker/scheduler bootstrap ordering (below) depends on.

**`packages/queue` (tracing tests):**
- Helper units — `attachTraceMetadata` embeds the carrier on `metadata` (preserving existing metadata), `runJobInTrace` continues from it / runs cleanly with none.
- **End-to-end through the real `local` strategy** — `enqueue` persists `metadata._trace` (and leaves the payload untouched), `process` continues the producer trace under a `queue.<name>` span. (The `async`/BullMQ strategy shares the same helpers and dispatch shape.)
- **Concurrent `async`-strategy telemetry wiring** (`async.telemetry.test.ts`) — with an OTLP backend and mocked `bullmq`/`bullmq-otel`, firing `enqueue` and `process` **concurrently** must wire the **same** `bullmq-otel` instance into both the `Queue` and the `Worker` (and omit the `metadata._trace` carrier, since `bullmq-otel` owns propagation). Guards the memoized-promise resolution: fails against the earlier boolean-before-`await` flag, which left the worker untraced while the queue was traced.

**`apps/mercato` (dispatcher wiring, 3 tests):**
- A thrown 5xx → `reportError` called with route/method/status + the `http.server.request.duration` metric (status 500, `error.type`), then re-thrown.
- A successful 2xx and a returned 4xx → **no** `reportError`, metric carries the response status and no `error.type`.

**`packages/create-app`:** the template unit suite (61 tests) includes a **byte-identity sync test** asserting the scaffold dispatcher `route.ts` matches `apps/mercato`'s (the telemetry additions must stay in lockstep). The full `yarn test:create-app` (Verdaccio + Docker: publish → scaffold → `yarn install` → boot) is **out of CI** (infra-heavy) but was run manually — it caught the `0.6.3`→`0.6.5` version-lockstep blocker and confirmed a fresh scaffold installs telemetry (SDK + instrumentation-pg + bullmq-otel) and emits to a live OTLP backend.

**Deliberately out of CI** (documented manual smoke): the real OTLP wire format and real `pg` param-stripping — both are OpenTelemetry's own code (tested upstream) — a `next build && next start` run against a collector, and the Verdaccio/Docker `test:create-app` end-to-end above. Browser/RUM is out of scope.

---

## Risks & Impact Review

| # | Risk | Severity | Affected area | Mitigation | Residual |
|---|---|---|---|---|---|
| R1 | OTEL SDK is heavy when enabled (~3-5 MB installed, init cost ~50-200 ms) | Medium | Bundle size + cold start when opt-in | `optionalDependencies` (peerDependenciesMeta.optional); off by default; dynamic `import()` in provider; externalized from build; no runtime cost when disabled | Low — only deployments that opt in pay |
| R2 | Performance overhead of always-on tracing under high RPS | Medium | API latency | Default sampling 100% dev / 10% prod via `TELEMETRY_SAMPLING_RATIO`; counters/histograms O(1); AsyncLocalStorage carrier is cheap | Low |
| R3 | Double instrumentation when NR agent + OTLP both enabled | Low | Span explosion in vendor UI | Document recommended config; provider selector is exclusive; NR reachable as OTLP backend | Low |
| R4 | Tenant/org data leaking into low-cardinality metric labels (cost explosion) | High | Metrics ingest cost | MUST rule: tenant/org/user IDs only as **span attributes**, never metric labels; lint rule planned (out of scope) | Low if rule followed |
| R5 | `console.*` migration drift — Phase 1 leaves many sites un-migrated | Low | Inconsistent log shape during transition | Boy Scout Rule; both forms valid; log levels filterable independently | Low |
| R6 | Trace-context fields polluting persistent event-store records | Low | DB rows slightly larger | Fields are short (~55 bytes for `traceparent`); only set when telemetry is active; opt-out per-publisher possible | Negligible |
| R7 | AsyncLocalStorage doesn't survive some edge cases (top-level `setTimeout` in worker pools) | Low | Lost trace context on rare boundaries | Document; provide `continueTrace(ctx, fn)` escape hatch | Low |
| R8 | Pinning the OTEL SDK version too tightly causes peer-dep churn | Medium | Upgrade friction | Pin only the exporters & instrumentation-pg/undici; let `@opentelemetry/api` float on caret; document upgrade procedure | Low |
| R9 | New Relic retirement timeline unclear; users may run both indefinitely | Low | Doc/operational complexity | NR reachable as OTLP backend; legacy-agent deprecation is a follow-up spec | Low |
| R10 | Silent provider failures (OTLP endpoint unreachable) hide telemetry | Low | Observability gap | Provider writes its own start/shutdown errors via `console.error`; document a health surface | Low |
| R11 | **Provider designed as a finished-span sink would orphan auto-instrumentation** | High (avoided) | Trace correctness | Delegation model (`runInSpan`/`activeSpan`) is mandated by S2 — the provider owns span creation so OTEL auto-spans nest | None (designed out) |
| R12 | **PII leak** via logs, error payloads, or captured SQL parameter values | High | Compliance | Privacy section: don't-emit posture, `pg` param capture off (regression-tested), `redactPii` backstop. (AI prompt/completion capture is N/A here — no AI instrumentation in this PR; the follow-up MUST force `recordInputs/Outputs` off) | Low |
| R13 | **Serverless flush loss** — process suspends before OTLP export | Medium | Lost telemetry | `forceFlush()` on shutdown / via Next.js `after()` in handlers | Low |
| R14 | **Worker-bundle duplicate module copies** set the provider on one copy, handlers read another | Medium (avoided) | Worker telemetry silently noop | `globalThis` provider registry (S3) so all copies share one instance; cache-bust guard for stale worker bundles | Low |
| R15 | **Instrumentation load order** — SDK started after `pg`/`undici` already loaded → worker/scheduler job bodies emit no DB/HTTP spans (only the bullmq-otel envelope) | Medium (fixed) | Worker/scheduler trace completeness | `bin.ts` runs `initTelemetry()` before importing the app graph, for all bootstrap-requiring commands (S4); spawned-subprocess test locks pg-span production; verified end-to-end on a live OTLP backend | Low |

---

## Final Compliance Report

- **New package** under `packages/` per root `AGENTS.md` ("Where to Put Code"). Naming `@open-mercato/telemetry` follows the convention. A package — not an app module — is required so `packages/{core,queue,events,webhooks,cli}` can import the facade for propagation/instrumentation.
- **No cross-module ORM relationships**: package adds no entities; queue/event additions are payload-only and additive.
- **Env-driven config**, no hardcoded vendor endpoints; backend is a pure OTLP env swap.
- **No raw `fetch`** in module code: the package's outbound instrumentation wraps undici at the global level only.
- **Backward Compatibility Contract**: all surfaces reviewed in API Contracts → Backward compatibility. No surface broken; queue/event payload extensions are additive.
- **PII hygiene**: don't-emit posture, `pg` param capture disabled + regression-tested, `redactPii` backstop. (No AI instrumentation in this PR; the AI follow-up MUST force prompt/completion recording off.)
- **AGENTS.md guidance**: Phase 1 ships `packages/telemetry/AGENTS.md` describing logger usage, span naming conventions, and the metric-label cardinality rule (R4).
- **Module decoupling**: package never imports from `packages/core/src/modules/*`. Modules opt in by importing the facade.
- **Generated files**: package adds nothing under `apps/mercato/.mercato/generated/`.

Touched areas (cross-package wiring, for reviewer awareness):
- `packages/telemetry` — new package (facade, providers, env, init). Backend log export is gated by `TELEMETRY_LOG_LEVEL` (below-level records never reach the OTLP `emitLog`). Version pinned to the monorepo lockstep (`0.6.5`) so create-app's `{{PACKAGE_VERSION}}` scaffolds resolve it.
- `packages/queue` — `metadata._trace` auto-injection at `enqueue`, auto-continuation at strategy dispatch, `initTelemetry()` in `runWorker`, and (async strategy) optional delegation to `bullmq-otel` when an OTLP backend is active (additive; depends on `@open-mercato/telemetry`; optional peer `bullmq-otel`). The async-strategy `bullmq-otel` resolution is memoized as an in-flight **promise** (not a boolean) so concurrent first-time callers share one result and a `Queue`/`Worker` pair can't be built with inconsistent telemetry wiring. Covers persistent events + queued webhook delivery transitively.
- `apps/mercato/src/instrumentation.ts` (+ `instrumentation.node.ts`) — calls `initTelemetry()` in the web process.
- `apps/mercato/src/app/api/[...slug]/route.ts` — `reportError` on 5xx + `http.server.request.duration` metric in the dispatcher chokepoint.
- `apps/mercato/next.config.ts` — `@opentelemetry/*` in `serverExternalPackages`.
- `packages/create-app/template/**` — the scaffold template is kept at **parity with `apps/mercato`** (per `packages/create-app/AGENTS.md`, app-shell changes MUST be synced): the six app-side wiring points (`package.json.template`, `instrumentation.ts`, new `instrumentation.node.ts`, the dispatcher `route.ts` kept **byte-identical** to `apps/mercato`, `next.config.ts` `serverExternalPackages`, `.env.example`) are ported, and the telemetry files are added to the Template Sync Checklist in `packages/create-app/AGENTS.md`. The worker/scheduler load-order fix ships transitively via `@open-mercato/cli`'s telemetry dep.

---

## Related

- **#60** — `feat: add global telemetry handler for exception handling`. Phase 1 ships the conduit (`reportError`); #60 owns the policy (Phase 3). Specs should be co-reviewed.

---

## Changelog

- **2026-04-29** — Initial draft (spec-only). No code yet.
- **2026-06-30** — Synced the spec with a validated reference implementation (Phase 1 + 2 built and run end-to-end against live OTLP backends), keeping the package + generic-OTLP design. Key changes: (1) **provider model corrected from an `emitSpan(SpanData)` sink to a delegation model** (`runInSpan`/`activeSpan`) — required so OTEL auto-instrumentation (pg/http/undici) nests in one trace (S2, R11). (2) **`Exporter` → `TelemetryProvider`** with `supports` capability flags, `inject`/`runInRemoteSpan`, and `activeTraceContext` (S2, API). (3) **Error reporting (`reportError`) moved into Phase 1** as the vendor-neutral conduit; #60 keeps the policy (S8, Phasing). (4) New **Privacy / PII-hygiene** section: `pg` param-value capture off, `redactPii` backstop, opaque-UUID-only attributes (S6, R12). (5) **AI SDK instrumentation deliberately excluded** from this PR — Open Mercato ships `ai@^6` but no call site enables `experimental_telemetry`, so enabling `ai.*` spans is per-call-site/chokepoint opt-in that concentrates prompt/completion PII review and is owned by `ai-assistant` (model-factory chokepoint). Moved to out-of-scope/follow-up (TLDR, S6, Privacy, API). The reference implementation's per-callsite `aiSdkTelemetry()` does not lift upstream. (6) **Queue carrier corrected from `meta.traceparent` to a payload `_trace`** (the async queue drops `metadata`), with auto-inject/auto-wrap as the zero-callsite goal (S5, Data Models). (7) **`globalThis` provider registry** for worker-bundle module copies (S3, R14); worker init via `packages/cli` bootstrap (S4). (8) **`http.server.request.duration` semconv metric** preferred over custom `om.http.*`; `om.errors` kept (S6). (9) NR reframed as a **plain OTLP backend** (modern NR ingests OTLP) — no proprietary adapter required (S7, D from reference). (10) Added risks R11–R14 (delegation necessity, PII, serverless flush, worker-bundle duplication) and the root-per-request inbound-propagator note (S5). Phases remain development milestones; contribution lands as one set.
- **2026-06-30 (Phase 1 implemented)** — `packages/telemetry` created (facade, `noop`/`console`/`otlp` providers, `globalThis` registry, env, init; OTEL deps optional + dynamic-imported). App wiring: `apps/mercato/src/instrumentation.ts` (+ `instrumentation.node.ts`) init; `reportError` + `http.server.request.duration` in the catch-all dispatcher (`app/api/[...slug]/route.ts`, route label from the manifest `route.path`); `@opentelemetry/*` in `serverExternalPackages`; `.env.example` block. 42 package tests + app/queue typecheck green.
- **2026-06-30 (Phase 2 implemented)** — Cross-boundary propagation centralized in `packages/queue` (supersedes the payload-`_trace` plan in item 6 above): the W3C carrier rides `QueuedJob.metadata._trace` (the first-class metadata channel — both `local` and `async` strategies thread it through), auto-injected at `enqueue` (`attachTraceMetadata`) and auto-continued at strategy dispatch (`runJobInTrace` → `queue.<name>` consumer span), zero per-worker code. **This single change also covers persistent event subscribers and queued webhook delivery** (both ride the queue); ephemeral in-process subscribers are already in-trace; SSE-bridge `traceparent` deferred (browser RUM out of scope). Worker-process init via `initTelemetry()` in `runWorker` (the single standalone-worker bootstrap; idempotent). Queue/event/webhook RED metrics are span-derived. `packages/queue` gains a `@open-mercato/telemetry` dependency. 55 queue tests + events/webhooks/cli/app typecheck green.
- **2026-06-30 (root-trace fix reworked → backup-header propagator)** — Replaced the blunt root-per-request global propagator (no-op `extract`, which crippled *all* global extraction) with a **backup-header propagator** (`x-original-traceparent`): inject mirrors the W3C context into a backup header the LB won't rewrite; extract **continues from the backup when present** (service-to-service survives the GCP LB rewrite) and **roots on a bare `traceparent`** (LB / untrusted caller), with `TELEMETRY_TRUST_INBOUND_TRACE=true` flipping the bare branch. Keeps the global `extract` **functional** (the prior fix's escalating breakage — anything relying on global extract, e.g. `bullmq-otel`, was broken). Sampling stays root-anchored (no Option-A regression); multi-service hops now continue correctly. Validated in-memory (`otlp-integration.test.ts`): inject-writes-backup, extract-continues-from-backup-despite-rewrite, bare-traceparent-roots. Unblocks adding `bullmq-otel` as an optional prod follow-up for richer queue-internal spans (disable the hand-rolled async `runJobInTrace` if/when added, to avoid double-spanning). 46 telemetry tests green.
- **2026-06-30 (bullmq-otel on the async strategy)** — Implemented the per-strategy split (S5): the `async`/BullMQ strategy now delegates tracing to **`bullmq-otel`** (passed as the `telemetry` option to the BullMQ `Queue` + `Worker`) when an OTLP backend is active — richer BullMQ-internal spans (`add`/`process`/wait/attempts). Gated by a new public `isOtelSdkBackend()` from `@open-mercato/telemetry`; resolved once per `createAsyncQueue` via a dynamic `import('bullmq-otel')` with graceful fallback to the `metadata._trace` carrier (telemetry off / non-OTEL backend / not installed). Our hand-rolled `attachTraceMetadata`/`runJobInTrace` are **skipped on the async path** when `bullmq-otel` is active (no double-spanning); the **`local` strategy is unchanged** (it isn't BullMQ — bullmq-otel can't instrument it, so it keeps the carrier). `bullmq-otel ^1.3.0` added as an optional peer dep of `packages/queue` (+ a direct dep of `apps/mercato`); its global-propagator `inject`/`extract` (confirmed in source) ride the backup-header propagator, so cross-boundary continuity holds. Async span emission isn't CI-testable (needs Redis) — documented manual smoke; the enable/skip gate (`isOtelSdkBackend`) is unit-tested. 47 telemetry + 56 queue + 112 app tests green.
- **2026-07-01 (worker DB spans — instrumentation load-order fix)** — Found via live SigNoz verification that standalone worker jobs emitted only the bullmq-otel `add`/`process`/`complete` envelope with **no `pg` spans inside** — the job body was a black box. Root cause: `initTelemetry()` ran only inside `runWorker`, *after* CLI bootstrap had already loaded `@mikro-orm/postgresql` → `pg`; OTEL's `pg` instrumentation only records spans for a driver loaded after the SDK starts (the prototype-`__wrapped` check is a false proxy — it is true in both orders, but spans are only produced when init precedes the driver load). Fix: `packages/cli/src/bin.ts` now calls `initTelemetry()` **before** dynamically importing the mercato entry, for every bootstrap-requiring command (worker/scheduler/…). Verified end-to-end against live OTLP: unfixed worker → `process <queue>` with 0 `pg` children; fixed worker → the full `findPendingVerification` query tree (`pg.query:SELECT domain_mappings …`) nested under `process <queue>`. Added a spawned-subprocess test (`pg-instrumentation.test.ts`) locking that an OTLP-backed provider produces a `pg.query` span. `@open-mercato/telemetry` added as a `packages/cli` dependency; `runWorker`'s in-process init kept as an idempotent fallback. 48 telemetry + 987 cli tests green; full `build:packages` + cli typecheck green. (Separately noted, not fixed here: standalone workers inherit the prod `0.1` sampling default, so root worker traces are sampled — set `TELEMETRY_SAMPLING_RATIO=1.0` for exhaustive local capture.)
- **2026-07-01 (create-app template parity + version lockstep)** — The Phase 1 app wiring landed in `apps/mercato` but left the create-app scaffold untouched, so a freshly created app got **zero web-tier telemetry** (setting `TELEMETRY_BACKEND` produced silence) — an incomplete change per `packages/create-app/AGENTS.md`, which requires app-shell changes to be synced to the template. Ported the six app-side wiring points into `packages/create-app/template/` (`package.json.template` adds `@open-mercato/telemetry` + optional `bullmq-otel`; the `@opentelemetry/*` SDK arrives transitively as `@open-mercato/telemetry`'s optionalDependencies, matching `apps/mercato`; `instrumentation.ts` Node-runtime-guarded init; new `instrumentation.node.ts` with `initTelemetry()` + SIGTERM/SIGINT flush; the dispatcher `route.ts` kept **byte-identical** to `apps/mercato`, which the create-app byte-identity sync test enforces; `next.config.ts` externalizes all `@opentelemetry/*`; `.env.example` documents the `TELEMETRY_*`/`OTEL_EXPORTER_OTLP_*` vars). The worker/scheduler load-order fix reaches scaffolds transitively via `@open-mercato/cli`. Added telemetry entries to the Template Sync Checklist in `packages/create-app/AGENTS.md` so this never drifts again. **Release-blocker caught by `yarn test:create-app`:** `packages/telemetry` shipped at `0.6.3` while every other public package is at `0.6.5`; scaffolds pin all `@open-mercato` deps to `{{PACKAGE_VERSION}}` (0.6.5) and `scripts/check-version-alignment.sh` enforces lockstep, so a fresh `yarn install` failed with "No candidates found" → bumped telemetry to `0.6.5`. Validated end-to-end: a fresh Verdaccio-installed scaffold booted against live SigNoz (service `om-createapp-smoke`) and emitted **web spans + `pg` auto-instrumentation + standalone-worker spans with `pg` children nested inside the job + init logs from 5 processes** (web + 3 workers + scheduler). `build:packages` 22/22, telemetry 48/48, create-app 61/61 (incl. the byte-identity dispatcher sync test) green.
- **2026-07-01 (review fixes: backend log-level gating + async-queue telemetry race)** — Two fixes from internal review. (1) **`packages/telemetry/src/facade/logger.ts`** — `provider.emitLog(record)` was called unconditionally; both stdout paths already respect `TELEMETRY_LOG_LEVEL` but the OTLP export was not gated, so with an OTLP backend and e.g. `TELEMETRY_LOG_LEVEL=warn` all `trace`/`debug`/`info` records still shipped to the backend (unexpected prod volume/cost). Gated `emitLog` behind the same `LEVEL_ORDER.indexOf(record.level) >= MIN_LEVEL_IDX` check the stdout paths use. (2) **`packages/queue/src/strategies/async.ts`** — `getQueueTelemetry()` set a `telemetryResolved` boolean synchronously **before** `await import('bullmq-otel')`, so a concurrent first-time caller saw the flag set while `telemetryInstance` was still `null` and got `undefined` — a cold-start enqueue and worker-creation could be built with inconsistent `bullmq-otel` wiring (degraded tracing, not a crash). Replaced the boolean+instance pair with a single **memoized in-flight promise** so concurrent callers await the same resolution. Neither touches a public contract surface. Added two regression guards (verified to fail against the pre-fix code by reverting each): `logger-level.test.ts` (below-level records must not reach `emitLog`) and `async.telemetry.test.ts` (concurrent `enqueue`+`process` must wire the **same** `bullmq-otel` instance into both `Queue` and `Worker`). telemetry 50/50, queue 58/58 green.
