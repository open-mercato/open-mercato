# Intelligent Dev Runtime Splash and Gateway

- **Issue:** [#5369](https://github.com/open-mercato/open-mercato/issues/5369)
- **Status:** Implemented (Phases 1–4)

## TLDR

The development splash evolves from a startup-progress page into a runtime
feedback loop. The default `direct` topology is unchanged. An opt-in `proxy`
topology puts a local gateway on the public application port; it proxies a
healthy Next.js runtime and serves actionable diagnostics while the runtime is
starting, degraded, recovering, or unavailable.

The gateway is never enabled by default and is not a production reverse proxy.

## Topologies

```text
# default (OM_DEV_RUNTIME_MODE=direct)
PORT=3000                -> Next.js / Open Mercato runtime
OM_DEV_SPLASH_PORT=4000  -> standalone splash and supervisor API

# opt-in (OM_DEV_RUNTIME_MODE=proxy)
PORT=3000                -> Open Mercato dev runtime gateway
auto/OM_DEV_UPSTREAM_PORT-> managed Next.js runtime (loopback only)
OM_DEV_SPLASH_PORT=4000  -> supervisor diagnostics API
```

## Runtime state

One generation-aware state is owned by the root supervisor. The legacy
`ready`/`failed` fields remain as a compatibility projection:

| Runtime health | `ready` | `failed` | Meaning |
| --- | ---: | ---: | --- |
| `starting` | `false` | `false` | Being built, launched, or warmed up. |
| `ready` | `true` | `false` | Warmup passed and the latest probe is healthy. |
| `degraded` | `true` | `false` | Served at least once, but a bounded signal is unhealthy. |
| `recovering` | `false` | `false` | A permitted recovery action is active. |
| `unavailable` | `false` | `true` | A hard failure prevents serving. |

`failed` is no longer the only signal for a post-ready issue: an active incident
survives the ready-state normalization (`hasActiveRuntimeIncident`).

Bounds: at most 20 active incidents, 200 diagnostic lines, 8 KiB per browser
report after redaction, 2 000-character stacks.

## Signals

One collector interface handles every source. Classification is pure text
analysis and never executes a command.

| Source | Origin |
| --- | --- |
| `process` | Non-zero exit, signal termination, failed stage command. |
| `log` | Compile/runtime/migration/bootstrap failures already classified by the app wrapper. |
| `warmup` | `/login`, authenticated login and `/backend` warmup failures. |
| `browser` | `global-error.tsx`, `window.error`, unhandled rejections, chunk-load failures. |
| `probe` | Continuous `GET /api/healthz` after the startup warmup passed. |

Known signatures map to stable codes with a user-readable title, a concise
detail, and — only where justified — a recovery action. `relation "sandboxs"
does not exist` becomes **Database schema mismatch** / "Relation `sandboxs` is
missing" / `migrate`.

Fingerprints derive from `source | code | path | digest | normalized message`
rather than raw stack text, so retries collapse into one incident with an
occurrence counter.

## Readiness and probe

The existing full startup warmup remains the `READY` gate. After `READY`, a
lightweight probe hits `GET /api/healthz` on the managed runtime: 1 500 ms
timeout, 5 000 ms interval, `degraded` after 3 consecutive failures, `ready`
after 2 consecutive successes, counters reset on generation change or accepted
recovery. It never re-runs the login warmup and never logs a success.

## Surfaces

- **Standalone splash** (`scripts/dev-splash.html`) renders a structured
  incident card — health badge, localized title, concise detail, error code,
  source, occurrences, last-seen, path, and the suggested recovery — above the
  existing redacted log tail.
- **In-app banner** (`DevRuntimeDiagnosticsBanner`) polls the dev-only status
  bridge every 2 s and renders only for `starting`, `degraded`, `recovering`,
  and `unavailable`. `role="status"`/polite for degraded and recovering,
  `role="alert"`/assertive for unavailable. Dismissal is view-local, scoped to
  `generation:fingerprint`, and never changes runtime state. It offers `Restart`
  always and the classifier-justified `generate`/`migrate` action when present;
  `migrate` goes through the shared `useConfirmDialog`. Recovery controls
  disappear while an action is already running.
- **Browser reporter** (`DevRuntimeReporter`) is a client island that registers
  bounded `window.error` / unhandled-rejection listeners. `global-error.tsx`
  sends one best-effort report and always renders its existing fallback first.

## API contracts

App routes (development only; 404 outside a supervised dev runtime). They live
under `/api/dev-runtime/*`, NOT under the gateway's `/__open-mercato/*`
namespace: Next.js treats a leading-underscore folder as a private folder and
drops it from the route tree entirely, so `app/api/__open-mercato/**` is never
served. Kebab-case also cannot collide with a module's snake_case
`/api/<module_id>/...` routes. The gateway keeps `/__open-mercato/*` because it
is a plain Node server, not Next.js.

- `GET /api/dev-runtime/status` → `200 RuntimeStatus`, `403` invalid token,
  `404` disabled or state unavailable.
- `POST /api/dev-runtime/diagnostics` → `202 { accepted, issueId }`, `400`
  invalid schema/size, `403` invalid token, `404` disabled, `429` rate limited.
- `POST /api/dev-runtime/actions/{action}` → `202 { accepted, actionId,
  generation }`, `400` unknown action, `403` invalid token/origin, `404`
  disabled, `409` another action is running, `503` no supervisor.

The app route cannot call the supervisor in-process, so it queues the validated
action on a bounded NDJSON channel (`OM_DEV_RUNTIME_ACTIONS_FILE`) that the
supervisor drains on its 1 s sync. Requests carrying a stale generation are
dropped, and the action is re-validated against the allowlist on drain, so a
tampered sink line can never widen what runs.

Gateway routes (proxy mode only):

- `GET /__open-mercato/status`, `GET /__open-mercato/logs?cursor=<n>`,
  `POST /__open-mercato/diagnostics`, `POST /__open-mercato/actions/{action}`.
- Control failures return `{ error: { code, message } }` — never splash HTML.

`GET /api/healthz` stays the minimal infrastructure contract (`200 {status:'ok'}`
/ `503 {status:'degraded'}`) and is now present in both the app and the template.

## Gateway routing

| Request | Behavior |
| --- | --- |
| `/__open-mercato/*` | Handled by the gateway; never proxied. |
| Navigational HTML while `starting`/`recovering`/`unavailable` | Splash fallback. |
| Navigational HTML while `ready`/`degraded` | Proxied to the upstream. |
| `/api/*`, `/_next/*`, static assets | Always proxied; upstream status and body preserved. |
| HTTP `upgrade` (HMR) | Raw upgrade forwarded; closed cleanly when the upstream is gone. |

A navigation is `GET`/`HEAD` + `Accept: text/html` + no `X-Requested-With` and
`Sec-Fetch-Mode` either absent or `navigate`. Everything else reaches the
upstream, so a business 4xx/5xx is never replaced by splash HTML.

The proxy uses Node core `http` only. Hop-by-hop headers are stripped and
`Host`, `Origin`, `X-Forwarded-For`, `X-Forwarded-Host` and `X-Forwarded-Proto`
are reconstructed deliberately. Upgraded sockets are tracked so shutdown tears
the tunnels down. A public port collision fails with a readable error instead of
silently moving the gateway.

## Recovery actions

`generate`, `migrate`, and `restart` are a fixed enum mapped to lifecycle steps
the supervisor already owns; request input never names a binary, appends a flag,
or changes a working directory. One mutating action runs per generation; a
stale-generation completion cannot overwrite newer state. Actions carry a
run-local id, start time, timeout, exit code, and bounded output.

`migrate` applies database changes and is **not** automatically reversible — the
copy says so and rollback stays an operator task. Cache reset is deferred.

## Security and privacy

- Gateway, splash, and collector bind to loopback by default.
- A per-run random token protects the diagnostics route, the status bridge, and
  every mutating gateway action; it reaches the browser only through a dev-only
  `<meta>` element and is never persisted.
- Method, path, origin, content type, body size, field lengths and a per-process
  rate limit are validated before anything is recorded.
- Tokens, cookies, authorization headers, connection strings, JWTs, provider
  keys and keyed secrets are redacted before state, log, or response storage.
  The supervisor rules and the app-route rules are kept byte-identical by
  `scripts/__tests__/dev-runtime-redaction-parity.test.mjs`.
- Browser reports are untrusted: they inform state but cannot trigger an action
  or change configuration.
- The routes cannot be enabled in a production build: `NODE_ENV=production`
  disables them, and they additionally require a supervisor-provided token and
  state-file path that only `yarn dev` sets.

## Configuration

| Variable | Default | Contract |
| --- | --- | --- |
| `OM_DEV_RUNTIME_MODE` | `direct` | `direct\|proxy`; anything else fails with a readable error. |
| `OM_DEV_UPSTREAM_PORT` | auto-selected loopback port | 1–65535; must not equal the public port. |
| `OM_DEV_RUNTIME_PROBE_INTERVAL_MS` | `5000` | Positive bounded integer. |
| `OM_DEV_RUNTIME_PROBE_TIMEOUT_MS` | `1500` | Positive bounded integer, below the interval. |
| `OM_DEV_RUNTIME_PROBE_FAILURE_THRESHOLD` | `3` | Positive bounded integer. |
| `OM_DEV_RUNTIME_PROBE_RECOVERY_THRESHOLD` | `2` | Positive bounded integer. |
| `OM_DEV_RUNTIME_DIAGNOSTICS` | follows the dev splash, off in CI | Boolean flag. |
| `OM_DEV_RUNTIME_BANNER` | follows diagnostics | Boolean flag; cannot enable the banner while diagnostics are off. |

## Implementation units

| File | Responsibility |
| --- | --- |
| `scripts/dev-runtime-state.mjs` | State schema, transitions, generations, classification, fingerprints, redaction, legacy projection, probe policy. |
| `scripts/dev-runtime-config.mjs` | Env parsing with readable configuration errors. |
| `scripts/dev-runtime-probe.mjs` | Interval/timeout/counter transport. |
| `scripts/dev-runtime-diagnostics.mjs` | Token, report validation, rate limiter, bounded NDJSON sink. |
| `scripts/dev-runtime-supervisor.mjs` | Owns state for one process: ingestion, probe, atomic status file. |
| `scripts/dev-runtime-gateway.mjs` | Route ownership, HTTP stream proxy, `upgrade` forwarding. |
| `scripts/dev-runtime-actions.mjs` | Allowlisted, serialized, generation-aware action runner. |
| `packages/shared/src/lib/dev-runtime/*` | Types, redaction mirror, dev-only route handlers, layout meta, browser reporter. |
| `packages/ui/src/backend/dev/*` | `DevRuntimeDiagnosticsBanner`, `DevRuntimeReporter`. |

## Data models

No ORM entity and no migration. Runtime data is ephemeral: in-memory
`RuntimeStatus`, one per-run token and generation, a bounded local NDJSON sink
under `.mercato/`, and a bounded terminal/splash log buffer. The status file is
written through a temp file + rename so the splash never reads a partial
document, and it carries the writer's token and pid so a stale run is rejected.

## Migration & backward compatibility

- `OM_DEV_RUNTIME_MODE` defaults to `direct`: existing ports, process ownership,
  shutdown behavior and terminal workflow are unchanged.
- `GET /status`, legacy state fields, coding/git actions and splash polling stay
  valid; `runtime` is an additive field.
- `/__open-mercato/*` is reserved and never alters module routes.
- `GET /api/healthz` and the `/api/dev-runtime/*` routes are additive app
  routes, mirrored in the
  standalone-app template.
- No module export, event ID, ORM schema, tenant API, or production route is
  renamed or removed, so no deprecation bridge is required.

## Test coverage

| Area | File |
| --- | --- |
| State, classification, fingerprints, redaction, probe policy | `scripts/__tests__/dev-runtime-state.test.mjs` |
| Token, report validation, rate limit, bounded sink | `scripts/__tests__/dev-runtime-diagnostics.test.mjs` |
| Env config and probe transport | `scripts/__tests__/dev-runtime-config.test.mjs` |
| Supervisor ingestion, generations, status file | `scripts/__tests__/dev-runtime-supervisor.test.mjs` |
| Gateway routing, proxying, HMR, control errors | `scripts/__tests__/dev-runtime-gateway.test.mjs` |
| Action allowlist, serialization, stale generations | `scripts/__tests__/dev-runtime-actions.test.mjs` |
| Redaction parity across supervisor/app/template | `scripts/__tests__/dev-runtime-redaction-parity.test.mjs` |
| Supervisor lifecycle and template parity | `scripts/__tests__/dev-runtime-lifecycle.test.mjs` |
| Ready-state normalization | `scripts/__tests__/dev-splash-state.test.mjs` |
| Splash incident preview and localization | `scripts/__tests__/dev-splash-html.test.mjs` |
| Dev-only route behavior and security | `packages/shared/src/lib/dev-runtime/__tests__/routes.test.ts` |
| Banner rendering, a11y, dismissal, transports, recovery actions + migrate confirmation | `packages/ui/src/backend/__tests__/DevRuntimeDiagnosticsBanner.test.tsx` |
| Browser reporter bounds and listeners | `packages/ui/src/backend/__tests__/DevRuntimeReporter.test.tsx` |
| Health contract | `apps/mercato/src/app/api/healthz/__tests__/route.test.ts` (+ template) |

## Changelog

### 2026-08-21

- Connected the in-app banner to the recovery allowlist: `POST
  /api/dev-runtime/actions/{action}`, a supervisor-drained action channel, and
  `Run migrations` behind the shared confirmation dialog.

### 2026-08-20

- Implemented Phases 1–4: structured incident state, browser collector and
  continuous probe, opt-in gateway, and the recovery action runner.
- Added the dev-only status bridge, diagnostics route, health route, layout meta
  injection, in-app banner, and browser reporter in both the app and the
  standalone-app template.

### 2026-08-18

- Created the unified spec for intelligent splash diagnostics and the opt-in
  runtime gateway (issue #5369).
