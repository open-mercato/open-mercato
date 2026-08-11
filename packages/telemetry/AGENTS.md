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
- Use semantic-convention metric/attribute names when available.
- Keep metric labels low-cardinality. Tenant, organization, and user IDs belong
  on span attributes, never metric labels.
- Apply redaction at the provider boundary as well as at facade call sites.

## Ask First

- Ask before adding a built-in metric, auto-instrumentation, production
  dependency, or new global hook.
- OpenTelemetry packages must stay optional and may only be imported by
  `provider/otlp-provider.ts` (Node SDK) and `browser/BrowserTelemetry.tsx` (web
  SDK). Both must load them through a dynamic `import()` so a disabled
  deployment never resolves them. Adding a third runtime importer needs
  approval; `import type` is erased and unrestricted.
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
- Never import this package from a client component, except the dedicated
  `@open-mercato/telemetry/browser` entry — the only client-safe surface. It must
  stay env-free, must never import the server facade (`node:async_hooks`), and
  must keep the OTel web SDK behind a dynamic `import()` gated on a non-null
  server-resolved config.
- Never move an env-reading or collector-credential helper into the `/browser`
  entry; those belong to `@open-mercato/telemetry/browser/server`, which throws
  on load in a browser.
- Never expose the OTLP collector endpoint or its credential to the browser;
  browser spans go through the same-origin `telemetry` module proxy, which adds
  `OTEL_EXPORTER_OTLP_HEADERS` server-side.

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
- `src/browser/*`: browser RUM. `config.ts` (shared, env-free contract) and
  `BrowserTelemetry.tsx` (boots the web SDK) form the client-safe `/browser`
  entry; `server.ts` is the server-only `/browser/server` entry that reads env
  and the collector credential. Off unless `TELEMETRY_BROWSER_ENABLED` is set
  alongside an active backend.
- `src/modules/telemetry/*`: the `telemetry` module — the authenticated,
  rate-limited same-origin OTLP proxy (`POST /api/telemetry/browser-traces`).

## Validation

```bash
yarn workspace @open-mercato/telemetry build
yarn workspace @open-mercato/telemetry test
yarn typecheck
```
