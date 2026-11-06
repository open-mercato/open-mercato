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
PR: #8904

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose and repair

- [x] 1.1 Independently inspect CI failures and identify root causes
- [x] 1.2 Apply minimal fixes and regression coverage

### Phase 2: Verify and review

- [x] 2.1 Run the configured validation gate and full PR CI, fixing remaining failures
- [ ] 2.2 Dispatch one final independent review and resolve findings
- [ ] 2.3 Finalize evidence and labels; request automerge only after green CI

## Slot decision
Today's original stabilization branch shipped as PR #8841 and merged at 09:07 UTC. This subsequent scheduled run uses the v2 suffix and a separate plan to preserve that completed run's evidence.

## Verification evidence
- Main run [42200594911](https://github.com/open-mercato/open-mercato/actions/runs/42200594911) failed only OMH-241: a stale three-file publication-context assertion observed the six-file canonical context. Main commit c9f31972a already fixes the assertion and checks both required and optional context for accidental discovery-skill coupling. No additional source fix is justified.
- Independent read-only task 68b76364-f299-47ea-aea4-5d7cfa2a9bd0 found no additional verified failures. Parent confirmed its zero-file diff and inspected completed unit-job 127861788867: OMH-241 passes and all 51 tasks succeed.
- Newer main run [42206594485](https://github.com/open-mercato/open-mercato/actions/runs/42206594485) passed the full suite, including all 15 integration shards.
- PR head 135fe0d313300f0214cbc561ff62550f53ccf5f5 passed [full CI 42210118125](https://github.com/open-mercato/open-mercato/actions/runs/42210118125), including all 15 integration shards, unit tests, timezone tests, multi-instance documents, lint, package/app builds, and Docker build. No failing or pending PR checks remained at 2026-11-06T12:08Z.
- Local runner: package build, generate, second package build, translation sync/usage, typecheck, and production app build passed. Initial tsx invocations exceeded the host Unix socket path limit; translation checks passed with a short TMPDIR. Unit retry using short TMPDIR/TEMP/TMP and TURBO_ENV_MODE=loose passed 50/51 tasks; create-app's containment fixture and session-share ZIP subprocess failed locally while this PR's CI unit job passed. These local failures are disclosed, not treated as green. Optional native dependency builds warned during install.
- Existing same-repository stabilize/* and ci-full workflow routing already forces all 15 shards and full validation. No workflow change, contract change, or product change was needed.
- The final independent review and final-head CI still gate readiness and automerge.
