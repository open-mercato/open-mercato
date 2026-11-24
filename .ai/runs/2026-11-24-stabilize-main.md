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

## Diagnosis
Historical main runs 45257515706 and 45212804817 failed only `TC-SALES-9594` on shard 12. Artifacts show missing action menus or lost focus during organization initialization; a separate retry passed both locale assertions and then exceeded the shared 20-second test budget during cleanup. Snapshot run 45257515989 independently shows the same UI failure. The exact component unmount mechanism is inferred from overlapping organization requests and disappearing menus, not instrumented.

PR #10286 already proposes waiting for the fixture organization to be ready. Preserve that candidate while addressing the separate teardown-budget defect here; do not change or take over that claimed PR. No application behavior, timeout policy, assertion, permission check, or cleanup success check is relaxed.

Independent read-only child 484724b6 inspected logs and artifacts, made no changes, and started no tests/processes. Its evidence was checked against the same test and snapshot trace; no branch merge is needed.

The first PR full-suite run 45287501078 passed every runnable job, including all 15 shards. Historical failures remain intermittent because the relevant source is unchanged. Local full-unit attempt failed only at the cockpit temporary Unix socket path limit; repeat with TMPDIR/TMP/TEMP=/tmp and TURBO_ENV_MODE=loose to propagate it through Turbo.

## Progress
PR: #10492

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose and establish full-suite PR
- [x] 1.1 Inspect latest main failures and independently investigate shard failures; open draft PR with full scope. — 728a368d4f

### Phase 2: Fix demonstrated root causes
- [ ] 2.1 Reproduce failures, implement minimal fixes with regression coverage, and run targeted checks.

### Phase 3: Validate and review
- [ ] 3.1 Run configured local gate and the PR's full remote suite; repair until green.
- [ ] 3.2 Dispatch one final independent review, resolve actionable findings, publish evidence, and add automerge after green.
