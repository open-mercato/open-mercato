# Stabilize main CI — 2026-11-24

## Goal
Make the stabilization PR's complete CI suite green, fix demonstrated root causes, and add `automerge` only after green checks and independent review.

## Scope
Start from main and collect CI fixes on `stabilize/main-2026-11-24`. Existing `FORCE_FULL_SUITE` already selects all 15 shards and unscoped validation for same-repository stabilization branches or `ci-full` PRs. Preserve those controls and PR-specific concurrency.

## Non-goals
No weakening tests, bypassing security or QA gates, publishing previews, merging main, production operations, or unrelated refactors.

## Implementation Plan
### Phase 1: Diagnose and establish full-suite PR
1.1 Inspect latest main failures and independently investigate shard failures; open draft PR with full scope.
### Phase 2: Fix demonstrated root causes
2.1 Reproduce failures, implement minimal fixes with regression coverage, and run targeted checks.
### Phase 3: Validate and review
3.1 Run configured local gate and the PR's full remote suite; repair until green.
3.2 Dispatch one final independent review, resolve actionable findings, publish evidence, and add automerge after green.

## Validation
Configured ordered gate: build:packages, generate, build:packages, i18n:check-sync, i18n:check-usage, typecheck, test, build:app. Choose Docker/local runner by repository probe. Remote verification requires exact-head workflow completion and all 15 shards.

## Risks
Main's latest run is pending; historical failures may already be fixed. Manual preview dispatches for a fork fail a deliberate same-repository security gate and must not be made green by relaxing it. Runner queues may delay evidence. At most two children total: one independent read-only failure investigation, one final review. The root owns all coupled fixes and validation.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose and establish full-suite PR
- [ ] 1.1 Inspect latest main failures and independently investigate shard failures; open draft PR with full scope.

### Phase 2: Fix demonstrated root causes
- [ ] 2.1 Reproduce failures, implement minimal fixes with regression coverage, and run targeted checks.

### Phase 3: Validate and review
- [ ] 3.1 Run configured local gate and the PR's full remote suite; repair until green.
- [ ] 3.2 Dispatch one final independent review, resolve actionable findings, publish evidence, and add automerge after green.
