# Stabilize main CI

## Goal
Verify main CI and provide an explicit full-suite PR override.

## Scope
Add ci-full label handling to CI, with regression coverage. Latest main run 41653508026 passed all 15 integration shards and all other executed jobs; preceding runs were cancelled, not failed.

## Non-goals
No speculative product fixes, base-branch merges, or unrelated CI redesign.

## Implementation Plan
Phase 1: Add and test label-driven full integration scope, preserving existing selection.
Phase 2: Run validation and the full PR suite, fix any verified failures, then obtain one independent final review and apply automerge only after green checks.

## Risks
Full CI requires remote runners. Label additions must trigger CI without unrelated label changes cancelling active suites.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Full-suite override

- [ ] 1.1 Add ci-full override and regression tests

### Phase 2: Verification

- [ ] 2.1 Run validation and full PR CI; repair verified failures
- [ ] 2.2 Obtain independent final review and finalize green PR
