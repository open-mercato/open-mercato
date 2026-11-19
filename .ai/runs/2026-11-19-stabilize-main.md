# Stabilize main CI — 2026-11-19

## Goal
Restore a green full-suite CI run in a PR from `stabilize/main-2026-11-19` into `main`, then request automerge after independent review and exact-head CI pass.

## Scope
Diagnose main failures, correct their root causes without weakening assertions or increasing timeouts, and verify all 15 integration shards plus the full hosted validation gate. Existing same-repository `stabilize/` and `ci-full` routing already selects full coverage. Initial base: `7313a0fe67b41d9029d8700529a23f0f76b4ce03`; merged reviewed main `b7b5309cccd7b2b292ab49bfb1e52b7e84c9e43d` to resolve the newly added payment test's add/add conflict.

## Non-goals
No merge into main, production behavior change, contract redesign, weakened assertions, skipped failing tests, increased timeouts, new dependencies or external submodule pointer updates.

## Implementation Plan
### Phase 1: Establish evidence
1.1 Verify full-suite routing and diagnose current main failures. Keep coupled fixes with the parent and use independent read-only analysis.
### Phase 2: Correct failures
2.1 Implement minimal root-cause corrections and regression coverage; validate and commit incrementally.
### Phase 3: Validate and review
3.1 Run the configured ordered validation gate and full PR CI; correct failures until green.
3.2 Complete the one final independent review and address findings; resume that same reviewer for follow-up changes.
3.3 Publish evidence, promote the draft, and request automerge only after green reviewed-head CI.

## Evidence and outcomes
- **Role cancellation:** main run `44409579981` showed EN/PL tests waiting for nonexistent Confirm/Potwierdź. Corrected to shipped Discard changes/Odrzuć zmiany, retaining duplicate refusal, save, persistence, cancellation, tenant-isolation and denied-write assertions. The identical correction independently reached main via #9715 and is absent from the final diff.
- **CRM setup budget:** trace showed redundant login/dashboard navigation consuming approximately five seconds before companies navigation. The first hook-only relocation was rejected because Playwright hooks share the test timeout. Replaced duplicate authentication/dashboard navigation with existing `authenticateCrm` API-session/browser-cookie setup. Preserved Warsaw clock, exact DST boundary fixtures, inclusion/exclusion, serialized filters, editor/operator/date, screenshot, reload and cleanup assertions and the global 20-second budget.
- **Payment edit:** main added `TC-SALES-PRECISION-003` in #7324 while this run was active. Full run `44483474581` at `8137cfb737` failed only shard 12: both attempts timed out after the Edit payment menu detached before interaction. Replaced the two transient menu clicks with the existing row-click edit action; both invoke the same `openEditPayment` callback. Strict 18-decimal amount equality, UI reference edit, successful PUT, persisted reference and fixture cleanup remain unchanged. The sole main merge conflict was add/add of that test; resolution preserves only this correction.
- **Independent review:** the ONE final reviewer task `749eae35` approved `d8b748da66ed4724932628949c6a1a7b41e59f13` after inspecting the full five-file diff, retry trace, callback equivalence and merge resolution. No findings remain. The parent independently verified the report, diff and routing checks. The author App cannot submit native self-approval; the independent report is published on the PR and does not bypass branch policy.
- **Full execution:** hosted run `44488699387` passed all 15 integration shards, coverage merge, full unit/type checks, package builds, generation, app build, i18n sync/usage, lint, Docker, timezone and multi-instance gates. All other exact-head workflows/checks passed or were conditionally skipped by scope. Corrected payment case passed first attempt in 6.8 seconds; shard 12 reports 261 passed, zero failed/flaky.
- **Validation source:** GitHub checks under the repo-local checks-first override, with per-command evidence on the PR. An earlier local gate passed its first five commands and was interrupted at typecheck; no complete local gate is claimed. Narrow local routing checks passed 25/25 and diff whitespace checks passed. No production, schema, API, dependency, workflow or generated-file changes are authored by this task.

## Ownership recovery
Run `9f3dec20-230d-4276-9dcb-1204507921dd` continued under the operator's explicit autonomous continuation instruction after the prior ownership blocker was reported. Prior run `c982e976` and both workers were confirmed stopped. Its abandoned lock `43f51884` was released with its exact-SHA lease and replaced by create-only claim `95845bf8`; authorization, prior owner and claims are recorded on PR #9867. No human assignees changed.

## Risks and handoff
Main changes frequently; evidence belongs to exact SHAs. New failures reopened completion and removed `automerge` until corrected and re-reviewed. No existing skip or unrelated retry is claimed repaired. The completion-tracking commit receives its own full CI run; publish that final exact-head result in the PR evidence without another source commit, then release this run's claim. The PR is ready and `automerge` requested after reviewed-head CI passed; actual merging remains subject to CI and review policy. This task performs no merge into main.

## Progress
PR: #9867

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Establish evidence
- [x] 1.1 Verify full-suite routing and diagnose current main failures — 855f5ab405

### Phase 2: Correct failures
- [x] 2.1 Implement minimal root-cause corrections and regression coverage — f7fdfd527c, e6dfa25d17, 7a59ef3220

### Phase 3: Validate and review
- [x] 3.1 Run the configured ordered validation gate and full PR CI — d8b748da66 (hosted full run 44488699387)
- [x] 3.2 Complete final independent review and address findings — d8b748da66 (same final reviewer 749eae35 APPROVE)
- [x] 3.3 Publish evidence, promote the draft, and request automerge — d8b748da66 (green reviewed head; tracker actions verified)
