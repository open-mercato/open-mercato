# Stabilize main CI — 2026-11-22

## Goal
Verify main CI and correct demonstrated root causes on one stabilization PR into main.

## Scope
Inspect current main CI and release failures, preserve full-suite selection for stabilization branches and ci-full, fix only reproducible failures, and obtain an independent final review before applying automerge after all PR checks pass.

## Non-goals
No base-branch merge, weakening tests, unrelated product changes, dependency additions, or external official-module pointer changes.

## Implementation Plan
### Phase 1: Diagnosis and stabilization
1.1 Audit current main failures and full-suite coverage; delegate read-only snapshot diagnosis.
1.2 Implement demonstrated root-cause fixes with focused regression coverage, or document verified existing fixes when main is already green.
### Phase 2: Verification and review
2.1 Run the configured validation gate in order and the PR full suite; fix failures until green.
2.2 Dispatch one final independent review of the completed branch and address actionable findings.
2.3 Publish evidence, mark ready, and apply automerge only after verified green checks.

## Risks
Main currently has a passing 15-shard CI run (44955209511 at c98419720f18d2456cc8b9a00e7c55073c3559d2); historical failures may already be fixed. Current snapshot release 44955209558 remains in progress. Do not manufacture source changes for superseded failures. Local build resources and release publication permissions may constrain verification; report actual outcomes.

## Delegation
Subtask 1: read-only diagnosis of snapshot/release failures; no edits or external mutations.
Subtask 2: final independent review after implementation and validation; read-only, no merging.
Coupled implementation, regression tests, PR state, and validation remain in the parent.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnosis and stabilization

- [ ] 1.1 Audit current main failures and full-suite coverage
- [ ] 1.2 Implement demonstrated root-cause fixes with focused regression coverage

### Phase 2: Verification and review

- [ ] 2.1 Run configured validation and PR full suite
- [ ] 2.2 Obtain final independent review and address findings
- [ ] 2.3 Publish evidence and apply automerge after green checks
