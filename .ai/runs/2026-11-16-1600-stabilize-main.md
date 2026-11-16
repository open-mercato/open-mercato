# Stabilize main CI — 2026-11-16

## Goal
Verify main's current CI, fix demonstrated root causes on one stabilization branch, and enable automerge only after its full suite and independent review pass.

## Scope
Start from main at 126ffb6379. Use stabilize/main-2026-11-16-1600 targeting main. Existing FORCE_FULL_SUITE support already covers this branch and the ci-full label; preserve it. Investigate historical failures for unresolved regressions rather than duplicating fixes already merged.

## Non-goals
No unrelated product changes, skipped tests, reduced coverage, production changes, base-branch merges, or changes to external module pointers.

## Implementation Plan
### Phase 1: Establish evidence
1.1 Inspect main CI failures and distinguish fixed failures from current regressions. Delegate read-only historical triage independently.
1.2 Open a draft stabilization PR and verify it schedules all 15 shards.
### Phase 2: Correct and validate
2.1 Fix every demonstrated current CI root cause with regression coverage; retain existing behavior otherwise.
2.2 Run the configured validation gate in order and obtain green full-suite CI for the PR head.
### Phase 3: Independent review and handoff
3.1 Dispatch exactly one final cezar review using om-auto-review-pr and wait for its verdict; address findings.
3.2 Publish verification, release owned claims, promote the completed PR, and apply automerge only when all CI is green.

## Execution decisions
The requested date-only branch and plan already shipped in merged PR #9635. This 16:00 scheduled occurrence uses a time suffix to keep the completed record intact. During setup the old local branch was inadvertently republished unchanged; no old PR or base branch was modified. The mistaken local plan commit is excluded from this branch.

## Risks
Main moves while this isolated branch validates. Historical failures may already be fixed; no source edit is justified without evidence. Full CI takes longer than one interactive turn; monitoring must remain resumable. The existing older stabilization PR #9361 is a distinct run and will not be modified. Use at most two child tasks, reserving one for final review. Local dependencies are initially absent.

## Verification evidence
- Historical warranty failures in main runs 43810352873 and 43837075405 were corrected by e0e2d14319, an ancestor of this baseline. Parent confirmed that run 43844780162 passed every shard; the read-only child made no changes and its branch was not merged.
- First PR CI run 43892047090 scheduled all 15 integration shards at head 7f9c82b138; prepare, lint, DS lint and multi-instance checks passed. Remaining checks were still running when the new standalone failure was diagnosed.
- Main snapshot run 43872797962 failed only the standalone locale tooltip test (English/Korean failed; Polish/German flaky). Parent retrieved failed logs and both retry traces. In the Korean trace, hover targeted y=97 at time 2662042ms; the operation banner was absent in the input snapshot and inserted by the next assertion at 2662069ms, shifting the badge below the stationary pointer. English shows the same layout transition during hover. Translation labels/title assertions passed.
- A focused local Chromium/Radix reproduction inserts a banner between coordinate calculation and pointer dispatch, matching the stale target geometry in the trace. The original one-shot hover fails; polling the hover plus actual tooltip visibility passes; a deliberately hidden tooltip still fails. No assertion, locale or priority is removed, and the shared timeout is unchanged. This is a test-only interaction correction, with the real locale integration test updated as its regression coverage; no runtime component change or new public helper is needed.
- Runner: local for focused Chromium reproduction and diff checks. Configured gate and complete integration coverage will be verified on GitHub for the changed head.

## Progress

PR: #9694

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Establish evidence

- [x] 1.1 Inspect main CI failures and distinguish fixed failures from current regressions
- [x] 1.2 Open a draft stabilization PR and verify it schedules all 15 shards — 7f9c82b138

### Phase 2: Correct and validate

- [x] 2.1 Fix every demonstrated current CI root cause with regression coverage — 3eca32d5fd
- [ ] 2.2 Run the configured validation gate and obtain green full-suite CI

### Phase 3: Independent review and handoff

- [ ] 3.1 Obtain independent final review and address findings
- [ ] 3.2 Publish verification and apply automerge after all CI passes
