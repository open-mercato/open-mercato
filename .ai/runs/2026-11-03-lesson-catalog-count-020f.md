# Correct the lesson catalog count

## Goal

Make the catalog declaration match the focused lesson records after concurrent lesson additions merged.

## Scope

Only `.ai/lessons.md` metadata and this portable execution plan. No lesson records, code, dependencies, hooks, CI, contracts, or application changes.

## Implementation Plan

### Phase 1: Correct and verify

1. Reproduce the catalog mismatch, count records, and correct the declaration.
2. Run the existing lesson checker and its regression suite; inspect the exact diff and current base/merge tree.

### Phase 2: Review and handoff

1. Publish verification evidence, complete the authoritative review, and hand off a ready PR without merging.

## Risks

Another lesson addition can advance the base; recheck the candidate merged tree before handoff.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Correct and verify

- [x] 1.1 Reproduce the catalog mismatch, count records, and correct the declaration — a393169107
- [x] 1.2 Run existing checks and inspect the exact diff and current base/merge tree

### Phase 2: Review and handoff

- [ ] 2.1 Publish evidence, complete authoritative review, and hand off a ready PR
