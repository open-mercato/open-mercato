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

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Establish evidence
- [ ] 1.1 Verify full-suite routing and diagnose current main failures

### Phase 2: Correct failures
- [ ] 2.1 Implement minimal root-cause corrections and regression coverage

### Phase 3: Validate and review
- [ ] 3.1 Run the configured ordered validation gate and full PR CI
- [ ] 3.2 Complete final independent review and address findings
- [ ] 3.3 Publish evidence, promote the draft, and request automerge
