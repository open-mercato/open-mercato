# Stabilize main CI — 2026-11-21 16:00

## Goal
Verify current main through a full-suite stabilization PR, fix demonstrated root causes, and add `automerge` only after the final reviewed revision passes CI.

## Scope
Use `stabilize/main-2026-11-21-1600` from `origin/main` into `main`. The unsuffixed branch belongs to the earlier completed PR #10200; this occurrence uses a unique suffix to preserve it. Existing CI already forces all 15 integration shards for same-repository `stabilize/*` branches and `ci-full` labels. Preserve that behavior; change only demonstrated failures and their regression coverage.

## Non-goals
No merging into main, weakened tests, unrelated product changes, dependencies, database migrations, or external submodule pointers.

## Implementation Plan
### Phase 1: Diagnose
1.1 Independently inspect current/recent main CI and establish the full-suite draft PR.
### Phase 2: Repair and verify
2.1 Fix demonstrated root causes with regression coverage, or record that no repair is justified when all checks pass.
2.2 Run the configured validation gate and all 15 PR integration shards; record evidence and limitations.
### Phase 3: Review and handoff
3.1 Dispatch one final independent review, validate its verdict, and apply `automerge` only after green exact-head CI.

## Delegation
At most two tasks: first a read-only historical/current CI investigation; second the required final review after implementation. Coupled workflow changes and fixes remain in the parent. Validate child evidence; merge no unreviewed child work.

## Validation
Configured order: build:packages, generate, build:packages, i18n:check-sync, i18n:check-usage, typecheck, test, build:app. Choose the runner with the repository Docker probe. For a record-only PR use the documented docs-only exemption (manual factual review, diff whitespace check; docs lint if configured), plus full remote CI evidence. Do not infer failure from pending or cancelled checks.

## Risks
CI can take over an hour. Main advances independently of this pinned PR. No source fix is justified solely by historical failures already repaired on main. External blockers remain explicitly incomplete.

## Run state
Claim-Run: 3ba3513b-8604-44a8-b2ed-9b3186af87d1
Base: 73a56134d296d79db0c83a8d02536b212a3ea529
Engine: om-auto-create-pr (steps: 4, --loop: no)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose
- [ ] 1.1 Independently inspect current/recent main CI and establish the full-suite draft PR.

### Phase 2: Repair and verify
- [ ] 2.1 Fix demonstrated root causes with regression coverage, or record that no repair is justified when all checks pass.
- [ ] 2.2 Run the configured validation gate and all 15 PR integration shards; record evidence and limitations.

### Phase 3: Review and handoff
- [ ] 3.1 Dispatch one final independent review, validate its verdict, and apply `automerge` only after green exact-head CI.
