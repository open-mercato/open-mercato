# Stabilize main CI — 2026-11-21

## Goal
Deliver a reviewed stabilization PR into main with the full 15-shard CI suite green, then apply automerge.

## Scope
Inspect current and recent main CI failures, reproduce the remaining root causes, and make minimal fixes on `stabilize/main-2026-11-21` from main a2b3e8bbaebe9cacb5bcab2d10a7c19a53a6878e. The workflow already supports ci-full and stabilize branches; preserve that behavior.

## Non-goals
No direct main changes, merging, unrelated feature work, weakened tests, migrations, dependencies, or QA-policy changes.

## Implementation Plan
### Phase 1: Diagnose and repair
1.1 Audit current/historical failures and apply minimal root-cause fixes with regression coverage.
### Phase 2: Verify
2.1 Run the configured ordered validation gate and full PR CI, repairing failures until green.
### Phase 3: Review and finalize
3.1 Dispatch one final independent cezar review task; validate its verdict and address findings.
3.2 Publish evidence, complete the plan, promote the draft, and apply automerge only with green CI.

## Dispatch plan
Use at most two subtasks: one read-only historical CI audit (no edits), then one final branch review. Reproduction and implementation are coupled and remain in the parent.

## Validation
Runner selected after prescribed Docker probe. Gate: build:packages, generate, build:packages, i18n:check-sync, i18n:check-usage, typecheck, test, build:app. CI must include all 15 shards for the exact PR head. Preserve failures and limits in PR evidence.

## Risks
Current main CI is still active (run 44826228551); earlier failures may already be fixed. Main movement must not cancel this PR run. Do not claim green from partial or stale checks. Final documentation commits need fresh exact-head CI evidence.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose and repair

- [ ] 1.1 Audit current/historical failures and apply minimal root-cause fixes with regression coverage.

### Phase 2: Verify

- [ ] 2.1 Run the configured ordered validation gate and full PR CI, repairing failures until green.

### Phase 3: Review and finalize

- [ ] 3.1 Dispatch one final independent cezar review task; validate its verdict and address findings.
- [ ] 3.2 Publish evidence, complete the plan, promote the draft, and apply automerge only with green CI.
