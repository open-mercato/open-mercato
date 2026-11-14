# Stabilize main — 2026-11-15

## Goal
Repair demonstrated failures on main and verify a full-suite stabilization PR into main before applying `automerge`.

## Scope
Main at 91f97e988ff38f47bc3516c88d90c87e1e85f007 passes CI run 43639379601 (all 15 integration shards), but Main Snapshot Release run 43639379527 fails standalone CRM currency-pagination tests because the pipeline dialog Apply button is outside the viewport. Investigate that root cause and any additional failures found on this branch. Existing trusted `stabilize/*` and `ci-full` support already forces all integration shards and unfiltered unit/type checks; preserve it.

Non-goals: publish packages, merge to main, change release behavior, weaken tests, bypass QA, alter unrelated modules or take over other stabilization runs.

## Implementation Plan

### Phase 1: Diagnose and repair
1.1 Independently audit main workflow failures and report actionable causes (read-only dispatched task).
1.2 Reproduce and fix the demonstrated failure with regression coverage; include any subsequently demonstrated CI failures on this branch.

### Phase 2: Validate
2.1 Run the configured ordered validation gate and relevant targeted checks; document real environment blockers.
2.2 Push the fixes and run the PR's complete suite (15 integration shards); fix failures until green.

### Phase 3: Review and hand off
3.1 Dispatch one final independent review task after implementation, validate its evidence, and address actionable feedback.
3.2 Publish verification evidence, mark the PR ready and apply `automerge` only once its current-head checks and review pass; release the owned claim.

## Audit evidence
Independent audit 8496dade confirmed vertical overflow at 1280×720: Radix available height 344px, filter placed at y=376px, footer below viewport. TC-CRM-8020 leaked its pipeline and stage by sending query-only DELETE to body-only routes; server logs prove missing-id failures immediately before that test passed. Correct cleanup to send JSON IDs and check HTTP results. Two retry-passing invitation/tooltip flakes lack first-attempt traces and are not established product regressions.

First PR full CI run 43652288099 passed all 15 shards, typecheck/unit checks, lint, build, Docker, timezone, and multi-instance checks at 811a56e637. Further cleanup and explicit viewport screenshots will be validated on the next head.

## Risks
Standalone-only UI failures may need a published-app reproduction; use existing local test-environment tooling without publishing or applying migrations without authorization. A main workflow can fail even when the regular CI suite passes. Additional CI failures may widen the necessary repair. No production or credential operations are authorized.

## Execution
Runner: local (no running compose app found). Immutable install completed; native SQLite compilation needs a compiler unavailable on the host. Gate build/generate/rebuild, translation sync/usage, and typecheck passed. Focused filter tests: 14 passed; baseline reproduction: two new assertions fail. Workflow scope/concurrency regressions: 28 passed. Use a short TMPDIR for tsx IPC on this cockpit.
Branch: stabilize/main-2026-11-15 (operator-requested override of the skill's default prefix).
Engine: om-auto-create-pr (steps: 6, --loop: no)
Worktree: reuse the invoking isolated linked worktree; do not clean it up.
Claim-Run: a30406e3-ba32-4b20-a622-461f5494b389
Delegation: first task independently audits CI evidence without edits; parent owns coupled fixes and validation; second and final task reviews the finished branch.

## Progress
PR: #9558

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose and repair

- [x] 1.1 Independently audit main workflow failures and report actionable causes — 811a56e637 (read-only audit 8496dade validated; zero diff)
- [x] 1.2 Reproduce and fix the demonstrated failure with regression coverage — 5c0c62fb53

### Phase 2: Validate

- [ ] 2.1 Run the configured ordered validation gate and relevant targeted checks
- [ ] 2.2 Run the PR complete suite and fix failures until green

### Phase 3: Review and hand off

- [ ] 3.1 Obtain final independent review and address actionable feedback
- [ ] 3.2 Publish evidence, mark ready, apply automerge when green, and release claim
