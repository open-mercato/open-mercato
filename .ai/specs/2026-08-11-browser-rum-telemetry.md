# Browser RUM (client-side telemetry)

**Date:** 2026-08-11
**Status:** implemented
**Related work:**
- `.ai/specs/2026-04-29-telemetry-and-otel.md` — the server-side telemetry package this builds on; it explicitly listed "Browser/RUM telemetry and customer-portal frontend telemetry" as out of scope.
- Field-proven in a downstream deployment as an app-level module, upstreamed here as a first-class capability of `@open-mercato/telemetry`.

## TLDR

Opt-in client-side telemetry for the backoffice: the OpenTelemetry web SDK records document-load, fetch, and user-interaction spans in the browser and exports them through a same-origin, authenticated, rate-limited proxy that forwards to the already-configured OTLP collector. Browser spans join their server spans via the existing `x-original-traceparent` backup-header pattern, which — like every other inbound trace header — the server continues only under the existing `TELEMETRY_TRUST_INBOUND_TRACE=true` opt-in. Off by default (`TELEMETRY_BROWSER_ENABLED`), zero client-bundle cost while off, and the collector credential never reaches the browser.

## Overview / Problem Statement

Server traces can only prove where the time *isn't*. A real incident that motivated the downstream original: an order-detail API answered in 48 ms while the browser waited ~39 s before even sending the request — bundle download, hydration, and click-handler stalls are invisible to every server span. Without client-side spans there is no way to attribute "the page feels slow" to network, bundle, hydration, or backend.

Two constraints shape the design:

1. The browser cannot (and must not) talk to the OTLP collector directly — the endpoint typically sits in-cluster or behind auth, and `OTEL_EXPORTER_OTLP_HEADERS` is a credential.
2. Telemetry must never degrade the app it measures: no SDK bytes in the critical path, no user-facing failure surface, no retry storms.

## Proposed Solution & Architecture

Three pieces, all owned by `packages/telemetry`:

