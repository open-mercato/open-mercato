# Stabilize main CI — 2026-11-24

## Goal
Make the stabilization PR's complete CI suite green, fix demonstrated root causes, and add `automerge` only after green checks and independent review.

## Scope
Start from main and collect CI fixes on `stabilize/main-2026-11-24`. Existing `FORCE_FULL_SUITE` already selects all 15 shards and unscoped validation for same-repository stabilization branches or `ci-full` PRs. Preserve those controls and PR-specific concurrency.

## Non-goals
No weakening tests, bypassing security or QA gates, publishing previews, merging main, production operations, or unrelated refactors.

## Implementation Plan
### Phase 1: Diagnose and establish full-suite PR
1.1 Inspect latest main failures and independently investigate shard failures; open draft PR with full scope.
### Phase 2: Fix demonstrated root causes
2.1 Reproduce failures, implement minimal fixes with regression coverage, and run targeted checks.
### Phase 3: Validate and review
3.1 Run configured local gate and the PR's full remote suite; repair until green.
3.2 Dispatch one final independent review, resolve actionable findings, publish evidence, and add automerge after green.

## Validation
Configured ordered gate: build:packages, generate, build:packages, i18n:check-sync, i18n:check-usage, typecheck, test, build:app. Choose Docker/local runner by repository probe. Remote verification requires exact-head workflow completion and all 15 shards.

## Risks
Main's latest run is pending; historical failures may already be fixed. Manual preview dispatches for a fork fail a deliberate same-repository security gate and must not be made green by relaxing it. Runner queues may delay evidence. At most two children total: one independent read-only failure investigation, one final review. The root owns all coupled fixes and validation.

## Diagnosis
Historical main runs 45257515706 and 45212804817 failed only `TC-SALES-9594` on shard 12. Artifacts show missing action menus or lost focus during organization initialization; a separate retry passed both locale assertions and then exceeded the shared 20-second test budget during cleanup. Snapshot run 45257515989 independently shows the same UI failure. The exact component unmount mechanism is inferred from overlapping organization requests and disappearing menus, not instrumented.

PR #10286 already proposes waiting for the fixture organization to be ready. Preserve that candidate while addressing the separate teardown-budget defect here; do not change or take over that claimed PR. No application behavior, timeout policy, assertion, permission check, or cleanup success check is relaxed.

Independent read-only child 484724b6 inspected logs and artifacts, made no changes, and started no tests/processes. Its evidence was checked against the same test and snapshot trace; no branch merge is needed.

The first PR full-suite run 45287501078 passed every runnable job, including all 15 shards. Historical failures remain intermittent because the relevant source is unchanged. Local full-unit attempt failed only at the cockpit temporary Unix socket path limit; repeat with TMPDIR/TMP/TEMP=/tmp and TURBO_ENV_MODE=loose to propagate it through Turbo.

## Resume — 2026-11-24 07:00 UTC
Operator requested autonomous continuation after the duplicate-slot stop. The previous run `0abc1206-8cb5-45bd-bf87-6c2109497aac` and its investigation child are marked done; no matching processes remain. This is an intentional recovery equivalent to `--force`: the takeover comment preserves prior claim 7116795833 and lock 10397641af13d8a1dd915aafd9db6453018fb9a8, then the exact-SHA lease release and create-only acquisition establish new run `f1a55e82-9590-4187-9d0e-adf596a90a99`, lock 3a23b2702c1f08bae6c5afbfc0546b8eb3af6e61. Existing human assignees and unrelated PRs are untouched.

The previous run autosaved the test-only repair in 7c999c0f90; preserve that commit and validate it rather than rewriting history. Latest main CI 45338224448 also passed. Runner: local (no configured/running compose app). A read-only investigation child checks the historical failure classification while the root owns the coupled repair and validation; one final review child follows all implementation work. No extra workflow changes are needed: existing `ci-full` and `stabilize/` handling already force all 15 shards.

