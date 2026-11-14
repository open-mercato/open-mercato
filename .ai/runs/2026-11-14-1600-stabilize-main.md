# Stabilize main — 2026-11-14 16:00 Europe/Warsaw

## Goal

Verify main and a dedicated full-suite stabilization PR; repair only demonstrated root causes, then request automerge after green checks and independent review.

## Scope

Branch: `stabilize/main-2026-11-14-1600`, based on main `3de4ce96a8c41aca2026e879bbd78a4898e94967`.
The unsuffixed dated branch already shipped as #9497; the 0800 run owns #9512. This occurrence uses its scheduled time to preserve both runs.
Main CI run 43602981865 already passed every one of its 15 integration shards and its other applicable jobs. The existing workflow supports trusted stabilization branches and `ci-full`, including unfiltered typecheck and unit tests. Preserve that behavior.

Non-goals: speculative fixes, duplicate workflow changes, changes to public contracts or production dependencies, taking over earlier stabilization PRs, merging into main.

## Implementation Plan

### Phase 1: Establish evidence

1.1 Independently audit current main workflow results and full-suite selection; investigate any demonstrated failure.
1.2 Record findings and validate the focused stabilization branch changes.

### Phase 2: Verify and review

2.1 Run this draft PR's full 15-shard suite and repair any demonstrated root cause, with regression coverage.
2.2 Dispatch one final independent review task after implementation; address findings and obtain approval before merging any reviewed child changes.
2.3 Record final evidence, finish the PR, and apply `automerge` only when current-head checks and workflows are green.

## Risks

A successful CI workflow does not establish that every other workflow has completed. Inspect current-head runs as well as checks. Existing expected skips are not failures. New commits invalidate prior check evidence. CI may reveal defects after this initial green baseline; all fixes stay on this branch. No local dependency installation exists initially; docs-only validation uses diff review, while actual fixes require the configured gate.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Establish evidence

- [ ] 1.1 Independently audit current main workflow results and full-suite selection; investigate any demonstrated failure.
- [ ] 1.2 Record findings and validate the focused stabilization branch changes.

### Phase 2: Verify and review

- [ ] 2.1 Run this draft PR's full 15-shard suite and repair any demonstrated root cause, with regression coverage.
- [ ] 2.2 Dispatch one final independent review task after implementation; address findings and obtain approval before merging any reviewed child changes.
- [ ] 2.3 Record final evidence, finish the PR, and apply `automerge` only when current-head checks and workflows are green.
