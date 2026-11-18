# Main CI stabilization — 2026-11-18

## Goal

Verify the complete main CI suite on a dedicated stabilization PR, fix demonstrated root causes, and request automerge only after green checks and independent review.

## Scope

Branch: `stabilize/main-2026-11-18`, based on main `62a94b74a2b82927bf2182db65b8de6be35b02a5`.

The latest main CI run (44184339294) passed all 15 integration shards and other applicable jobs. Main Snapshot Release (44184339256) failed and needs diagnosis. Existing same-repository stabilization branches and `ci-full` already force all shards and unfiltered unit/type checks; preserve that implementation unless a defect is demonstrated.

The user explicitly authorizes this branch name, CI workflow fixes, sustained CI monitoring, and `automerge` after green CI. These override the skill's branch prefix and default no-wait reporting policy.

Non-goals: speculative changes, weaker tests, package publication, production changes, public contract changes, and merging into main.

## Implementation Plan

### Phase 1: Diagnose and repair

1.1 Independently audit main CI and snapshot failures, identify actionable root causes, and implement only necessary regression fixes.
1.2 Validate focused changes and document the evidence and any external blocker.

### Phase 2: Verify the stabilization PR

2.1 Run the configured validation gate where applicable and verify all 15 PR integration shards and every applicable check at the final code revision.
2.2 Dispatch one final independent review using `cez task create --kind review --review-of stabilize/main-2026-11-18`, verify its findings, and resolve actionable issues.
2.3 Publish verification evidence, complete the plan, promote the draft, and apply `automerge` only after the exact final head has green checks.

## Delegation

Two independent tasks maximum: a read-only audit of main's failed snapshot run, and one final independent review after implementation. Implementation and CI iteration stay together in this worktree because fixes and validation are coupled. Child reports are verified against logs, diffs, and tests; no unreviewed branch is merged.

## Resume — 2026-11-18 07:05 UTC

The previous driver `1d4370ec-a126-4a5b-81e7-83ef9ab4ea45` and its audit child were confirmed `done` by the cockpit. After the operator instructed autonomous continuation, run `be12e52a-1065-4a92-b06a-246763f05149` recovered the abandoned claim using the exact-SHA lease and acquired a fresh atomic lock; the recovery is documented on PR #9789. The earlier local autosave changed a generated registry incidentally; commit `15ce88baa0` restores the remote version, leaving no registry diff.

This resume delegates a read-only compiler compatibility audit (`0960ad2e-e334-47f5-9962-bc1d19af81d5`) and reserves its second and final child for the mandatory independent final review. Sales test synchronization and CI iteration remain coupled in the parent.

## Resume — 2026-11-18 11:48 UTC

After the operator instructed autonomous continuation, run `00c0c78e-f0f2-462c-bb65-3f1ff05c9efa` verified predecessor `be12e52a` and its compiler-audit child were done, documented recovery on PR #9789, released only its exact abandoned ref, and acquired lock `beb79b3ec626510bb09957da45533d44dcdb1fe4` with claim comment `6977674758`.

The latest main CI [44276181425](https://github.com/open-mercato/open-mercato/actions/runs/44276181425) passed all 15 shards, but the matching snapshot [44276181249](https://github.com/open-mercato/open-mercato/actions/runs/44276181249) still fails with the original TS2345 diagnostics at both engine lookups. Prior PR CI [44257204340](https://github.com/open-mercato/open-mercato/actions/runs/44257204340) passed all 15 shards and all applicable jobs at `28d27817bb`.

Main advanced and conflicted with the sales synchronization change. Merge `8c0aceb60c` keeps main PR #9744’s stronger `pickCustomer` retry helper exactly; sales has no remaining diff against main. Remaining scope is the two shared-engine type assertions, compiler regression, and this plan. Local focused regression passed (2 tests), and commit hooks passed translation sync and template parity. Dependency install completed with optional native-build warnings. Full current-head CI must pass again before automerge; one final independent review is reserved for this resume.

## Risks

- Release publication failures may depend on external services or permissions; never publish packages or modify credentials to test a hypothesis.
- Adding `ci-full` does not trigger CI itself; the stabilization branch already selects full coverage on opening and pushes.
- New commits invalidate previous green checks; inspect checks and workflow runs at the exact final SHA.

## Evidence

- Read-only audit task `50ab8f56-260b-4ede-bb7a-26f0704a3c0e` changed no files; no child branch was merged. Parent independently read the [failed snapshot job](https://github.com/open-mercato/open-mercato/actions/runs/44184339256/job/134406511123): publication succeeded, then standalone Next.js typechecking rejected `FilterQuery<NoInfer<T>>` in `engine.ts` at both ORM mutation lookups.
- The monorepo locks MikroORM 7.1.14; new apps permit `^7.1.14`. MikroORM 7.2.9 moved `NoInfer` outside the query conditional. Its November 12 publication crossed the scaffold's five-day age gate on November 17, matching the first build failures. The failed run retained no lockfile; its exact resolved version is inferred from the range, timing, declarations, and diagnostics.
- Fix `c1b90fcb04` derives the lookup query parameter from the installed `findOne<T>` signature in both methods. Public signatures, queries, persistence, and deletion behavior are unchanged. No dependency, cooldown, template, database, or API change.
- The regression extracts the actual two methods and compiles them with TypeScript 6.0.3 against both query-signature forms. Before the fix: legacy passes, modern fails with the two original TS2345 errors. After the fix: both pass. A separate isolated fixture with actual MikroORM 7.2.9 packages also reproduces the two errors before and zero after; this is compiler proof, not a claimed full standalone build or integration run.
- Runner: local (no configured compose app running). Immutable install completed with native optional-dependency build warnings. Focused regression: two tests passed. The configured eight-command gate is running in order. Commit hooks passed translation sync and template parity after using a short temporary directory for the local Unix-socket path limit.
- Standalone harness routing/knowledge contracts are unchanged; this implementation-only compatibility fix needs no new agent-harness knowledge case. Existing runtime coverage remains selected by the full PR suite.

- PR CI [44202285231](https://github.com/open-mercato/open-mercato/actions/runs/44202285231) passed 14 integration shards, package/type/unit checks and Docker builds. Shard 12 failed twice in `TC-SALES-8459` when changing to a customer without email. The trace shows the new customer was clicked at monotonic 651884ms but the original customer ID and email were submitted at 652057ms, before the picker committed its selected summary. Commit `44052d8dba` waits for the search control to be replaced by the chosen customer summary before Save. Existing assertions that sending is disabled immediately after save and after reload remain unchanged.

## Progress

PR: #9789

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose and repair

- [x] 1.1 Independently audit main CI and snapshot failures, identify actionable root causes, and implement only necessary regression fixes. — c1b90fcb04
- [x] 1.2 Validate focused changes and document the evidence and any external blocker. — c1b90fcb04

### Phase 2: Verify the stabilization PR

- [ ] 2.1 Run the configured validation gate where applicable and verify all 15 PR integration shards and every applicable check at the final code revision.
- [ ] 2.2 Dispatch one final independent review using `cez task create --kind review --review-of stabilize/main-2026-11-18`, verify its findings, and resolve actionable issues.
- [ ] 2.3 Publish verification evidence, complete the plan, promote the draft, and apply `automerge` only after the exact final head has green checks.