1. **Two entries under `src/browser/`, split along the server/client boundary.**
   - `@open-mercato/telemetry/browser` — the package's only client-safe entry, and env-free: `<BrowserTelemetry />`, the `BrowserTelemetryConfig` contract (`config.ts`), and the outbound propagator factory (`propagator.ts`).
   - `@open-mercato/telemetry/browser/server` — server-only (`server.ts`): `resolveBrowserTelemetryConfig()`, `resolveCollectorTracesUrl()`, `resolveCollectorHeaders()`. It throws on load when `window` is defined, so a wrong import fails loudly instead of silently placing the collector-credential reader in a client bundle.
   - `resolveBrowserTelemetryConfig()` (server-side, request-time): returns a `BrowserTelemetryConfig` or `null`. Off unless `TELEMETRY_BROWSER_ENABLED` is truthy **and** `isTelemetryBackendEnabled()` **and** an OTLP endpoint resolves. Deliberately not `NEXT_PUBLIC_*` so toggling needs no rebuild (the backend layout is `force-dynamic`). When RUM is enabled without `TELEMETRY_TRUST_INBOUND_TRACE`, it logs `telemetry.browser.trace_continuity_disabled` once per process.
   - `<BrowserTelemetry config={...} />` (`'use client'`): boots the OTel web SDK once per page load via dynamic `import()` — the SDK never enters the critical bundle path and a `null` config never requests the chunk. Instruments document-load, fetch (including the `__omOriginalFetch` wrapper installed by `@open-mercato/ui`'s api utils — see the "fetch-patch dance" comment in `BrowserTelemetry.tsx`), and user interactions. Every failure is swallowed. Flushes pending spans on `visibilitychange: hidden` so abandoned slow pages still export.
   - Injects `traceparent` plus the `x-original-traceparent` backup header (shared constants in `src/trace-headers.ts`, also used by the server propagator in `provider/otlp-provider.ts`) — see "Trace continuity" below.
2. **The `telemetry` module** (`packages/telemetry/src/modules/telemetry/`), enabled via `{ id: 'telemetry', from: '@open-mercato/telemetry' }` — owns the same-origin OTLP/HTTP proxy (see API Contracts).
3. **Host wiring** (mirrored in `apps/mercato` and `packages/create-app/template` per the Template Sync Checklist, item 15): the backend layout resolves the config server-side and renders `<BrowserTelemetry />`; `modules.ts` enables the module; `.env.example` documents the `TELEMETRY_BROWSER_*` block. `mercato telemetry init` (CLI) applies the same three edits to an existing app — see "CLI adoption".

### Trace continuity

The browser injects both `traceparent` and the backup `x-original-traceparent`. The server's global propagator **ignores every inbound trace header by default**, standard and backup alike, because at an HTTP boundary they are caller-controlled (`provider/otlp-provider.ts`, asserted by `otlp-integration.test.ts`). The supported way to get one end-to-end trace is therefore the existing `TELEMETRY_TRUST_INBOUND_TRACE=true` opt-in; the backup header is what survives a load balancer rewriting `traceparent` in between.

The trust model is deliberately **unchanged** by this spec. A RUM-only trust path (accepting the header on the proxy route alone, or signing it) was rejected: the flag is global by construction, a per-route exception would be a second, subtler trust boundary to reason about, and the failure mode without it is cosmetic (two traces per page) rather than a loss of data. Instead the requirement is documented in the env blocks and README with its security caveat, the client injects unconditionally so flipping the flag needs no client change, and the server says so once in the log when RUM is on and the flag is off.

### Architecture decision: OTel imports outside `otlp-provider.ts`

`packages/telemetry/AGENTS.md` previously allowed `@opentelemetry/*` imports only in `provider/otlp-provider.ts`. That rule is now scoped to two importers — `provider/otlp-provider.ts` (Node SDK) and `browser/BrowserTelemetry.tsx` (web SDK) — because the two SDKs are disjoint package sets that must not be resolvable from each other's runtime, and both keep the same discipline: optional dependencies loaded through a dynamic `import()` so a disabled deployment never resolves them. A third importer still needs approval. `browser/propagator.ts` uses a type-only import, which is erased at build time.

### Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `TELEMETRY_BROWSER_ENABLED` | `false` | Master opt-in; requires an active `TELEMETRY_BACKEND` + OTLP endpoint |
| `TELEMETRY_BROWSER_SAMPLING_RATIO` | `1.0` | Root sampling ratio, clamped to 0–1 |
| `TELEMETRY_BROWSER_SERVICE_NAME` | `<OTEL_SERVICE_NAME>-browser` | Separate service so RUM latency does not distort server charts |
| `TELEMETRY_TRUST_INBOUND_TRACE` | `false` | Pre-existing flag; required for browser and server spans to share a trace |

`deployment.environment` is derived from `OTEL_RESOURCE_ATTRIBUTES` (plain attribute name, matching existing server spans).

### CLI adoption

`mercato telemetry init` decides "already wired" per capability, not per file, so an app that ran the command before browser RUM existed adopts the difference on a re-run:

- `.env` / `.env.example` — appends only the missing `TELEMETRY_BROWSER_*` block when the core `TELEMETRY_BACKEND` block is already present.
- `src/modules.ts` — inserts `{ id: 'telemetry', from: '@open-mercato/telemetry' }` into `enabledModules`; without it the browser exports into a 404.
- `src/app/(backend)/backend/layout.tsx` — adds the two imports, the `resolveBrowserTelemetryConfig()` call, and `<BrowserTelemetry />` as the last child of `<AppShell>`.

A backoffice layout is the file apps customize most, so the layout step only edits one that still matches the scaffold shape (`return (`, `</AppShell>`, an import block); anything else degrades to the printed manual snippet, as the dispatcher and `next.config.ts` steps already do.

## Data Models

None. No entities, no migrations, no persisted state. Span batches pass through the proxy without being stored; browser resource attributes are limited to service name, deployment environment, and `user_agent.original`.

## API Contracts

`POST /api/telemetry/browser-traces` (module API route, additive — no existing contract surface changes):

- **Auth:** `requireAuth: true`, no feature grant (sending a span is not privileged; unauthenticated ingest is refused by the dispatcher). Rate limit 120 points / 60 s, key prefix `telemetry_browser_traces`.
- **Body:** OTLP/HTTP trace export as produced by `@opentelemetry/exporter-trace-otlp-http` (JSON today; `content-type` and `content-encoding` are forwarded verbatim so a protobuf or gzip switch needs no proxy change). 1 MB cap, enforced on declared `content-length` before buffering — unconditionally, even while disabled — and re-checked during a capped streaming read for clients that lie or omit the header.
- **Responses:** `204` accepted-and-dropped (telemetry disabled — keeps stale clients quiet), `202` forwarded, `413` over cap, `202` collector rejected/unreachable (logged, never thrown). Fire-and-forget by design; the client never retries — every failure status is kept outside the exporter's retryable set (`429`, `502`, `503`, `504`) so a collector outage cannot turn into a retry storm from every open tab.
- The package export surface grows additively: `@open-mercato/telemetry/browser` and `@open-mercato/telemetry/browser/server` (new entries), `src/trace-headers.ts` constants. The server facade and its rules are untouched.

## Risks & Impact Review

| Risk | Severity | Area | Mitigation | Residual |
| --- | --- | --- | --- | --- |
| Span-ingest endpoint abused as an authenticated write amplifier | medium | proxy route | requireAuth + 120/min rate limit + 1 MB pre-buffer cap + 5 s collector timeout | low — bounded per-user cost |
| Collector credential leaking to the client | high | config | Credential only ever attached server-side in the proxy; the reader lives in the `/browser/server` entry, which throws if loaded in a browser; config passed to the client contains endpoint path, service name, environment, sampling only | negligible |
| RUM SDK slowing the app it measures | medium | client bundle | Dynamic `import()` behind a server-resolved null-by-default config; module-level bootstrap guard; all failures swallowed | negligible while disabled; small deferred chunk when enabled |
| Double-instrumented or recursive fetch via the `__omOriginalFetch` wrapper | medium | client | The documented fetch-patch swap instruments native fetch exactly once for both call paths; export URL is in `ignoreUrls` | low |
| Trace-id spoofing via inbound headers | medium | server propagator | Trust model unchanged: both `traceparent` and the backup header are ignored unless `TELEMETRY_TRUST_INBOUND_TRACE=true`, whose security caveat is documented wherever RUM is | unchanged from base spec |
| RUM enabled but traces never join, read as a bug | low | operations | Documented in `.env.example`, the CLI env block, and the README; the server logs `telemetry.browser.trace_continuity_disabled` once when RUM is on and the flag is off | low |
| Existing app sets `TELEMETRY_BROWSER_ENABLED` without the module/layout wiring | medium | CLI adoption | `mercato telemetry init` is per-capability idempotent and adds the env keys, module entry, and layout render on a re-run; covered by legacy-app CLI tests | low — a customized layout degrades to a printed manual snippet |
| Template/monorepo drift | low | create-app | Sync checklist item 15 + template files updated in the same change; create-app tests assert module fact-sheet + harness coverage (OMH-234) | low |

## Final Compliance Report

- Tenant/organization scoping: not applicable — no data reads/writes; auth context is used only as an ingress gate.
- No new production dependencies outside the existing optional OTel family; `react` is an optional peer used only by the `/browser` entry.
- Contract surfaces: additive only (new module, new route, new package entry); `BACKWARD_COMPATIBILITY.md` deprecation protocol not triggered.
- Validation run: `yarn generate`, `yarn build:packages`, `yarn typecheck`, `yarn lint` (pre-existing warnings only), telemetry package tests, CLI tests, create-app tests, `yarn agents:check-budget`.

## Integration coverage

- `packages/telemetry/src/modules/telemetry/__integration__/TC-TELEMETRY-001.spec.ts` — `POST /api/telemetry/browser-traces`: 401 unauthenticated, 202/204 authenticated accept, 413 oversized payload.
- Unit — server half: `packages/telemetry/src/__tests__/browser-server-config.test.ts` (config resolution gates, sampling clamps, collector URL/header parsing, the warn-once trace-continuity notice) and `browser-traces-route.test.ts` (proxy forward, credential injection, failure statuses, size caps).
- Unit — browser runtime: `packages/telemetry/src/browser/__tests__/browser-telemetry.test.tsx` (jsdom, mocked web SDK) covers zero module loads while disabled, one bootstrap under `StrictMode` and across remounts, the `__omOriginalFetch` swap and its recursion trap, self-export `ignoreUrls`, backup-header injection, `visibilitychange` flush, and silence when the SDK throws.
- Trace continuity: `packages/telemetry/src/__tests__/otlp-integration.test.ts` drives the real browser propagator into the real server extractor with a proxy rewriting `traceparent` — the server span shares the browser trace id under `TELEMETRY_TRUST_INBOUND_TRACE=true`, and does not without it.
- CLI adoption: `packages/cli/src/lib/__tests__/telemetry-init.test.ts` covers an app initialized before RUM shipped (env keys appended without duplicating the core block, module registered, layout wired, round-trip against the live template layout, idempotent re-run) plus the manual-snippet fallback for a customized layout.
- Standalone harness: evaluation case OMH-234 asserts agents route "add client-side telemetry" requests to the installed module facts (`.ai/guides/modules/telemetry/index.md`) instead of building a bespoke ingest route.
- Key UI path: the wiring renders nothing (`BrowserTelemetry` returns `null`); there is no user-visible surface to exercise beyond the layout rendering already covered by existing backend page tests.

## Non-goals / future work

- Customer-portal and storefront RUM (the component is backoffice-wired only; the entry is reusable when that lands).
- Browser metrics/logs export (traces only), protobuf OTLP encoding, and zone.js-based async context for user-interaction spans.

## Changelog

- 2026-08-11 — Initial implementation: browser entry, `telemetry` module proxy, app + create-app template wiring, env/CLI adoption blocks, unit + integration tests, harness case OMH-214.
- 2026-08-13 — Review pass (PR #5195): documented that end-to-end traces require the existing `TELEMETRY_TRUST_INBOUND_TRACE` opt-in (with a warn-once server log) instead of claiming the backup header bypasses it; split the env/credential readers into the server-only `@open-mercato/telemetry/browser/server` entry and scoped the package's OTel-import rule to the two SDK boundaries; taught `mercato telemetry init` to adopt RUM in an already-initialized app (env keys, module entry, backoffice layout); added browser-runtime and trace-continuity regression coverage. Rebased onto the 231-case harness catalog, so the routing case is OMH-232.
- 2026-08-18 — Rebased onto develop's 233-case harness catalog (the devices/push cases took OMH-232 and OMH-233), so the routing case is renumbered to OMH-234 and the catalog is 234 cases.
