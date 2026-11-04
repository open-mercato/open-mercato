# Stabilize main — follow-up scheduled run

## Goal
Diagnose current main CI and obtain green full-suite PR evidence for minimal root-cause fixes.

## Scope
Audit current CI runs, fix demonstrated failures, and exercise all 15 shards using the existing ci-full override.

## Non-goals
No speculative changes, production changes, or merging into main. The requested branch name belongs to already-merged PR #8657, so use stabilize/main-2026-11-04-v2 without rewriting its history.

## Implementation Plan
### Phase 1: Diagnose
1.1 Independently audit main failures and verify full-suite routing.
### Phase 2: Stabilize
2.1 Fix demonstrated root causes and run full PR CI.
### Phase 3: Review
3.1 Dispatch one final independent review and apply automerge only when green.

## Risks
Hosted runner queues may delay full-suite evidence. Current latest main CI is pending; do not infer defects from incomplete runs.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose
- [ ] 1.1 Independently audit main failures and verify full-suite routing.

### Phase 2: Stabilize
- [ ] 2.1 Fix demonstrated root causes and run full PR CI.

### Phase 3: Review
- [ ] 3.1 Dispatch one final independent review and apply automerge only when green.
