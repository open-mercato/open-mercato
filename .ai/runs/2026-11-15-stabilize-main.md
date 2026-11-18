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

First PR full CI run 43652288099 passed all 15 shards, typecheck/unit checks, lint, build, Docker, timezone, and multi-instance checks at 811a56e637. Cleanup and full viewport assertions subsequently passed all 15 integration shards at cd58f8ded4; that run exposed the unrelated staff unit-test race described below.

## Final review and follow-up
Final independent review f4c0b4e2 inspected cd58f8ded4: no actionable customers source, security, compatibility, scope or DS findings across all five consumers and cleanup routes. It requested changes solely for CI43655135872 unit-test failure in staff TaskBoardScreen. All15integration shards passed, including TC8020all3 and TC8576EUR/USD on first attempts.

The staff test waited for the list wrapper before asserting rows, while DataTable intentionally renders a loading state until asynchronous injected columns initialize. Preserve both row assertions and wait for that rendered-row boundary — 69f0a4d57c. Focused staff+pipeline tests:12passed. No staff production behavior changes. This is the final reviewer finding fix; no third subtask is created.

Local full test retry completed50successful tasks but create-app failed only because this host lacked Info-ZIP unzip. Supplied the executable from the pinned Node test container; all19affected session-share tests then passed. CI supplies its own prerequisite. Local app build passed. Managed CRM assertions passed all five tests on first attempts; the enclosing shell exited 143 after suite completion, with app/state teardown verified. Real local self-QA passed desktop, short and mobile viewports plus all five filter-shell consumers, with screenshots attached and QA labels earned. Final exact-head CI must pass.

## Publication and final follow-up

Implementation head `76974b6e7aabd154ee548d1cf139e1aa8ed7d83f` passed the complete [CI run 43658391907](https://github.com/open-mercato/open-mercato/actions/runs/43658391907): all 15 integration shards, all eight configured validation commands, template parity, repo-wide guards, lint/DS lint, timezone, Docker and multi-instance checks. Every reported workflow/check was complete and successful or intentionally skipped before promotion.

PR #9558 was marked ready and labeled `automerge` only after that result. [Local self-QA evidence](https://github.com/open-mercato/open-mercato/pull/9558#issuecomment-6886611389) earned `qa-approved` and `qa-self-verified`; the independent review's sole CI finding was repaired and verified by the successful full unit-test job. No merge was performed by this run.

This final tracking commit changes only this plan and receives another full CI run because the stabilization branch always forces the suite. The driving run reports that follow-up separately on the PR, switches its work claim to `ci-monitoring`, and releases the exact owned atomic lock after publishing this record. It continues checking the final head and reports completion only after that head is green. A newly failing check requires ownership verification and a repair; no passing check is inferred from an earlier head.

## Risks
Standalone-only UI failures may need a published-app reproduction; use existing local test-environment tooling without publishing or applying migrations without authorization. A main workflow can fail even when the regular CI suite passes. Additional CI failures may widen the necessary repair. No production or credential operations are authorized.

## Execution
Runner: local (no running compose app found). Immutable install completed; the installed SQLite prebuild passes an in-memory smoke test despite an install-time compiler warning. Gate build/generate/rebuild, translation sync/usage, and typecheck passed. Focused filter tests: 14 passed; baseline reproduction: two new assertions fail. Workflow scope/concurrency regressions: 28 passed. Use a short TMPDIR for tsx IPC on this cockpit.
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

- [x] 2.1 Run the configured ordered validation gate and relevant targeted checks — 76974b6e7a (all eight configured commands passed in CI43658391907)
- [x] 2.2 Run the PR complete suite and fix failures until green — 76974b6e7a (CI43658391907: all 15 shards and every reported check/workflow completed successfully)

### Phase 3: Review and hand off

- [x] 3.1 Obtain final independent review and address actionable feedback — 69f0a4d57c (review f4c0b4e2; sole unit-test blocker resolved in current-head CI)
- [x] 3.2 Publish evidence, mark ready, apply automerge when green, and release claim — 76974b6e7a (ready and automerge applied only after full green CI; release follows this tracking commit)
