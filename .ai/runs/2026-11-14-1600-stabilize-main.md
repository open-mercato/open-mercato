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

## Evidence (2026-11-14 15:34 UTC)

- [Baseline main CI](https://github.com/open-mercato/open-mercato/actions/runs/43602981865): all 15 integration shards and applicable jobs passed. [Baseline CodeQL](https://github.com/open-mercato/open-mercato/actions/runs/43602981943) passed.
- [PR full CI](https://github.com/open-mercato/open-mercato/actions/runs/43608118295), head `3328016caa75897327273f542efae32fc1560c7e`: completed successfully with all 15 shards. The test log confirms `FORCE_FULL_SUITE=true`, 42 typecheck tasks and 51 unit-test tasks passed. Build/generate, i18n sync, lint, DS lint, Docker, timezone and multi-instance checks passed. Existing i18n usage diagnostics remain advisory.
- [Independent final review](https://github.com/open-mercato/open-mercato/pull/9530#pullrequestreview-5905421932): approve with zero findings on that exact head. GitHub disallows the author bot's native approval; the COMMENT explicitly records the independent agent verdict, without claiming a native approval.
- Independent read-only audit confirmed full-suite forcing and per-PR concurrency already exist; no code or workflow repair is justified. Neither dispatched task changed any files; no child branch was merged.
- Runner: GitHub CI for executable validation; local `git diff --check` and manual reread for this documentation-only change. No Markdown lint command is configured. Full local package builds are unnecessary for the docs-only diff.
- [Baseline main standalone integration](https://github.com/open-mercato/open-mercato/actions/runs/43602981849) remains running; its publish/build/setup steps passed. Main advanced to `30b4691fc6b9b856d9a846c9c92857f13fa265c3`; its [CI](https://github.com/open-mercato/open-mercato/actions/runs/43609686690) is running and [snapshot](https://github.com/open-mercato/open-mercato/actions/runs/43609686748) is pending. These outcomes are not yet verified.
- Final documentation commits start a new PR run. Readiness and `automerge` remain gated on exact final-head checks and workflow completion; the earlier green run does not certify a later SHA.

## Risks

A successful CI workflow does not establish that every other workflow has completed. Inspect current-head runs as well as checks. Existing expected skips are not failures. New commits invalidate prior check evidence. CI may reveal defects after this initial green baseline; all fixes stay on this branch. No local dependency installation exists initially; docs-only validation uses diff review, while actual fixes require the configured gate.

## Progress

PR: #9530

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Establish evidence

- [x] 1.1 Independently audit current main workflow results and full-suite selection; investigate any demonstrated failure.
- [x] 1.2 Record findings and validate the focused stabilization branch changes.

### Phase 2: Verify and review

- [ ] 2.1 Run this draft PR's full 15-shard suite and repair any demonstrated root cause, with regression coverage.
- [ ] 2.2 Dispatch one final independent review task after implementation; address findings and obtain approval before merging any reviewed child changes.
- [ ] 2.3 Record final evidence, finish the PR, and apply `automerge` only when current-head checks and workflows are green.