## Resume — 2026-11-24 15:00 UTC
The operator authorized autonomous continuation after the ownership conflict. The cockpit marks previous owner `f1a55e82` and its child done, with no corresponding processes remaining. Recovery comment 7135457087 records the prior lock/comment; exact-SHA release and create-only acquisition established run `a55cdf02-d6b4-45be-a805-25f68e63c7c2`, claim comment 7135471743, lock `43da399942271fbcfae16a08907067f957e548d4`.

The exact-head full suite [45345851906](https://github.com/open-mercato/open-mercato/actions/runs/45345851906) passed at `1b6503a20290ab7a1d52499b4eba48e16929d4f7`, including all 15 integration shards, unfiltered typecheck/units, builds, lint, timezone and document multi-instance checks. No workflow edits are needed; full-suite support is already present on main.

Runner: local. The first ordered local gate passed commands 1–6; its 15-minute process limit expired during `yarn test` after 50 tasks succeeded, including 2,987 core suites and 415 enterprise suites. One create-app session-share fixture failed because this host lacked Info-ZIP `unzip`. A user-local copy of Ubuntu's `unzip` package supplies the documented prerequisite without repository changes; the exact failing fixture now passes. The ordered gate is rerunning with a 40-minute per-command limit and unchanged repository test timeouts. An optional 90-second Playwright discovery probe returned no output before timing out; the remote full suite supplies integration evidence. Final independent review and exact-final-head CI still gate completion.

## Verification outcome — 2026-11-24
Both the authoring run and the single final independent reviewer passed every configured command in order: package build, generation, package rebuild, translation sync/usage, typecheck, full units, and app build. Unit verification completed 51/51 Turbo tasks; core passed 2,987 suites / 31,262 tests, enterprise passed 415 suites / 4,735 tests, and create-app passed 1,269 tests. The reviewer also passed template synchronization. No source changes or commits came from the review, and none were merged.

Independent task `f39f17e5` approved exact source head `44974cfe126945b96973d6f8a1a323105343ed32` with no actionable findings. Its first turn settled before app-build completion; the same task resumed and completed the missing command before issuing the accepted final verdict. All 33 existing assertions remain, plus the readiness assertion. Playwright lifecycle inspection confirmed the fresh bounded teardown budget and cleanup before request disposal.

The [independent review evidence](https://github.com/open-mercato/open-mercato/pull/10492#pullrequestreview-6043342046) is a COMMENT review because GitHub rejects self-approval by the authoring App. It does not satisfy or waive any host-required approval. [Authoring validation evidence](https://github.com/open-mercato/open-mercato/pull/10492#issuecomment-7137228913) records the local prerequisite repair and complete gate.

[Full CI run 45430165932](https://github.com/open-mercato/open-mercato/actions/runs/45430165932) completed successfully at the reviewed head, with all 15 integration shards, coverage rollup, and every runnable check green. The other exact-head workflows also completed successfully or were intentionally skipped. Only after verifying those results was `automerge` applied. Main's [full run 45414811626](https://github.com/open-mercato/open-mercato/actions/runs/45414811626) also passed at `7cabd0dd73`.

This final documentation checkpoint changes no executable file. The authoring run keeps the PR draft and its claim while the checkpoint's newly triggered full suite runs; the existing `automerge` label never waives checks, the draft state, ownership, or GitHub approval rules. Final exact-head CI evidence and claim release are published on the PR without another source change.

## Progress
PR: #10492

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose and establish full-suite PR
- [x] 1.1 Inspect latest main failures and independently investigate shard failures; open draft PR with full scope. — 728a368d4f

### Phase 2: Fix demonstrated root causes
- [x] 2.1 Reproduce failures, implement minimal fixes with regression coverage, and run targeted checks. — 7c999c0f90

### Phase 3: Validate and review
- [x] 3.1 Run configured local gate and the PR's full remote suite; repair until green. — 44974cfe12
- [x] 3.2 Dispatch one final independent review, resolve actionable findings, publish evidence, and add automerge after green. — 44974cfe12
