# Stabilize main CI — November 1

## Goal
Fix repository-controlled root causes of failing main checks and demonstrate green CI on one new PR.

## Scope
Inspect recent main commits, workflow jobs, logs and artifacts; fix each independently verified current regression with focused coverage; run the configured validation gate and observe all applicable PR checks. Reuse this linked worktree on `fix/stabilize-main-ci-nov01` based on `ea24461ae`.

## Non-goals
Do not weaken checks, remove coverage, bypass the third-party dependency cooldown, merge into main, change production, or publish releases. Historic failures already fixed on main need no duplicate correction. Conditional checks legitimately skipped by their existing policy are recorded separately from passing checks.

## Implementation Plan

### Phase 1: Diagnose
1. Inventory every latest main check and inspect failing logs/artifacts against recent commits.
2. Reproduce repository-controlled causes and identify minimal independent fixes.

### Phase 2: Correct
1. Correct snapshot dependency resolution with regression coverage while retaining supply-chain safeguards.
2. Correct any additional verified current CI regressions with focused tests.

### Phase 3: Verify
1. Run the ordered configured validation gate and relevant standalone checks.
2. Observe this PR's complete CI results, inspect failures and iterate until all applicable checks pass.
3. Complete authoritative review, record evidence and finalize the PR.

## Risks
Snapshot publish/deploy jobs cannot safely be exercised by publishing a production release; validate equivalent paths with isolated local infrastructure or existing nonpublishing workflow support. CI may reveal failures not yet observable in currently running main jobs. Dependency resolution is time-sensitive; retain exact evidence and do not globally disable its age gate.

## Diagnosis
Snapshot Tiptap 3.32.2 is required for the peer-compatible patched Happy DOM 21.0.4 graph. Older HTML peers require vulnerable Happy DOM 20; do not downgrade. The scaffold lock currently seeds no third-party records, losing the reviewed monorepo resolution. Seed those exact checksummed records from the reviewed root lock without weakening the five-day policy. The pinned Yarn 4.17.1 reproduction passes with the actual generated seed, fails without it, and still rejects an unrelated young prosemirror-view release.

Coverage merge was skipped despite all direct dependencies passing: its condition does not override skipped audit ancestors. Restore aggregation with always() plus explicit successful direct-dependency guards.

## Initial evidence
Main run 41270947993 passed 23 executable jobs including all 15 integration shards; audit and merge-coverage were conditionally skipped. Snapshot run 41270948034 failed standalone dependency installation with Yarn YN0016: `@tiptap/core@npm:^3.32.2` has no eligible version under the release-age gate. Latest main `ea24461ae` adds application CSP changes and run 41274156075 is still active.

Runner: local; no configured app container is running. Use mise exec node@24 (24.22.2) and pinned Yarn 4.17.1.
Engine: om-auto-create-pr (steps: 7, --loop: no)

## Progress

PR: #8373

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose
- [x] 1.1 Inventory every latest main check and inspect failing logs/artifacts against recent commits
- [x] 1.2 Reproduce repository-controlled causes and identify minimal independent fixes

### Phase 2: Correct
- [x] 2.1 Correct snapshot dependency resolution with regression coverage while retaining supply-chain safeguards
- [x] 2.2 Correct any additional verified current CI regressions with focused tests — 9ca2a6c7a

### Phase 3: Verify
- [ ] 3.1 Run the ordered configured validation gate and relevant standalone checks
- [ ] 3.2 Observe this PR's complete CI results, inspect failures and iterate until all applicable checks pass
- [ ] 3.3 Complete authoritative review, record evidence and finalize the PR
