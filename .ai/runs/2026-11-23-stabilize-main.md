# Stabilize main CI — 2026-11-23

## Goal
Diagnose main CI failures, repair their root causes, and verify every full-suite PR check before adding `automerge`.

## Scope
Use `stabilize/main-2026-11-23` from main at d45d98f51a. Reuse the existing trusted `ci-full`/`stabilize/` full-suite selection. Limit fixes to evidenced CI failures and regression coverage.

Non-goals: merge into main, bypass checks, weaken assertions, change public contracts, apply local database migrations, or change unrelated product behavior.

## Implementation Plan

### Phase 1: Diagnose and repair
1.1 Inspect current and recent main failures; reproduce and fix any remaining root causes with regression coverage.
1.2 Verify the existing full-suite selector and run the configured validation gate using the local runner or exact CI evidence where local prerequisites block execution.

### Phase 2: Verify and review
2.1 Run all 15 integration shards and all other CI checks on this PR, correcting failures until green.
2.2 Dispatch one independent final review, address findings, record evidence, and apply automerge only after green CI and approval.

## Risks
Main continues moving; evidence is tied to this branch's exact head. Full CI can take an hour. Existing main failures may already be fixed; do not invent fixes. Local dependency/tool availability may require hosted CI for the configured gate. The user explicitly authorized stabilization branch naming, CI workflow fixes, draft PR creation, and CI monitoring through completion.

## Delegation
One independent read-only investigation of recent failure signatures; parent owns all coupled implementation and validation. One final independent review after implementation (maximum two child tasks).

## Findings and verification

- Initial main run [45078489783](https://github.com/open-mercato/open-mercato/actions/runs/45078489783) at d45d98f51a completed successfully: 24 successful jobs, all 15 integration shards green.
- The resumed audit also verified [main run 45121593376](https://github.com/open-mercato/open-mercato/actions/runs/45121593376) at 03269c5cf9: 24 successful jobs, all 15 integration shards and coverage merge green. No remaining source defect was demonstrated.
- Historical script failures in runs 45030798659 and 45030852346 came from the lesson index declaring 196 records when it contained 197. Main commit 05e09317c6 already corrected the count. The focused lesson-catalog regression passes locally (1/1).
- Historical TC-SALES-9594 timed out opening the payment edit menu in run 45030852346. It passes unchanged on main and this PR (6.1s in PR shard 12). The old failure remains a flake lead, not a demonstrated repaired defect or justification for speculative runtime changes.
- PR [full CI run 45081660684](https://github.com/open-mercato/open-mercato/actions/runs/45081660684), head 865e694eca, passed all 15 shards, coverage merge, full typecheck/units, build, lint, Docker and database-backed jobs. Other PR checks including CodeQL passed; audit and mutation jobs were skipped by their existing scope rules.
- Resumed PR [full CI run 45128754818](https://github.com/open-mercato/open-mercato/actions/runs/45128754818), head c37963279a, also passed all 15 shards and coverage merge (24 successful jobs). All exact-head workflows completed; PR checks reported 31 successes and four existing scope skips, with none pending or failed.
- Existing `FORCE_FULL_SUITE` at `.github/workflows/ci.yml:7` already recognizes trusted `stabilize/` branches and `ci-full`; logs confirm `FORCE_FULL_SUITE: true`. No duplicate workflow change is needed. Local CI selector/concurrency/coverage regression checks pass (45/45).
- This PR changes only this execution/evidence record. No source, API, database, dependency, or UI behavior changes were necessary.
- Runner: local (no running compose app). On resume, `node --test scripts/__tests__/ci-full-label.test.mjs scripts/__tests__/ci-concurrency.test.mjs scripts/__tests__/ci-merge-coverage.test.mjs scripts/__tests__/check-lessons.test.mjs` passed 50/50 tests. The diff was reread manually; no Markdown lint command is configured. This satisfies the authoring skill's documentation-only local gate.
- Prior local package build, generation, rebuild, i18n sync/usage and typecheck passed. Initial i18n/unit execution encountered the cockpit's long Unix socket path; a short task-specific TMPDIR and the workflow's loose Turbo environment resolved that prerequisite. A subsequent unit pass completed 50/51 tasks, with the remaining create-app fixture blocked by missing `unzip`. The retry after providing a task-local binary and the app build were interrupted when the predecessor stopped. They are not claimed as local passes. Hosted CI ran the configured build/generate/rebuild/i18n/typecheck/unit/app checks successfully.
- Final independent review task 8edc7b7c returned **approve**, with no findings, on c37963279a including the preserved predecessor commit. It independently executed all eight configured commands in order: package build, generation, package rebuild, i18n sync, i18n usage, typecheck, full units (51/51 tasks), and app build. Every command passed. The app build passed with two build threads and an enforced 4 GiB Node heap within the cockpit's 12 GiB task limit; earlier interrupted attempts remain recorded as non-passes. The reviewer left no tracked changes or validation processes. The driving run validated its report and reran the focused checks (50/50 pass).
- [Independent review and complete per-command evidence](https://github.com/open-mercato/open-mercato/pull/10411#pullrequestreview-6018055206). GitHub refused App self-approval, so the verdict is published as a COMMENT, not a host approval; host approval requirements are not bypassed. This final completion record changes documentation only. The driving run will verify its exact final head's full CI and record the `automerge` label application on the PR before reporting completion.

## Resume ownership

The first scheduled run stopped before final review and left its atomic claim active. After the operator instructed autonomous continuation, run 44df8750 recovered the exact stopped run's claim with an expected-SHA lease, acquired a fresh create-only claim, and retained the existing branch, PR, and documentation commits. The recovery is recorded in [PR comment 7093962169](https://github.com/open-mercato/open-mercato/pull/10411#issuecomment-7093962169). No duplicate PR or speculative source fix was created.

## Progress
PR: #10411

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose and repair

- [x] 1.1 Inspect current and recent main failures; reproduce and fix any remaining root causes with regression coverage. — 5920f232ec
- [x] 1.2 Verify the existing full-suite selector and run the configured validation gate using the local runner or exact CI evidence where local prerequisites block execution. — 5920f232ec

### Phase 2: Verify and review

- [x] 2.1 Run all 15 integration shards and all other CI checks on this PR, correcting failures until green. — 865e694eca
- [x] 2.2 Dispatch one independent final review, address findings, record evidence, and apply automerge only after green CI and approval. — c37963279a (independent approval and green full CI verified; final metadata-head CI and label confirmation recorded on the PR)
