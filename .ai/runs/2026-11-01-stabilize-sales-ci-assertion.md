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

## Verification evidence

Source commit `54bac6f13` passed CI run [41295808156](https://github.com/open-mercato/open-mercato/actions/runs/41295808156): 16 successful checks, five policy skips after review settled, including the affected sales suite. Its artifacts report 303 expected, five skipped, zero unexpected and one retried TC-SALES-001 quantity assertion. All four TC-SALES-7782 cases passed on their first attempt. The separate retry persisted quantity one instead of two; failed-attempt traces are unavailable and source inspection found no supported deterministic correction, so no speculative production/helper change ships.

Authoritative [review](https://github.com/open-mercato/open-mercato/pull/8391#pullrequestreview-5727650333) found no blocking issues. Latest main `94bb61610` also passed its full [31-check CI run](https://github.com/open-mercato/open-mercato/actions/runs/41293328876). The prior recovery run passed the configured full Linux validation gate and all 15 shards. Local standalone verification completed cold install and both activation builds but stalled at the ephemeral-launcher handoff after app readiness; it is not recorded as passing. No retries, skips or timeouts were added to tests.

## Progress

PR: #8391

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Correct
- [x] 1.1 Apply the artifact-backed assertion correction and run native standalone integration verification with retries disabled — 54bac6f13 (CI four first-attempt passes; local launcher limitation above)

### Phase 2: Verify
- [x] 2.1 Review the exact change and inspect current-head CI artifacts — 54bac6f13; review and artifact links above
- [x] 2.2 Record evidence and finalize the PR after all applicable checks pass — evidence recorded here; final metadata-only head is checked before ready promotion
