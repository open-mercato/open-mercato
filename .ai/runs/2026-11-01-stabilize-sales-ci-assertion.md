# Stabilize sales CI assertion after main CI recovery

## Goal
Remove the one timing-dependent assertion exposed by artifacts from the fully green CI recovery PR #8373.

## Scope
Latest main `94bb61610` includes the merged CI recovery and scheduler fix. Change only the sales integration assertion: an empty quote intentionally renders both toolbar and empty-state Add item actions. Wait for the quote empty state and assert a visible action exists without requiring uniqueness.

## Non-goals
No application behavior, API, dependency, retry, skip, or timeout changes.

## Implementation Plan
### Phase 1: Correct
1. Apply the artifact-backed assertion correction and run native standalone integration verification with retries disabled.
### Phase 2: Verify
1. Review the exact change and inspect current-head CI artifacts.
2. Record evidence and finalize the PR after all applicable checks pass.

## Risks
PR #8373 passed 31 checks, but one of 3,238 executed integration cases required a retry; this follow-up removes that root cause. The original PR was merged externally during local follow-up verification. Native local verification started against its production baseline; latest-main CI remains required.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Correct
- [ ] 1.1 Apply the artifact-backed assertion correction and run native standalone integration verification with retries disabled

### Phase 2: Verify
- [ ] 2.1 Review the exact change and inspect current-head CI artifacts
- [ ] 2.2 Record evidence and finalize the PR after all applicable checks pass
