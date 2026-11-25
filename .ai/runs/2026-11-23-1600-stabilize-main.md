# Stabilize main CI — 2026-11-23 16:00

## Goal
Verify current main with the full PR suite, repair demonstrated root causes, obtain an independent final review, and apply automerge only with all checks green.

## Scope
Branch from main at 9f90793385. The earlier same-day stabilization PR #10411 already merged successfully; use a 1600 suffix to preserve that completed slot. Existing trusted stabilize/ and ci-full selection already runs full typechecking, all units and all 15 integration shards.

## Non-goals
No base merge, speculative fixes, production dependencies, database migrations applied locally, reduced coverage, or takeover of older active stabilization work.

## Implementation Plan
### Phase 1: Diagnose and fix
1.1 Inspect main CI and historical failures, distinguishing cancellation and already-fixed defects.
1.2 Repair demonstrated root causes with regression coverage; preserve existing full-suite selection.
### Phase 2: Verify and review
2.1 Run configured validation and full PR CI; correct failures until green.
2.2 Dispatch one independent final review, resolve findings, and apply automerge after green exact-head checks.

## Dispatch plan
A read-only CI evidence audit and one final independent review (maximum two subtasks). Root owns all coupled implementation and validation.

## Risks
Main moves frequently. Evidence must match this branch head. Local prerequisites may block the full local gate; record limits and use exact-head hosted CI evidence without implying unrun checks passed. If no defect remains, retain only the verification record rather than inventing source fixes.

## Findings and verification

- Current main [run 45190386427](https://github.com/open-mercato/open-mercato/actions/runs/45190386427), SHA `9f90793385139ca490592dcfc8890ae2123f7a71`, passed all 15 integration shards, coverage aggregation and 24 jobs. The immediately preceding cancelled runs had zero jobs; cancellation is not a failing test.
- Four historical script failures were a lesson-count mismatch already repaired by merged #10362, commit `05e09317c65d5b22defeccee72bb8afd724c8636`, an ancestor of this branch. No repeated lesson edit is needed.
- Historical TC-SALES-9594 intermittency in runs 45030852346 and 45181180866 remains a scope/menu timing lead. Trace evidence shows the payment menu disappearing as delayed fixture-organization initialization finishes. Active #10286 already proposes readiness synchronization; this run did not take over its claim or copy its unmerged changes. The unchanged test passed on current main (4.8s) and this PR (6.5s). A passing run does not establish that the intermittency was repaired.
- The existing trusted `stabilize/` branch and `ci-full` selectors already select full typechecking, all unit tests and all 15 shards. No duplicate workflow edit or speculative source change was necessary; this PR changes only this execution/evidence record.
- PR [full CI run 45200988254](https://github.com/open-mercato/open-mercato/actions/runs/45200988254), head `667ebd02778763ddb83a98f0771ed22a4196ec2d`, completed successfully: 24 successful jobs, all 15 integration shards and coverage aggregation. All visible PR checks were settled (32 successes, five existing scope skips). Prepare/test logs verify package build, generation, package rebuild, i18n sync/usage, full typecheck, all units and app build passed in hosted CI.
- Runner: local for this documentation-only change. The CI scope, concurrency, coverage and lesson-catalog regressions passed 50/50. An exported `yarn` shell function initially bypassed the test fixture's stub; clearing `BASH_FUNC_yarn%%` made the unchanged checks pass. No Markdown lint command is configured; the diff was reread manually. Hosted CI supplies the full configured validation evidence; no unrun local build is claimed as passed.
- Evidence-head [full CI run 45209876450](https://github.com/open-mercato/open-mercato/actions/runs/45209876450), SHA `94d14bf64ec7d6101b402171f04b1803d6712511`, also passed all 15 shards, coverage aggregation and 24 jobs. All exact-head workflows completed; visible checks settled at 31 successes and five existing scope skips.
- Independent review task `111d4403` [approved the evidence diff](https://github.com/open-mercato/open-mercato/pull/10452#pullrequestreview-6024786915) at `94d14bf64ec7d6101b402171f04b1803d6712511`, with no actionable findings. It independently reran all 50 focused checks, verified the hosted gate logs and raw historical trace, and confirmed no source/contract/security changes. GitHub rejected App self-approval; the verdict is honestly published as a COMMENT and does not satisfy any required host approval.
- After independently checking the green evidence head and all exact-head workflows, the driving run applied and read back `automerge`. The PR remains draft during the final metadata checkpoint; the same independent reviewer will inspect this completion record's exact SHA, and the driving run will require its own full CI to pass before readiness and reporting. Those final exact-head outcomes will be recorded on the PR without another repository change. The required-check endpoint returned 404, so all reported checks remain gates; scope skips are disclosed above.

## Progress
PR: #10452

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose and fix

- [x] 1.1 Inspect main CI and historical failures — 667ebd0277
- [x] 1.2 Repair demonstrated root causes with regression coverage — 667ebd0277

### Phase 2: Verify and review

- [x] 2.1 Run configured validation and full PR CI until green — 667ebd0277
- [x] 2.2 Complete independent review and apply automerge — 94d14bf64e (independent approval and green full CI verified; automerge applied; final metadata checkpoint outcomes recorded on the PR)
