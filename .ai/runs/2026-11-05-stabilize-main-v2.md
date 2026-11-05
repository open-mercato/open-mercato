# Stabilize main CI

## Goal
Restore green full-suite CI on a dedicated draft PR against main.

## Scope
Diagnose main run 42050421442, fix proven causes, support ci-full label scope, and verify all PR checks. Existing dated branch belongs to merged PR #8739; use a v2 branch without rewriting it.

## Non-goals
No unrelated refactors, skipped checks, production changes, or merges into main.

## Implementation Plan
Phase 1: Diagnose build failures and implement root-cause fixes with regression coverage. Independently delegate read-only diagnosis; keep workflow and code edits coordinated here.
Phase 2: Run configured validation and full PR CI, repair any remaining failures, then dispatch one final independent review and resolve findings.
Phase 3: Record evidence, release claims, promote ready and add automerge only after green checks and approved review.

## Risks
Full CI can expose additional failures after prepare succeeds. No local dependencies installed initially. ci-full applies on next scheduled PR event, avoiding label-only skipped check replacement.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Repair
- [ ] 1.1 Diagnose main failures and fix root causes with regression coverage
- [ ] 1.2 Support ci-full full-suite selection with regression tests

### Phase 2: Verify
- [ ] 2.1 Pass configured validation and all full-suite PR checks
- [ ] 2.2 Obtain independent final review and address findings

### Phase 3: Handoff
- [ ] 3.1 Record evidence and mark green reviewed PR ready with automerge
