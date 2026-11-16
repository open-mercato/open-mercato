# Stabilize main CI — 2026-11-16

## Goal
Verify main's current CI, fix demonstrated root causes on one stabilization branch, and enable automerge only after its full suite and independent review pass.

## Scope
Start from main at 126ffb6379. Use stabilize/main-2026-11-16-1600 targeting main. Existing FORCE_FULL_SUITE support already covers this branch and the ci-full label; preserve it. Investigate historical failures for unresolved regressions rather than duplicating fixes already merged.

## Non-goals
No unrelated product changes, skipped tests, reduced coverage, production changes, base-branch merges, or changes to external module pointers.

## Implementation Plan
### Phase 1: Establish evidence
1.1 Inspect main CI failures and distinguish fixed failures from current regressions. Delegate read-only historical triage independently.
1.2 Open a draft stabilization PR and verify it schedules all 15 shards.
### Phase 2: Correct and validate
2.1 Fix every demonstrated current CI root cause with regression coverage; retain existing behavior otherwise.
2.2 Run the configured validation gate in order and obtain green full-suite CI for the PR head.
### Phase 3: Independent review and handoff
3.1 Dispatch exactly one final cezar review using om-auto-review-pr and wait for its verdict; address findings.
3.2 Publish verification, release owned claims, promote the completed PR, and apply automerge only when all CI is green.

## Execution decisions
The requested date-only branch and plan already shipped in merged PR #9635. This 16:00 scheduled occurrence uses a time suffix to keep the completed record intact. During setup the old local branch was inadvertently republished unchanged; no old PR or base branch was modified. The mistaken local plan commit is excluded from this branch.

## Risks
Main moves while this isolated branch validates. Historical failures may already be fixed; no source edit is justified without evidence. Full CI takes longer than one interactive turn; monitoring must remain resumable. The existing older stabilization PR #9361 is a distinct run and will not be modified. Use at most two child tasks, reserving one for final review. Local dependencies are initially absent.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Establish evidence

- [ ] 1.1 Inspect main CI failures and distinguish fixed failures from current regressions
- [ ] 1.2 Open a draft stabilization PR and verify it schedules all 15 shards

### Phase 2: Correct and validate

- [ ] 2.1 Fix every demonstrated current CI root cause with regression coverage
- [ ] 2.2 Run the configured validation gate and obtain green full-suite CI

### Phase 3: Independent review and handoff

- [ ] 3.1 Obtain independent final review and address findings
- [ ] 3.2 Publish verification and apply automerge after all CI passes
