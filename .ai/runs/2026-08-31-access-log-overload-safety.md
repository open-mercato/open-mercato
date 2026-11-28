# Access-Log Overload Safety — Execution Plan

Source doc: .ai/specs/2026-08-30-access-log-overload-safety.md
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

PR: #8472
Branch: carry/pr-5802-ready-5860
Last updated: 2026-11-02

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Bounded pending-operation tracker

- [x] 1.1 Add the shared tracker, capacity parser, exact telemetry points, settlement-wave flushing, and lifecycle tests. — 778f9b0649

### Phase 2: CRUD dispatch admission

- [x] 2.1 Replace the unbounded CRUD dispatch set with capacity-first admission, deterministic rejection results, rate-limited warnings, and regression coverage. — 0067004e2d

### Phase 3: Service admission and rotation safety

- [x] 3.1 Replace the service write set with independent capacity-first admission and preserve `log`, `logMany`, and `flush` contracts. — 561293d1c1
- [x] 3.2 Coalesce concurrent retention sweeps into one in-flight promise and extend interval-zero concurrency coverage. — 561293d1c1

### Phase 4: Configuration and documentation

- [x] 4.1 Add the application/template environment example, user guide, telemetry catalog, and implemented-spec catalog updates. — 22be33f313
- [x] 4.2 Run template synchronization and the repository validation gate. — 2fe9bc2808

### Phase 5: Review remediation

- [x] 5.1 Merge the current main base and resolve the lesson catalog conflict. — 63cb10f0c
- [x] 5.2 Route sampler, collector, pool, and tracker callback failures through guarded error reporting with regression coverage. — 59ac59147
- [x] 5.3 Verify the corrected head, record coverage-job applicability, publish the fixes, and request independent re-review. — d341f009b
- [x] 5.4 After corrected prerequisite #5801 is approved and merged, merge main again and confirm the remaining access-log diff. — prerequisite superseded by merged #8434; main synchronized at 0ef0f453c62ee98ffe3853c669a3197f7b00f877

The final step is an external merge-order gate. This continuation does not authorize merging #5801 or this PR into main. Prerequisite #5801 remains open at `3f5a5e9e5e6de4bc9c7205f9eb8016329cdf9ba9`, with corrected `om.db.pool.*` names and explicit seconds buckets. Incorporate those prerequisite corrections into this branch, retain its run plan, and compare again after #5801 lands.

Prerequisite corrections were incorporated in `c051d24a5`. Its provider, OTLP integration tests, and runtime-saturation run plan match #5801 exactly; shared pool/collector code additionally retains this PR's guarded reporting fixes. Documentation preserves both corrected pool rows and the access-log rows.

Verification on the merged source: shared tracker/collector/pool/CRUD tests passed (73 tests); telemetry passed (161 tests, 2 skipped); audit-log service/rotation passed (14 tests); both affected packages typechecked with imports mapped to this checkout's shared source; changed-file lint, lesson catalog, agent budget ratchet, and diff checks passed. Eleven new regression cases failed against the original source and passed after the reporting fix. Fixes were fast-forwarded to the existing branch at `d341f009b`; independent re-review was requested from `adeptofvoltron` and `pkarw`.

The previous GitHub run `38387594406` recorded `merge-coverage` as skipped despite all 15 integration shards succeeding. All 15 of that exact head's artifact summaries were downloaded and merged with `scripts/merge-coverage.mjs`: 445,048 / 710,237 lines, 62.66%. This supplies the missing aggregation evidence without changing CI policy or marking a skipped GitHub check as successful. The new published head still requires its own CI result.

## 2026-11-02 synchronized review

Corrected prerequisite #8434 supersedes #5801 and merged as 3db3e49c916dbd0f04e5f7c400aa2270e4117b78. Main at 0ef0f453c62ee98ffe3853c669a3197f7b00f877 is incorporated, preserving its telemetry/pool implementation and prerequisite run record. The remaining production changes are bounded access-log admission/rotation and the inherited QA #8221 bulk-cart snapshot-under-lock correction, which main still lacks. Earlier statements above describe historical gates.

Local source-mapped verification: 101 tests pass across tracker/CRUD (31), audit service/rotation/cart commands (53), telemetry reporting (9), and OpenCode runner fixture (8). Shared and core source-mapped typechecks pass; core validation reuses the generated entity registry and permits the existing TSX-extension import. Initial unconfigured checks exposed linked-workspace/generated-registry resolution limitations, resolved only in temporary validation configuration. No assertions, production config, or workflow limits changed. Lessons catalog and whitespace checks pass. Full current-head CI and affected QA remain separate gates; prior human QA FAIL #6503537681 remains unresolved until a real rerun, especially TC-CART-CONC-06/07/08. No application/database initialization was run.

Carried forward from #5802 by `om-auto-review-pr` autofix to #8472. Next concrete action: real affected QA (including TC-CART-CONC-06/07/08) and full exact-head CI; no QA or merge approval is recorded here.
