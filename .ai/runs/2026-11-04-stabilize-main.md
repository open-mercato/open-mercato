# Stabilize main — 2026-11-04

## Goal
Verify main CI on a dedicated full-suite PR and fix demonstrated root causes.

## Scope
CI failures and their minimal regression fixes, if reproduced. Main at 159653827ac5226365c88d08de1d0d555baee51b already has two successful CI runs and ci-full label routing. Preserve existing behavior when no defect is demonstrated.

## Non-goals
No speculative fixes, production changes, dependency upgrades, or merge into main.

## Implementation Plan
### Phase 1: Diagnose
1.1 Audit main run jobs and historical failures independently; confirm full-suite routing.
### Phase 2: Verify
2.1 Run all 15 integration shards on this PR, resolve any failures, and record evidence.
### Phase 3: Review
3.1 Obtain an independent final review and add automerge only after green CI.

## Risks
CI infrastructure failures may require reruns. No application code changes are warranted if the current head remains green. This documentation-only run uses remote full CI as evidence rather than duplicating application builds locally.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose
- [ ] 1.1 Audit main run jobs and historical failures independently; confirm full-suite routing.

### Phase 2: Verify
- [ ] 2.1 Run all 15 integration shards on this PR, resolve any failures, and record evidence.

### Phase 3: Review
- [ ] 3.1 Obtain an independent final review and add automerge only after green CI.
