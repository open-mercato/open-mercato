# Stabilize main — 2026-11-10 follow-up

## Goal
Restore green main validation through a reviewed stabilization PR into main, exercising the complete suite.

## Scope
Inspect main CI and snapshot runs at baseline `44b5ef4510be5f93d0600fc26474d40b71d72da7`. Repair demonstrated root causes with regression tests on `stabilize/main-2026-11-10-v2`. Existing `FORCE_FULL_SUITE` already supports same-repository stabilization branches and `ci-full`; preserve it. User explicitly authorizes CI workflow fixes and the final `automerge` label after green CI.

## Non-goals
No base-branch merges, release dispatches, package publication, dependency upgrades, unrelated product changes, or weakened tests.

## Implementation Plan
### Phase 1: Diagnose and fix
1.1 Audit main failures and repair demonstrated root causes with focused regression coverage. Delegate one independent read-only CI audit; implement coupled fixes in the parent.
### Phase 2: Validate
2.1 Run the configured validation gate and complete PR CI with every integration shard; fix failures until green.
### Phase 3: Review and finalize
3.1 Dispatch exactly one final independent review using `om-auto-review-pr`, address findings, and publish evidence. Do not merge unreviewed work.
3.2 Mark the completed draft ready and add `automerge` only after the full suite and review approve.

## Risks
Main's latest CI is green, but Main Snapshot Release has failing standalone integration tests. Snapshot publishing is outside scope; exercise relevant source and package-shape regressions without publishing. Full remote validation may take hours. Record local infrastructure blockers without reporting them as passes.

## Run identity
Claim-Run: 6e6ad2bd-2df1-4241-93c5-68ad83b64383
Runner: local (no running compose app found). TMPDIR=/tmp avoids this host's overlong tsx IPC socket path.
Engine: om-auto-create-pr (steps: 4, --loop: no)

## Progress

PR: #9176

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose and fix
- [x] 1.1 Audit main failures and repair demonstrated root causes with focused regression coverage — e0682b319

### Phase 2: Validate
- [ ] 2.1 Run the configured validation gate and complete PR CI with every integration shard

### Phase 3: Review and finalize
- [ ] 3.1 Complete the final independent review and publish evidence
- [ ] 3.2 Mark ready and add automerge after green full-suite CI and approval

Slot resolution: The original dated branch and plan belong to completed, merged PR #9125. This new run uses the `-v2` suffix and a separate plan to preserve that history. Latest main snapshot 42741422500 has new standalone integration failures.

## Diagnosis and evidence

Main snapshot 42741422500 reports 2973 passed, 152 skipped, and three TC-PORTAL-013 failures. Each fails before fixture setup because `process.env.OM_INTEGRATION_TEST` is undefined. Both standalone lanes put the flag into the app .env but omit it from the test-process environment. Their disposable Postgres service and fixture URL agree on mercato_test. Mirror the existing isolation flag into each Playwright step; retain the safety assertion. New workflow regressions fail on both original workflows and pass after the two-line fix. Focused workflow and full-scope tests: 36/36 pass. Dependency installation completed with native-build warnings; full gate outcomes are recorded separately.
