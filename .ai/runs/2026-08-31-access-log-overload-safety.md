# Access-Log Overload Safety — Execution Plan

Source doc: .ai/specs/2026-08-30-access-log-overload-safety.md
Spec PR: #5800
Issue: #5784
Dependency PR: #5801

## Goal

Bound process-local access-log write backlogs at both asynchronous stages, expose exact low-cardinality backlog metrics, and prevent concurrent retention sweeps without changing access-log API or persistence contracts.

## Scope

- Add a reusable bounded pending-operation tracker with admission-before-start semantics, draining, metrics, warning throttling, and explicit cleanup.
- Apply the tracker independently to CRUD dispatch and service writes with a default capacity of 256 per stage.
- Keep blocking and fire-and-forget return contracts deterministic when capacity is exhausted.
- Make retention rotation single-flight while preserving the configured rotation interval, including the `0` test mode.
- Document the new environment setting and metric catalog.

## Non-goals

- Database pool, event-loop, memory, or heap-space metrics; those are implemented by dependency PR #5801.
- Durable access-log queues, retries, spill-to-disk, schema/API/UI changes, or tenant-configurable capacity.
- Dynamic metric attributes, request payloads in warnings, or changes to retention durations.

## Implementation Plan

### Phase 1: Bounded pending-operation tracker

1. Add the shared tracker, capacity parser, exact telemetry points, settlement-wave flushing, and lifecycle tests.

### Phase 2: CRUD dispatch admission

1. Replace the unbounded CRUD dispatch set with capacity-first admission, deterministic rejection results, rate-limited warnings, and regression coverage.

### Phase 3: Service admission and rotation safety

1. Replace the service write set with independent capacity-first admission and preserve `log`, `logMany`, and `flush` contracts.
2. Coalesce concurrent retention sweeps into one in-flight promise and extend interval-zero concurrency coverage.

### Phase 4: Configuration and documentation

1. Add the application/template environment example, user guide, telemetry catalog, and implemented-spec catalog updates.
2. Run template synchronization and the repository validation gate.

## Risks

- Admission after constructing a write promise would retain the overload bug; invoke the async factory only after capacity is reserved.
- The two stages must remain independently bounded so a stalled service does not consume CRUD dispatch capacity or vice versa.
- Tracker cleanup can lose late work added while flushing; drain repeated settlement waves until the registry is empty.
- Metrics and warnings must not weaken enforcement; isolate observability callback failures and use only fixed stage/reason attributes.
- Rotation interval `0` must still rotate on sequential writes while concurrent callers await the same active sweep.

## Progress

PR: #5802

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Bounded pending-operation tracker

- [x] 1.1 Add the shared tracker, capacity parser, exact telemetry points, settlement-wave flushing, and lifecycle tests. — 778f9b0649

### Phase 2: CRUD dispatch admission

- [x] 2.1 Replace the unbounded CRUD dispatch set with capacity-first admission, deterministic rejection results, rate-limited warnings, and regression coverage. — 0067004e2d

### Phase 3: Service admission and rotation safety

- [ ] 3.1 Replace the service write set with independent capacity-first admission and preserve `log`, `logMany`, and `flush` contracts.
- [ ] 3.2 Coalesce concurrent retention sweeps into one in-flight promise and extend interval-zero concurrency coverage.

### Phase 4: Configuration and documentation

- [ ] 4.1 Add the application/template environment example, user guide, telemetry catalog, and implemented-spec catalog updates.
- [ ] 4.2 Run template synchronization and the repository validation gate.
