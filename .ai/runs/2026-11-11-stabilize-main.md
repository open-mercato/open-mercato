# Stabilize main on 2026-11-11

## Goal
Verify main through a dedicated full-suite stabilization PR, fix evidenced failures, obtain independent review, and apply automerge after successful checks.

## Scope
Use branch `stabilize/main-2026-11-11` from `origin/main` at `592356afda0cb06e95fcf6d7c8365b1d39000633`. Inspect CI evidence and preserve the existing full-suite selection for same-repository stabilization branches and ci-full PRs. Correct contributor guidance that contradicts the current workflow.

## Non-goals
Product features, dependency upgrades, release automation, and merging the PR are outside this run.

## Implementation Plan

### Phase 1: Diagnose and prepare
1.1 Independently audit main CI and full-suite selection through a read-only cezar task.
1.2 Correct evidenced CI defects or stale stabilization instructions with focused verification.

### Phase 2: Validate and review
2.1 Run the configured validation gate and the stabilization PR full suite, resolving failures at their source.
2.2 Dispatch one final independent review task, validate its evidence, and address actionable findings.
2.3 Publish verification evidence, promote the completed PR, and apply automerge after green CI.

## Risks
Main already has a successful full-suite run, so further code fixes depend on new failure evidence. Local dependency availability and service requirements may limit local validation. Label changes do not schedule CI, so full-suite selection relies on the branch convention at PR creation. The final review is the second and final delegated task.

## Evidence
Latest main CI https://github.com/open-mercato/open-mercato/actions/runs/42905776855 succeeded with all 15 integration shards. The existing workflow includes ci-full handling, while CONTRIBUTING.md incorrectly says the label has no effect. This small corrective run uses the existing stabilization behavior.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose and prepare

- [ ] 1.1 Independently audit main CI and full-suite selection through a read-only cezar task
- [ ] 1.2 Correct evidenced CI defects or stale stabilization instructions with focused verification

### Phase 2: Validate and review

- [ ] 2.1 Run the configured validation gate and the stabilization PR full suite, resolving failures at their source
- [ ] 2.2 Dispatch one final independent review task, validate its evidence, and address actionable findings
- [ ] 2.3 Publish verification evidence, promote the completed PR, and apply automerge after green CI
