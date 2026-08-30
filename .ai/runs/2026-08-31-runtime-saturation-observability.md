# Runtime Saturation Observability — Execution Plan

Source doc: .ai/specs/2026-08-30-runtime-saturation-observability.md
Spec PR: #5800
Issue: #5784

## Goal

Add default-unloaded PostgreSQL pool and Node.js runtime saturation metrics through the existing provider-neutral telemetry facade, with exact low-cardinality contracts and leak-free lifecycle behavior.

## Scope

- Extend the shared telemetry bridge with additive metric recording and periodic collector registration.
- Sample Node.js event-loop utilization/delay and memory only after a provider is active.
- Register the primary PostgreSQL pool as a periodic collector and record caller-observed acquisition wait.
- Preserve both documented `pool.connect` overloads, disabled behavior, re-initialization, and cleanup.
- Update the built-in metric catalog and focused documentation.

## Non-goals

- Access-log backlog caps or retention rotation; those are implemented from the companion spec.
- A metrics endpoint, dashboards, alert rules, SLOs, tuning changes, or request-phase tracing.
- New telemetry dependencies, API/UI/schema changes, or dynamic tenant/request attributes.

## Implementation Plan

### Phase 1: Shared bridge and Node.js runtime sampler

1. Add the provider-neutral metric point/helper and periodic collector registry with bridge tests.
2. Add the enabled-only runtime sampler and provider lifecycle integration with fake-timer and recording-provider tests.

### Phase 2: PostgreSQL pool instrumentation

1. Register idempotent pool state collection and wrap promise/callback acquisition timing with explicit cleanup.
2. Extend pool tests for exact gauges, wait histograms, overload preservation, late telemetry initialization, disabled no-timer behavior, and disposal.

### Phase 3: Catalog and compatibility documentation

1. Update the telemetry README, package guidance, and implemented telemetry specification with the exact built-in metric catalog and lifecycle rules.

## Risks

- Wrapping `pg.Pool.connect` can affect every acquisition; preserve `this`, both overloads, success/failure semantics, and restore the exact original method on disposal.
- Global collector/sampler state can leak across HMR or Jest; use symbol-keyed stores, idempotent registration, explicit cleanup, and reset coverage.
- Runtime/pool labels can create cost or disclosure risk; emit only fixed pool/state values and bounded Node heap-space names.
- Event-loop monitoring adds enabled-only overhead; retain a 20 ms monitor resolution and 10-second unref'ed interval.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Shared bridge and Node.js runtime sampler

- [ ] 1.1 Add the provider-neutral metric point/helper and periodic collector registry with bridge tests.
- [ ] 1.2 Add the enabled-only runtime sampler and provider lifecycle integration with fake-timer and recording-provider tests.

### Phase 2: PostgreSQL pool instrumentation

- [ ] 2.1 Register idempotent pool state collection and wrap promise/callback acquisition timing with explicit cleanup.
- [ ] 2.2 Extend pool tests for exact gauges, wait histograms, overload preservation, late telemetry initialization, disabled no-timer behavior, and disposal.

### Phase 3: Catalog and compatibility documentation

- [ ] 3.1 Update the telemetry README, package guidance, and implemented telemetry specification with the exact built-in metric catalog and lifecycle rules.
