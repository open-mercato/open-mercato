# Telemetry Package — Agent Rules

`@open-mercato/telemetry` is the vendor-neutral observability facade: structured
logger, spans, metrics, and an error funnel, backed by a pluggable
`TelemetryProvider` (OTLP by default). Off by default; a cheap no-op when
disabled. Spec: `.ai/specs/2026-04-29-telemetry-and-otel.md`.

## Always

- Import the facade from the package root: `import { logger, withSpan, counter, histogram, gauge, reportError } from '@open-mercato/telemetry'`.
- Use `logger` instead of `console.*` for new server-side operational logging. `logger.child({ module: '<module>' })` to bind context.
- Name spans `module.entity.action` (lowercase, dot-separated), matching the event-id convention — e.g. `orders.checkout.run`, `catalog.import.sync`.
- Wrap the new error funnel around server error seams: `reportError(err, { module })` records the exception on the active span, emits a structured error log, and increments `om.errors`. It is additive — keep re-throwing.
- Prefer OpenTelemetry **semantic-convention** metric/attribute names where one exists (e.g. `http.server.request.duration`, `http.route`); reserve `om.*` for what has no semconv equivalent.
- Keep this package isomorphic-free: it is **server-only** (pulls in `pino` + `node:async_hooks`).

## Ask First

- Ask before adding a new built-in metric, span surface, or auto-instrumentation — confirm the cardinality budget and the owning package.
- Ask before adding a runtime dependency. OTEL packages MUST stay in `optionalDependencies` and be imported dynamically (only `provider/otlp-provider.ts` may import `@opentelemetry/*`).
- Ask before widening `redactPii` beyond emails, or before changing the `pg` `enhancedDatabaseReporting` flag (it is locked off and regression-tested).

## Never

- **Never put tenant/organization/user IDs (or any high-cardinality value) on metric labels.** They go on **span attributes** only — metric label explosion is a cost incident. Enforced by convention; see spec R4.
- Never emit PII (names, emails, message/record content, SQL parameter values) into spans, logs, or error payloads. The posture is **don't-emit**; `redactPii` is only a backstop.
- Never import `@opentelemetry/*` outside `provider/otlp-provider.ts`. Never import the facade from a `'use client'` component.
- Never store the active provider in module-local state — it lives on the `globalThis` registry (`provider/registry.ts`) so worker bundled-vs-source module copies share one instance. Don't bypass `getActiveProvider()`.
- Never turn the provider into a finished-span (`emitSpan(SpanData)`) sink. Tracing is a **delegation** model (`runInSpan`/`activeSpan`) so OTEL auto-instrumentation nests in one trace.

## Validation Commands

```bash
yarn workspace @open-mercato/telemetry build
npx turbo run typecheck --filter=@open-mercato/telemetry
yarn workspace @open-mercato/telemetry test
```

## Architecture

```
facade (logger / withSpan / counter / reportError) — always loaded, ~no deps
   │  one active TelemetryProvider (resolved from TELEMETRY_BACKEND, globalThis-held)
   ▼
noop (default)  ·  console (pino)  ·  otlp → any OTLP backend
```

- `src/facade/*` — public surface; no `@opentelemetry/*` imports.
- `src/provider/*` — `noop`/`console`/`otlp` providers + the global registry + the shared `run-span` lifecycle helper.
- `src/env.ts` — env parsing (`TELEMETRY_BACKEND`, `OTEL_*`, sampling, pretty logs).
- `src/init.ts` — `initTelemetry()` (idempotent); dynamically loads the OTLP provider so the SDK never resolves when telemetry is off.

Activation: web process via `apps/mercato/instrumentation.ts`; worker/cross-boundary propagation is Phase 2 (see the spec). Adding another OTLP backend later is an env change, not code.
