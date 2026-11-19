# Stabilize main CI — 2026-11-19

## Goal
Restore a green full-suite CI run in a draft PR from `stabilize/main-2026-11-19` into `main`, then request automerge only after independent review and exact-head CI pass.

## Scope
Diagnose current main failures, fix their root causes with regression coverage, and verify all 15 integration shards plus other applicable checks. Existing `ci-full` and same-repository `stabilize/` selection are already present; preserve their guardrails. Base: `7313a0fe67b41d9029d8700529a23f0f76b4ce03`.

## Non-goals
No merge into main, contract redesign, weakened assertions, skipped failing tests, production changes, new dependencies or external submodule pointer updates.

## Implementation Plan
### Phase 1: Establish evidence
1.1 Verify full-suite routing and diagnose current main failures. Delegate read-only CI failure inventory independently; keep coupled fixes with the parent.
### Phase 2: Correct failures
2.1 Implement minimal root-cause corrections and regression coverage; validate and commit incrementally.
### Phase 3: Validate and review
3.1 Run the configured ordered validation gate and full PR CI; correct failures until green.
3.2 Dispatch one final independent review using `cez task create --kind review --review-of stabilize/main-2026-11-19`; resolve findings and wait for approval before reporting completion.
3.3 Publish evidence, promote the draft, and add `automerge` only with green exact-head checks and approval.

## Risks
Main changes frequently; evidence belongs to exact SHAs. Existing stabilization PRs are independently owned and must not be modified. Further failures can expand the correction phase, but every fix stays on this branch. Hosted integration runs may take longer than a single session; retain resumable state. Do not infer success from skipped jobs or pending workflows.

## Ownership recovery
The operator instructed run `9f3dec20-230d-4276-9dcb-1204507921dd` to continue autonomously after the claim blocker was reported. The original run `c982e976` and both workers were confirmed stopped. The abandoned atomic lock `43f51884` was released with its exact-SHA lease and replaced with a fresh create-only claim `95845bf8`, with the prior owner and authorization recorded on PR #9867. No human assignees were changed.

## Evidence
Main run `44409579981`, shard 3: the EN/PL role-validation trace shows cancellation opens an alertdialog with `Discard changes` / `Odrzuć zmiany`; the test instead waits for `Confirm` / `Potwierdź` until the 20-second limit. Corrected the test locators while retaining duplicate-error, successful persistence, cancellation, tenant isolation and denied-write assertions. The independent inventory also confirmed shard 7 exhausts its whole-test budget after ~5s login navigation and ~8s companies navigation before screenshot/reload assertions. The final independent review rejected hook-only relocation (dd04253468): Playwright beforeEach shares the same test timeout. Replaced it with existing `authenticateCrm`, which obtains the API session and installs scoped browser cookies without navigating to `/backend`; the test navigates directly to companies. This removes the measured ~5s redundant dashboard navigation and duplicate login while retaining the 20-second limit and all assertions. The corrected code at `6c2ddd77d8e192a6c1540d6c1fb8766887cd6312` passed full hosted CI run `44429737286`, including all 15 shards. A fresh independent re-review remains pending. Existing workflow routing passed all 25 executable checks. Full hosted run `44418908173` passed all 15 integration shards, unfiltered unit/type checks, Docker build, multi-instance and timezone jobs before the additional CRM correction; the corrected head also passed the later full run above. Validation source: GitHub checks under the repo-local `om-auto-review-pr` checks-first override. Hosted prepare/test jobs cover both package builds, generation, i18n sync and usage, full typechecking, the full unit suite, and the app build. The prior local attempt completed its first five commands, then was interrupted at typecheck; it is not claimed as a complete local gate. Local runner selected for standalone routing checks (25/25 passed).

## Progress
PR: #9867

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Establish evidence
- [x] 1.1 Verify full-suite routing and diagnose current main failures

### Phase 2: Correct failures
- [x] 2.1 Implement minimal root-cause corrections and regression coverage — f7fdfd527c

### Phase 3: Validate and review
- [x] 3.1 Run the configured ordered validation gate and full PR CI — 6c2ddd77d8 (hosted run 44429737286; checks-first override)
- [ ] 3.2 Complete final independent review and address findings
- [ ] 3.3 Publish evidence, promote the draft, and request automerge
