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
- Treat an unset, `noop`, or unknown backend as absolute off. Do not resolve
  custom providers or register global hooks on that path.
- Name spans `module.entity.action` (lowercase, dot-separated).
- Use semantic-convention metric/attribute names when available.
- Keep metric labels low-cardinality. Tenant, organization, and user IDs belong
  on span attributes, never metric labels.
- Apply redaction at the provider boundary as well as at facade call sites.

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
