# Greenfield build and migration reindex bootstrap fixes

## Goal

Keep compiled modules available during overlapping package builds and bootstrap DI before queuing post-migration query-index rebuilds.

## Scope

Port the fixes and regression tests developed in the invoking checkout onto current main. Change the shared package builder, ESM import resolution, and CLI migration reindex setup. Preserve existing command names, database schema, and non-fatal reindex fallback.

Non-goals: reset local data, apply migrations, change package dependency versions, alter PR automation, or include unrelated working-tree changes.

## Implementation Plan

### Phase 1: Preserve runtime build outputs

1.1 Port build cleanup and import-resolution fixes with regressions for overlapping builds, compilation failure, stale output cleanup, and secondary build phases.

### Phase 2: Prepare migration reindex dependencies

2.1 Port lazy application bootstrap before queue container creation, with tests for successful scheduling, bootstrap failure, and no-migration runs.

### Phase 3: Verify and publish

3.1 Run focused tests and the configured validation commands with the local runner.
3.2 Run the authoritative PR review, address actionable findings, and publish the ready PR with validation evidence.

## Risks

Shared build cleanup affects every package: preserve outputs owned by other source roots and copied assets, and prune only obsolete compiled outputs identified by source maps. Reindex scheduling must remain non-fatal and must never replace a migration failure. The invoking checkout's first broad test run hit an intermittent CrudForm transform assertion; its focused retry passed. Validation must be repeated on the isolated branch.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Preserve runtime build outputs

- [ ] 1.1 Port build cleanup and import-resolution fixes with regression tests

### Phase 2: Prepare migration reindex dependencies

- [ ] 2.1 Port lazy application bootstrap and migration reindex regression tests

### Phase 3: Verify and publish

- [ ] 3.1 Run focused tests and the configured validation gate
- [ ] 3.2 Complete authoritative review and publish the ready PR
