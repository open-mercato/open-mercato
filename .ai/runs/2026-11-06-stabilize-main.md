# Stabilize main CI — 2026-11-06

## Goal
Restore green full-suite CI on a draft stabilization PR targeting main, then request automerge after independent review.

## Scope
Diagnose main's failed checks, fix verified root causes with regression coverage, and exercise all 15 integration shards on the stabilization PR. Existing ci-full/stabilize routing is reused unless evidence shows a defect.

## Non-goals
No feature work, base-branch merges, dependency upgrades unrelated to failures, or weakened checks.

## Implementation Plan
### Phase 1: Diagnose and repair
1.1 Independently inspect CI failures and identify root causes.
1.2 Apply minimal fixes and regression coverage.
### Phase 2: Verify and review
2.1 Run the configured validation gate and full PR CI, fixing remaining failures.
2.2 Dispatch one final independent review and resolve findings.
2.3 Finalize evidence and labels; request automerge only after green CI.

## Risks
CI can reveal additional failures after earlier gates pass. External runner availability may delay verification. No completion or automerge claim until actual checks are green.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose and repair

- [ ] 1.1 Independently inspect CI failures and identify root causes
- [ ] 1.2 Apply minimal fixes and regression coverage

### Phase 2: Verify and review

- [ ] 2.1 Run the configured validation gate and full PR CI, fixing remaining failures
- [ ] 2.2 Dispatch one final independent review and resolve findings
- [ ] 2.3 Finalize evidence and labels; request automerge only after green CI
