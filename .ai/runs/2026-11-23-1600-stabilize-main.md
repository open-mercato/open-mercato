# Stabilize main CI — 2026-11-23 16:00

## Goal
Verify current main with the full PR suite, repair demonstrated root causes, obtain an independent final review, and apply automerge only with all checks green.

## Scope
Branch from main at 9f90793385. The earlier same-day stabilization PR #10411 already merged successfully; use a 1600 suffix to preserve that completed slot. Existing trusted stabilize/ and ci-full selection already runs full typechecking, all units and all 15 integration shards.

## Non-goals
No base merge, speculative fixes, production dependencies, database migrations applied locally, reduced coverage, or takeover of older active stabilization work.

## Implementation Plan
### Phase 1: Diagnose and fix
1.1 Inspect main CI and historical failures, distinguishing cancellation and already-fixed defects.
1.2 Repair demonstrated root causes with regression coverage; preserve existing full-suite selection.
### Phase 2: Verify and review
2.1 Run configured validation and full PR CI; correct failures until green.
2.2 Dispatch one independent final review, resolve findings, and apply automerge after green exact-head checks.

## Dispatch plan
A read-only CI evidence audit and one final independent review (maximum two subtasks). Root owns all coupled implementation and validation.

## Risks
Main moves frequently. Evidence must match this branch head. Local prerequisites may block the full local gate; record limits and use exact-head hosted CI evidence without implying unrun checks passed. If no defect remains, retain only the verification record rather than inventing source fixes.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose and fix

- [ ] 1.1 Inspect main CI and historical failures
- [ ] 1.2 Repair demonstrated root causes with regression coverage

### Phase 2: Verify and review

- [ ] 2.1 Run configured validation and full PR CI until green
- [ ] 2.2 Complete independent review and apply automerge
