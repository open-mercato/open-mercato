# Telemetry Package — Agent Rules

`@open-mercato/telemetry` supplies vendor-neutral spans, metrics, error
reporting, and an optional remote sink for the canonical shared logger. It is
off by default. Spec:
`.ai/specs/2026-04-29-telemetry-and-otel.md`.

## Always

- Use `createLogger(namespace)` from
  `@open-mercato/shared/lib/logger` for operational logging. Telemetry must
  extend that logger, never introduce another logger or stdout/stderr path.
- Keep host integration default-unloaded: check
  `isTelemetryBackendEnabled()` from shared code before dynamically importing
  this package.
- Treat an unset, `noop`, or unregistered backend as absolute off. A custom
  provider activates only after an explicit bootstrap registers the exact
  configured name and calls `initTelemetry()`.
- Name spans `module.entity.action` (lowercase, dot-separated).
- Root the repeating unit of a long-lived job (batch/page) with
  `withSpan(name, fn, { root: true, links: [runCarrier] })`. Without it the whole
  job inherits one sampling decision from its trigger — a blind spot below ratio
  1.0, an unrenderable trace at 1.0. Always pair `root` with `links` so the chain
  back to the trigger survives.
- Emit spans from packages that must not depend on this one via
  `withTelemetrySpan` / `captureTelemetryTrace` from
  `@open-mercato/shared/lib/telemetry/runtime`, never a direct import.
- Use semantic-convention metric/attribute names when available.
- Keep metric labels low-cardinality. Tenant, organization, and user IDs belong
  on span attributes, never metric labels.
- Apply redaction at the provider boundary as well as at facade call sites.
- Report every recorded error: a `catch` that does anything other than rethrow
  (persists a row, sets a `failed` status, dead-letters an item, returns a
  fallback) MUST also reach `reportError` — directly, or through a chokepoint that
  does (`integrationLogService.write` at `level: 'error'`, the queue failure
  paths). `logger.error` alone does NOT satisfy this: no span exception, no
  `om.errors` sample, no fingerprint. Full policy:
  `apps/docs/docs/framework/runtime/error-reporting.mdx`.
- Pass `code` on every `reportError` call: a stable, enumerated `module.reason`
  token, never an interpolated string. It is a metric label and the fingerprint
  backends group on — ids go in `attributes`.

## Ask First

- Ask before adding a built-in metric, auto-instrumentation, production
  dependency, or new global hook.
- OpenTelemetry packages must stay optional and may only be imported by
  `provider/otlp-provider.ts`.
- Ask before changing the `pg` `enhancedDatabaseReporting: false` guard or
  broadening the accepted inbound-trace trust model.

## Never

- Never emit PII, credentials, record content, SQL parameters, request bodies,
  or arbitrary thrown-object properties.
  The integration-log tee reports a row's message, `code` and ids only —
  `integration_logs.payload` never leaves the database.
- Never add sampling, throttling or suppression to `reportError`. Volume belongs
  to the collector and the backend, which drop where the drop is visible; a
  facade-level limiter is the only one that loses an error at the source.
- Never trust `traceparent` or `x-original-traceparent` at an inbound/global
  boundary unless `TELEMETRY_TRUST_INBOUND_TRACE=true`.
- Never store provider, shared-logger extension, or runtime bridge state only in
  a module local; cross-bundle state uses `globalThis` symbol registries.
- Never replace provider-owned span delegation with a finished-span sink.
- Never import this package from a client component.

## Architecture

```
@open-mercato/shared/lib/logger ── local output (always)
          │
          └─ process-wide extension (only after telemetry init) ── remote logs

host/queue shared runtime bridge ── absent while off
          │
          └─ registered provider: console | OTLP
```

- `src/facade/*`: spans, metrics, propagation, error funnel, redaction, and
  shared-logger adapter.
- `src/provider/*`: noop/console/OTLP providers and global provider registry.
- `src/init.ts`: explicit-enabled initialization and process-wide bridge
  registration.
- `src/nextjs-config.ts`: build-time constants only; no runtime imports.
- `src/nextjs.ts`: enabled runtime helper.

## Validation

```bash
yarn workspace @open-mercato/telemetry build
yarn workspace @open-mercato/telemetry test
yarn typecheck
```
