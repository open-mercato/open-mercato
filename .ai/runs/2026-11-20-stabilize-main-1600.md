# Stabilize main — 2026-11-20 16:00

## Goal

Diagnose and correct demonstrated main CI failures, verify a full-suite draft PR into main, and request automerge only after green final-head CI and independent review.

## Scope

Base: `e2099fcc8e9e45bb72cc0c2a3558f738f6160c71`. Use `stabilize/main-2026-11-20-1600`: today's unsuffixed branch and 08:00 branch already merged as #10037 and #10073. Do not overwrite their plans or branches. Existing trusted stabilization-prefix and `ci-full` routing already forces full typecheck, unit tests and all 15 shards; verify and reuse it.

Non-goals: merge into main, publish packages, suppress checks or weaken assertions, change public contracts or production dependencies, change release behavior, or implement the draft phased-integration design.

Source doc: `.ai/specs/implemented/2026-04-10-ci-cd-performance.md`

## Implementation Plan

### Phase 1: Establish evidence

1.1 Open a full-suite draft PR and independently investigate current main failures.

### Phase 2: Correct and verify

2.1 Fix demonstrated root causes with regression coverage, preserving behavior when no defect is established.
2.2 Run configured validation and verify all applicable workflows, including 15 integration shards, on the exact PR head.

### Phase 3: Review and finalize

3.1 Dispatch ONE final independent review task, validate its evidence and resolve actionable findings.
3.2 Publish evidence, finish tracking, promote the PR and apply automerge only after final-head CI is green.

## Delegation

At most two cezar subtasks: one independent, read-only main CI investigation with no repository edits; one final review of the completed branch. Keep fixes and validation together because they depend on the same evolving CI evidence. No child changes are merged without review.

## Risks

Main may advance independently. Earlier snapshot failures may predate the merged Awilix compatibility fix in #10073. Read checks and workflow runs for the exact head before declaring success. Use hosted gate evidence if local prerequisites are unavailable and disclose that limit. Never publish packages to reproduce a failure.

## Verified failure and correction

Initial full PR run [44761357637](https://github.com/open-mercato/open-mercato/actions/runs/44761357637) passed all 15 integration shards, package and app builds, full typecheck and unit suites, lint, Docker, timezone and multi-instance checks. Its `test` job failed in the unfiltered root scripts gate: `scripts/__tests__/check-lessons.test.mjs` found 193 records but `.ai/lessons.md` declared 192. Commit `741205319c` added the canonical-read lesson row without updating the count. The failing catalog test reproduces locally (one failed, four passed). Commit `2fb9c77989` corrects only the declared count; the same five tests and the catalog checker now pass. No assertions or checker behavior changed. Later test-job guards and coverage merge were not executed on the initial run and remain required on the corrected head.

Runner: local for focused checks. All 45 scope/concurrency/coverage regressions also pass. Local `yarn build:packages` cannot start because this checkout lacks Yarn install state; do not claim a complete local gate. Hosted CI provides the remaining gate evidence. No workflow change is needed: existing trusted `stabilize/*` and `ci-full` selection already forces full scope.

## Standalone queue investigation and correction

Validated the read-only child `9725725e` report against [post-Awilix snapshot run 44738109765](https://github.com/open-mercato/open-mercato/actions/runs/44738109765/job/136304680100): the standalone app builds, but twelve structure-dependent tests time out waiting for an extraction with last status `none`. The snapshot disables workers. Upload extraction is queued through the persistent attachment event subscriber, and explicit extraction also enqueues work; the shared test helper only polled. The helper and worker configuration are unchanged at this branch's baseline. Baseline snapshot run `44760649594` remains pending, so its result is not claimed.

The test helper now settles `events` before `attachments-document-structure` using existing `drainIntegrationQueue`, which observes managed workers and runs an app-scoped consumer only when workers are disabled. Section-search deletion and partition-toggle assertions also settle the structure queue. No production queue semantics, security assertions, timeouts or workflow behavior change. Five new helper regressions simulate automatic/explicit extraction, re-extraction, already-settled queues and drain failures: four fail before the fix; all five pass after. Together with existing managed-worker queue and section-search sync regressions, 37 tests pass locally. A worker-disabled ephemeral API run is pending.

Newer main independently corrected the count in #10150 (`7d79c51b14`), so the substantive PR change is now the structure test fix. Stale Awilix failures were already fixed by #10073; historical CodeQL failures were external bundle-download HTTP 504s and exact-baseline CodeQL passed. No child source changes were made or merged.

Local preparation is now available: immutable dependency install and build/generate/build passed. The host lacks native build tools; an isolated Node 24 Docker build produced the ignored SQLite binary and an in-memory SQLite probe passed. A long temporary directory exceeded the tsx IPC socket path limit; local validation uses `TMPDIR=/tmp`. i18n sync/usage and typechecking passed; the full unit run was intentionally stopped before app-building concurrently with the ephemeral harness, and must be completed later or proven by hosted checks. Do not claim the interrupted gate passed.

Claim run: `5032d9a6-7403-48b9-a8f0-93368de201fa`

Engine: om-auto-create-pr (steps: 5, --loop: no)

## Progress
PR: #10154

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Establish evidence

- [x] 1.1 Open a full-suite draft PR and independently investigate current main failures. — 0ea43043c2

### Phase 2: Correct and verify

- [x] 2.1 Fix demonstrated root causes with regression coverage, preserving behavior when no defect is established. — 2fb9c77989, 787062c0e3
- [ ] 2.2 Run configured validation and verify all applicable workflows, including 15 integration shards, on the exact PR head.

### Phase 3: Review and finalize

- [ ] 3.1 Dispatch ONE final independent review task, validate its evidence and resolve actionable findings.
- [ ] 3.2 Publish evidence, finish tracking, promote the PR and apply automerge only after final-head CI is green.
