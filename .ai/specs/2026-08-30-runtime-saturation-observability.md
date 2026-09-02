# Runtime Saturation Observability

## TLDR

Add low-cardinality PostgreSQL pool and Node.js runtime metrics to the existing opt-in telemetry facade. Operators will be able to distinguish pool exhaustion, connection-acquisition delay, event-loop saturation, and memory pressure without enabling a second metrics system or loading telemetry when it is disabled.

This is the first implementation slice for issue [#5784](https://github.com/open-mercato/open-mercato/issues/5784). The independently shippable access-log overload controls are specified in `.ai/specs/2026-08-30-access-log-overload-safety.md`.

### Scope

- Add an optional metrics method to the shared telemetry runtime bridge.
- Instrument the primary PostgreSQL pool with connection-state, pending-request, configured-maximum, and acquisition-wait metrics.
- Start an enabled-only Node.js sampler for event-loop utilization/delay and process/V8 memory.
- Add lifecycle, disabled-mode, and provider-integration tests plus metric catalog documentation.

### Out of scope

- Access-log admission control, pending-write metrics, or rotation behavior; those belong to the companion spec.
- A `/metrics` or health endpoint, dashboards, alert rules, SLOs, pool-size tuning, or request-phase tracing.
- New OpenTelemetry dependencies or dynamic tenant/user/route/record labels.

## Overview

Open Mercato already exposes counter, histogram, and gauge recording through a default-unloaded telemetry package. Packages such as `@open-mercato/shared` cannot import the provider package directly, so they use a process-global, provider-neutral runtime bridge. This change extends that bridge additively and instruments the two runtime owners that can identify saturation accurately: the primary `pg.Pool` and the telemetry process lifecycle.

OpenTelemetry defines the adopted database metric names and units, while the official Node.js runtime instrumentation and Node `perf_hooks` APIs provide the runtime naming and calculation precedent:

- <https://opentelemetry.io/docs/specs/semconv/db/database-metrics/>
- <https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/packages/instrumentation-runtime-node>
- <https://nodejs.org/api/perf_hooks.html>
- <https://node-postgres.com/apis/pool>

The design adopts the standard names, seconds/bytes units, interval-delta utilization, and bounded labels. It rejects adding the general runtime-instrumentation dependency because this requested subset is small and the package must remain explicitly loaded.

## Problem Statement

The pool creation seam currently attaches error handlers and optionally logs static configuration. It never reports `totalCount`, `idleCount`, `waitingCount`, configured maximum, or caller-observed acquisition wait. A timeout is therefore visible only after the useful diagnostic window.

Production benchmarking also cannot distinguish database wait from synchronous event-loop saturation. App/container CPU alone does not expose single-thread delay, and delay without RSS/heap context cannot distinguish blocking from memory pressure or GC behavior.

Any solution must keep telemetry fully off when `TELEMETRY_BACKEND` is unset or `noop`, avoid high-cardinality or sensitive labels, and stop samplers across shutdown, tests, and development reloads.

## Proposed Solution

### Add an optional shared metric bridge

Extend `TelemetryRuntime` with `recordMetric?(point)` and add `recordTelemetryMetric(point): boolean`. The helper returns `false` when no metric runtime is active and otherwise forwards to the provider. Optionality preserves compatibility with existing hosts compiled against the current bridge.

### Instrument the primary PostgreSQL pool

Attach instrumentation once in `onPoolCreated`:

- Sample pool state every 10 seconds only while a telemetry runtime is active.
- Record `idle` and `used = max(0, totalCount - idleCount)` connection gauges, pending requests, and configured maximum.
- Wrap the documented promise and callback forms of `pool.connect` once and record the caller-observed duration on both success and failure.
- Preserve `this`, callback arguments, promise rejection, and returned-client semantics.
- Return cleanup that stops the sampler and restores the original `connect`; invoke it before pool replacement/ORM close.

The implementation may perform a cheap runtime-active check before creating a sampled interval and must also support telemetry initialization after pool creation. It must not leave a polling interval running while telemetry remains disabled.

### Start enabled-only Node.js runtime sampling

After a provider starts successfully, initialize one process-global sampler with a private 10-second interval. It enables `monitorEventLoopDelay({ resolution: 20 })`, records utilization deltas and p50/p90/p99 delay in seconds, and reports RSS plus used bytes per bounded V8 heap-space name. Shutdown/reset disables the monitor, clears the interval, and removes global sampler state.

## User Stories / Use Cases

- An operator wants pool state and acquisition latency so they can confirm pool exhaustion before increasing capacity.
- An operator wants event-loop delay, utilization, RSS, and heap-space usage so they can separate DB wait from runtime saturation.
- A module author wants to record a provider-neutral metric without importing optional telemetry dependencies.

## Architecture

```text
explicit telemetry bootstrap
  └─ active TelemetryProvider
      ├─ runtime sampler (event loop + memory)
      └─ shared TelemetryRuntime.recordMetric? bridge
          └─ primary pg.Pool sampler + connect wait histogram
```

- `@open-mercato/shared` never imports `@open-mercato/telemetry`.
- Provider/bridge/sampler state that may cross duplicated bundles uses `globalThis` symbols.
- Instrumentation is idempotent and has an explicit disposer.
- There are no module relationships, commands, events, or generated registries.

## Data Models

No database schema or persisted data changes. Metric attributes contain only fixed pool/state and bounded V8 heap-space values supplied by Node; they contain no tenant, organization, user, route, record, or payload data.

## API Contracts

### Additive TypeScript surface

```ts
export type TelemetryMetricPoint = {
  kind: 'counter' | 'histogram' | 'gauge'
  name: string
  value: number
  labels?: Record<string, string | number | boolean | undefined>
  unit?: string
}

export type TelemetryRuntime = {
  // Existing members remain unchanged.
  recordMetric?(point: TelemetryMetricPoint): void
}

export function recordTelemetryMetric(point: TelemetryMetricPoint): boolean
```

### Metrics catalog

| Metric | Kind | Unit | Labels | Meaning |
|---|---|---:|---|---|
| `db.client.connection.count` | gauge | `{connection}` | pool=`primary`, state=`idle|used` | Current open connections by state. |
| `db.client.connection.pending_requests` | gauge | `{request}` | pool=`primary` | Current callers waiting for a connection. |
| `db.client.connection.max` | gauge | `{connection}` | pool=`primary` | Configured maximum pool size. |
| `db.client.connection.wait_time` | histogram | `s` | pool=`primary` | Caller-observed `pool.connect` duration. |
| `nodejs.eventloop.utilization` | gauge | `1` | none | Event-loop utilization for the previous interval. |
| `nodejs.eventloop.delay.p50` | gauge | `s` | none | Interval p50 event-loop delay. |
| `nodejs.eventloop.delay.p90` | gauge | `s` | none | Interval p90 event-loop delay. |
| `nodejs.eventloop.delay.p99` | gauge | `s` | none | Interval p99 event-loop delay. |
| `process.memory.usage` | gauge | `By` | none | Process RSS. |
| `v8js.memory.heap.used` | gauge | `By` | `v8js.heap.space.name` | Used bytes per bounded V8 heap space. |

There are no HTTP or UI contract changes, new i18n keys, or configuration variables. Manual UI QA is not applicable.

## Migration & Compatibility

- No migration, backfill, endpoint, response, entity, event, ACL, or discovery change.
- The bridge method is optional and the helper is additive at the existing stable import path.
- Telemetry remains disabled and unloaded by default; unsetting or setting `TELEMETRY_BACKEND=noop` removes the samplers and metrics.
- Rollback is a code revert; no stored state requires reversal.

## Implementation Plan

### Phase 1: Bridge and process runtime

1. Add the metric point type, optional runtime method, helper, and no-op/forwarding tests.
2. Add the process runtime sampler, wire it after provider start and before provider shutdown, and test disabled, re-init, fake-timer, and cleanup behavior.

### Phase 2: Pool instrumentation

1. Add pool state sampling and `connect` wait timing at the primary pool creation seam.
2. Cover both overloads, success/failure, idempotency, late telemetry init, disabled no-timer behavior, and disposal.
3. Update the telemetry metric catalog and implemented telemetry spec changelog.

### File Manifest

| File | Action | Purpose |
|---|---|---|
| `packages/shared/src/lib/telemetry/runtime.ts` | Modify | Add the provider-neutral metric bridge. |
| `packages/shared/src/lib/telemetry/__tests__/*` | Add/modify | Verify disabled and forwarding behavior. |
| `packages/shared/src/lib/db/mikro.ts` | Modify | Attach pool metrics, wait timing, and lifecycle cleanup. |
| `packages/shared/src/lib/db/__tests__/mikro.test.ts` | Modify | Verify the pool seam and overloads. |
| `packages/telemetry/src/runtime-metrics.ts` | Add | Sample event loop and memory when enabled. |
| `packages/telemetry/src/init.ts` | Modify | Wire sampler/bridge lifecycle. |
| `packages/telemetry/src/__tests__/*` | Add/modify | Provider and runtime lifecycle coverage. |
| `packages/telemetry/{README.md,AGENTS.md}` | Modify | Document built-in metrics and guardrails. |
| `.ai/specs/2026-04-29-telemetry-and-otel.md` | Modify | Keep the implemented catalog/changelog accurate. |

### Testing Strategy

- Unit tests use fake timers and fake pools/providers; exact metric names, units, labels, values, and record counts are asserted.
- Provider-integration coverage records through the real telemetry facade with an in-memory provider.
- No browser/API integration scenario is added because no HTTP or UI path changes.

## Risks & Impact Review

#### Pool connect wrapping breaks acquisition
- **Scenario**: The wrapper mishandles callback `this`, arguments, promise rejection, or client returns.
- **Severity**: High
- **Affected area**: Every PostgreSQL acquisition in the app process.
- **Mitigation**: Preserve both documented overloads, bind the original pool, wrap once, restore on disposal, and test success/failure for both forms.
- **Residual risk**: A future node-postgres overload may require adaptation; focused upgrade tests expose it.

#### Samplers leak across reload or shutdown
- **Scenario**: Re-initialization leaves intervals or delay monitors active and emits duplicate metrics.
- **Severity**: Medium
- **Affected area**: Process overhead and telemetry correctness.
- **Mitigation**: Global-symbol idempotency, explicit disposers, `unref()` intervals, and repeated init/shutdown tests.
- **Residual risk**: Abrupt process termination skips cleanup, but the OS reclaims the process state.

#### Labels leak data or create cardinality growth
- **Scenario**: Dynamic request or tenant values become metric attributes.
- **Severity**: High
- **Affected area**: Telemetry cost and confidentiality.
- **Mitigation**: Fixed pool/state labels, bounded Node heap-space names, exact-label tests, and existing provider redaction.
- **Residual risk**: Future contributors can expand labels; package rules and tests remain the guardrail.

#### Sampling changes benchmark behavior
- **Scenario**: Event-loop monitoring or polling measurably affects throughput.
- **Severity**: Low
- **Affected area**: Telemetry-enabled processes only.
- **Mitigation**: Disabled mode starts nothing, delay resolution is 20 ms, sampling is 10 seconds, and no high-frequency callback/dependency is added.
- **Residual risk**: Enabled observability is not zero-cost; benchmarks compare enabled and disabled runs.

## Final Compliance Report — 2026-08-30

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/telemetry/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root `AGENTS.md` | Check specs and preserve contracts. | Compliant | Builds on the implemented telemetry spec and changes only additive bridge/metric behavior. |
| `packages/shared/AGENTS.md` | Shared code must not import domain/provider packages. | Compliant | The bridge is provider-neutral and optional. |
| `packages/telemetry/AGENTS.md` | Default-unloaded, semantic names, bounded labels, global state. | Compliant | Samplers start only after provider activation; labels are fixed; state is idempotent. |
| `packages/telemetry/AGENTS.md` | Ask before built-in metrics/global hooks/dependencies. | Compliant | Issue #5784 authorizes the built-in metrics; no dependency is added. |
| `BACKWARD_COMPATIBILITY.md` | Do not remove, rename, or narrow stable contracts. | Compliant | Existing signatures and paths remain; the runtime member is optional. |
| root data/UI rules | Preserve isolation and design-system behavior. | N/A | No tenant data, API, database, or UI surface changes. |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | Neither changes. |
| API contracts match UI/UX section | Pass | Both are explicitly unchanged. |
| Risks cover all write operations | N/A | No domain write is introduced. |
| Commands defined for all mutations | N/A | No command/mutation is introduced. |
| Cache strategy covers all read APIs | N/A | No read API/cache change. |
| Integration coverage maps affected paths | Pass | Provider and pool boundaries have focused coverage. |

### Non-Compliant Items

None.

### Verdict

**Fully compliant: Approved — ready for implementation.**

## Changelog

### 2026-08-30

- Added the runtime saturation observability design for issue #5784.
- Split access-log overload safety into its own independently shippable companion specification after fresh-context scope review.
