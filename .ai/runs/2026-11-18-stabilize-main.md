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

## Risks

- Release publication failures may depend on external services or permissions; never publish packages or modify credentials to test a hypothesis.
- Adding `ci-full` does not trigger CI itself; the stabilization branch already selects full coverage on opening and pushes.
- New commits invalidate previous green checks; inspect checks and workflow runs at the exact final SHA.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose and repair

- [ ] 1.1 Independently audit main CI and snapshot failures, identify actionable root causes, and implement only necessary regression fixes.
- [ ] 1.2 Validate focused changes and document the evidence and any external blocker.

### Phase 2: Verify the stabilization PR

- [ ] 2.1 Run the configured validation gate where applicable and verify all 15 PR integration shards and every applicable check at the final code revision.
- [ ] 2.2 Dispatch one final independent review using `cez task create --kind review --review-of stabilize/main-2026-11-18`, verify its findings, and resolve actionable issues.
- [ ] 2.3 Publish verification evidence, complete the plan, promote the draft, and apply `automerge` only after the exact final head has green checks.
