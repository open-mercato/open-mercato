# Incremental dev-watch generation — issue #2205

Source doc: .ai/specs/implemented/2026-04-02-dev-structural-regeneration-and-cold-start-optimization.md
Issue: https://github.com/open-mercato/open-mercato/issues/2205

## Goal
Complete the existing spec's targeted dev-generation scope: classify structural snapshot changes, run only dependency-complete generator groups, retain deterministic full generation and conservative recovery.

## Scope
CLI watcher, source/distribution snapshot discovery, generator selection and registry output groups, focused regression and filesystem integration coverage. No database, HTTP route, UI or public convention changes. Parent owns contracts, integration and validation; subagents own disjoint source slices.

## Implementation Plan
1. Measure current fingerprint and generator event-to-ready behavior using the current code, and refine the existing specification with the exact dependency contract.
2. Add structural snapshots and deterministic add/change/delete classification; preserve existing checksum entrypoint.
3. Add conservative pure generator planning, explicit full fallback, and selected registry output groups.
4. Integrate snapshot planning with both watcher callers, failure recovery and pending-change reconciliation.
5. Narrow selected-output checksums and add category/plan logging without changing full output bytes.
6. Prove incremental/full output parity, deletions, source/dist lag, plugins, races, and failure recovery; run the configured gate, review and second opinion.
7. Publish the implementation PR, evidence and claim release.

## Risks
- Registry outputs share scans and compatibility aggregates: selective writes alone are insufficient if unrelated expensive generation still runs.
- Source mirrors and lagging distribution output must both be represented; app overrides and deletions must retain precedence.
- Filesystem events are advisory; snapshots remain authoritative. Unknown events, topology, plugin and ambiguous changes fall back to full generation.
- Successful snapshots must not advance over failed generation or lose edits during a running pass.
- Full generation bytes, generated paths, CLI commands and discovery conventions remain unchanged.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Measurement and design
- [x] 1.1 Measure current watcher and generator baseline — c502a4bc0
- [x] 1.2 Refine existing specification and dependency contracts — c502a4bc0

### Phase 2: Implementation
- [x] 2.1 Add classified snapshots with deletion detection — a4e1f2517, dddfb9474
- [x] 2.2 Add safe generator plans and selective registry emission — a4e1f2517
- [x] 2.3 Integrate watcher execution and fallback recovery — a4e1f2517
- [x] 2.4 Narrow checksum work and add plan logs — a4e1f2517

### Phase 3: Verification
- [x] 3.1 Prove incremental and full generation parity — a4e1f2517
- [x] 3.2 Run configured validation and resolve review findings — a4e1f2517, dddfb9474, 7607e943e

### Phase 4: Delivery
- [ ] 4.1 Publish verified implementation and release claim

## Baseline evidence — 2026-09-23

- Runner: local Node 24.13.1; Docker daemon unavailable.
- Current app: full `yarn generate` reported 10.437s (12.14s command wall); repeat direct CLI reported 9.358s (9.61s wall), with unchanged outputs.
- Both current-app runs used the existing OpenAPI static fallback after a JSON import-attribute failure; these are not successful bundled/cache-hit measurements.
- Disposable source-TS and compiled-JS filesystem fixtures: 28 real watcher latency samples, median 246.93ms, p95 289.71ms. Full-suite baseline passed API/page/entity/DI add/change/delete, same-byte no-op and burst scenarios. Fixture OpenAPI uses static fallback; no Next/browser readiness or structural invalidation is measured.
- Specification amendment records dependency ownership, source/runtime lag, failure retries, conservative fallback and generated-byte parity requirements.

## Final verification — 2026-09-24

- Implementation and user-approved test-only gate repairs landed in `a4e1f2517`, `dddfb9474`, and `7607e943e`. Two independent reviewers reported no remaining implementation blockers.
- The configured eight-command local gate passed in order through `yarn test` and `yarn build:app`. Full tests: 46 successful workspace tasks, four cached, 4m14.596s. Final app build: one successful task, 24.202s.
- Installed Node 24.13.1 was used. Native Jest worker crashes matched upstream Node issue #62393; a temporary local `--no-sparkplug` launcher enabled the final full test run without changing repository runtime settings, test selection, or sandbox restrictions. Benchmark evidence uses unmodified Node 24.13.1.
- Focused CLI coverage: 135 tests across 10 suites. Current-app full generation preserved all 453 baseline non-checksum artifacts. Full-versus-incremental watcher comparisons had zero artifact differences at all 30 checkpoints across source-TS/compiled-JS layouts, in both successful-bundle and fallback modes.
- No headline performance ratio is claimed: fixture debounce dominates timing, and current-app OpenAPI uses the existing JSON import-attribute static fallback. The spec records timing boundaries and conservative cascading.
- Remote CI at `7607e943e`: unit tests, lint, design-system lint, Docker build, CodeQL, documents multi-instance, and 14/15 integration shards passed. Shard 2 fails at `todo-priority-validation.spec.ts:129`: the selected Medium severity option stays outside the viewport, so the test never submits the form. Trace and screenshot were inspected; cause remains unclassified between test orchestration and product positioning. No interaction was bypassed. Ready for review does not mean CI-green or merge-ready.
- Approved existing-test changes are limited to `CrudForm.hiddenGroups.test.tsx`, `CrudForm.transformData.test.tsx`, `detect-locale-narrowed.test.ts`, `optionsSectionEmptyState.test.tsx`, and `module-package-sources.test.ts`. Production UI/locale behavior and assertion intent are unchanged; no Jest configuration change is retained.
