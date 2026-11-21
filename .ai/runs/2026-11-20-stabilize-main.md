# Stabilize main — 2026-11-20

## Goal

Fix demonstrated CI root causes on `stabilize/main-2026-11-20`, obtain a green full-suite PR into main, and apply `automerge` after independent review.

## Scope

Start from main at `6e47339a32d8bd41c7622c82f921ea2dbd47d998`. Inspect main and PR CI logs; make focused corrections with regression coverage. Existing trusted `stabilize/*` and `ci-full` selection already force full typecheck, unit tests and 15 integration shards. Reuse it.

Non-goals: merge into main, suppress tests, weaken assertions, change public contracts or production dependencies, change release behavior, or implement the draft phased-integration design.

## Implementation Plan

### Phase 1: Establish evidence

1.1 Inspect main failures and establish the full-suite draft PR.

### Phase 2: Correct and validate

2.1 Fix reproducible root causes with focused regression tests and incremental commits.
2.2 Run the configured validation gate and obtain passing full-suite CI on the PR head.

### Phase 3: Review and hand off

3.1 Dispatch one independent final review task and address actionable findings.
3.2 Publish verification evidence, complete tracking, promote the PR and apply automerge only after green CI.

## Evidence and outcomes

- Main's exact base `6e47339a32d8bd41c7622c82f921ea2dbd47d998` passed [full run 44625208409](https://github.com/open-mercato/open-mercato/actions/runs/44625208409), including all 15 shards, full tests and coverage merge.
- The historical main failure `44492039926` was a payment-reference precision browser timeout. Merged #9867 (`f0cdbcc7e6`, an ancestor of this base) already replaced the transient menu interaction with the existing row-click edit action. No new source correction was necessary.
- PR #10037 passed [full run 44635459873](https://github.com/open-mercato/open-mercato/actions/runs/44635459873) at `f8367c8cbf05e0a1479a054dc4b9dbd2eef88d5a`: all 15 integration shards, coverage merge, full units/typecheck, package builds, generation, app build, i18n sync/usage, lint, Docker, timezone and multi-instance checks. All exact-head workflows settled successfully or were conditionally skipped. Dependency audit was conditionally skipped, not executed.
- Validation source: hosted GitHub checks for every configured gate. Runner: local for the 45 focused routing/concurrency/coverage tests, all passing, independently rerun by reviewer and parent. Direct subprocess execution avoided a tool-shell contamination that initially invoked real Yarn inside five temporary test fixtures; no repository changes were needed. No complete local build gate is claimed.
- The ONE final independent reviewer task `a6f0626c-939f-4e15-ba86-a20b6a865340` approved exact head `f8367c8cbf` with no substantive findings. The parent read the report, checked its evidence, reran all 45 tests and verified the diff. [Authoritative review](https://github.com/open-mercato/open-mercato/pull/10037#issuecomment-7026170521). The reviewer made no changes; no child branch was merged.
- Accepted the review nit: title/category now describe documentation rather than implying a new source fix. No production code, workflow, dependency, schema, API or public contract changes were authored.
- The PR was promoted and `automerge` requested only after reviewed-head CI passed. This run does not merge into main; native checks and approval gates remain enforced, and the App cannot self-approve.

## Risks and final follow-up

This final tracking-only commit receives a fresh full CI run. Keep the PR body `Status: in-progress` and retain this run's claim until that exact head settles; publish its outcome on the PR without another source commit. If it fails, reopen completion, remove `automerge`, diagnose and fix the cause, and verify again. No earlier SHA is claimed as proof of the final head. Main can advance independently; this record names the verified base explicitly.

Engine: om-auto-create-pr (steps: 5, --loop: no)

## Progress
PR: #10037

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Establish evidence

- [x] 1.1 Inspect main failures and establish the full-suite draft PR. — a350cc7960

### Phase 2: Correct and validate

- [x] 2.1 Fix reproducible root causes with focused regression tests and incremental commits. — f8367c8cbf
- [x] 2.2 Run the configured validation gate and obtain passing full-suite CI on the PR head. — f8367c8cbf

### Phase 3: Review and hand off

- [x] 3.1 Dispatch one independent final review task and address actionable findings. — f8367c8cbf
- [x] 3.2 Publish verification evidence, complete tracking, promote the PR and apply automerge only after green CI. — f8367c8cbf
