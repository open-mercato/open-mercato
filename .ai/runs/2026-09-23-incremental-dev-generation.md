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
- [x] 1.1 Measure current watcher and generator baseline
- [x] 1.2 Refine existing specification and dependency contracts

### Phase 2: Implementation
- [ ] 2.1 Add classified snapshots with deletion detection
- [ ] 2.2 Add safe generator plans and selective registry emission
- [ ] 2.3 Integrate watcher execution and fallback recovery
- [ ] 2.4 Narrow checksum work and add plan logs

### Phase 3: Verification
- [ ] 3.1 Prove incremental and full generation parity
- [ ] 3.2 Run configured validation and resolve review findings

### Phase 4: Delivery
- [ ] 4.1 Publish verified implementation and release claim

## Baseline evidence — 2026-09-23

- Runner: local Node 24.13.1; Docker daemon unavailable.
- Current app: full `yarn generate` reported 10.437s (12.14s command wall); repeat direct CLI reported 9.358s (9.61s wall), with unchanged outputs.
- Both current-app runs used the existing OpenAPI static fallback after a JSON import-attribute failure; these are not successful bundled/cache-hit measurements.
- Disposable source-TS and compiled-JS filesystem fixtures: 28 real watcher latency samples, median 246.93ms, p95 289.71ms. Full-suite baseline passed API/page/entity/DI add/change/delete, same-byte no-op and burst scenarios. Fixture OpenAPI uses static fallback; no Next/browser readiness or structural invalidation is measured.
- Specification amendment records dependency ownership, source/runtime lag, failure retries, conservative fallback and generated-byte parity requirements. Implementation and final gates remain pending.
