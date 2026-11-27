# Stabilize main — 2026-11-28

## Goal
Restore a passing full CI suite on a dedicated stabilization PR into main.

## Scope
Start at main beb07a9e963b705410cd051a065c53feed91244a. Diagnose current unit, timezone and integration failures; fix their causes with regression coverage. Use existing stabilize/ and ci-full full-suite selection. Open draft first, then promote to ready because draft CI deliberately skips the suite. Add automerge only after the exact PR head is green and independently reviewed.

## Non-goals
No merging into main, weakening checks, skipping failing coverage, unrelated refactoring, dependency additions, or production/database changes.

## Implementation Plan
### Phase 1: Diagnosis and repair
1.1 Investigate main CI failures and reproduce their causes.
1.2 Apply focused fixes and regression coverage.
### Phase 2: Validation and handoff
2.1 Run configured local validation and full PR CI; fix failures until green.
2.2 Obtain one final independent review, resolve findings, and label the green PR automerge.

## Delegation
One read-only child investigates unit/timezone logs while the parent handles integration diagnosis, PR setup and all edits. Reserve the second and final child for independent branch review; scopes do not overlap. Coupled implementation and CI repairs stay with the parent.

## Risks
The current main integration run is unfinished, so additional failures may emerge. Full CI may take over an hour. Draft PRs cannot run CI in this repository; initial draft will be marked ready to validate. Local capacity or missing services may block a command; record exact evidence and retain full hosted CI as a requirement.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnosis and repair

- [ ] 1.1 Investigate main CI failures and reproduce their causes.
- [ ] 1.2 Apply focused fixes and regression coverage.

### Phase 2: Validation and handoff

- [ ] 2.1 Run configured local validation and full PR CI; fix failures until green.
- [ ] 2.2 Obtain one final independent review, resolve findings, and label the green PR automerge.
