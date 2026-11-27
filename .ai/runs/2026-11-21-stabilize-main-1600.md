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

## Investigation and validation evidence

The latest ten failed main CI runs were historical; their corrective commits are ancestors of the pinned base. Parent validation confirmed the lesson-count failure, corrective ancestry, and hosted job results from read-only audit task `172d9dcb-faf4-45b7-a399-196be2c7b250`. The child made no changes; no child branch was merged. No new source or workflow repair is justified by the completed checks.

| Historical failure | Existing correction on the base |
| --- | --- |
| [44760649587](https://github.com/open-mercato/open-mercato/actions/runs/44760649587): lesson count drift | `7d79c51b14` (#10150), declared count 192 to 193 |
| [44492039926](https://github.com/open-mercato/open-mercato/actions/runs/44492039926): transient payment edit menu | `f0cdbcc7e6` (#9867), use the existing row interaction |
| [44456099969](https://github.com/open-mercato/open-mercato/actions/runs/44456099969) and related auth failures: wrong discard labels | `59f204debc` (#9715), localized discard-action selectors |
| [44409579981](https://github.com/open-mercato/open-mercato/actions/runs/44409579981): CRM preset setup exhausted scenario budget | `f0cdbcc7e6` (#9867), shared CRM authentication |
| [44334863912](https://github.com/open-mercato/open-mercato/actions/runs/44334863912): attachment fixture mismatch and search-handler cleanup race | `7d4003fb64` (#9729) and `7ae5c1ed59` (#9825) |

- Pinned main [CI44912011614](https://github.com/open-mercato/open-mercato/actions/runs/44912011614), head `73a56134d296d79db0c83a8d02536b212a3ea529`: completed success, 24 successful jobs and all 15 shards; dependency audit skipped because no dependency files changed. TC-AUTH-002 and TC-INT-002 passed on retry, with no proven root cause in those logs.
- PR baseline [CI44917220932](https://github.com/open-mercato/open-mercato/actions/runs/44917220932), head `feee8df5b034b5cb285604bcfda3381e8f8a2a5d`: completed success, all 15 shards, merge coverage, prepare, test, lint, DS lint, timezone, Docker and documents multi-instance. Dependency audit correctly skipped. Parent inspected prepare/test steps individually: both package builds, generation, app build, i18n sync/usage, types and tests passed.
- The green PR baseline includes five retry-rescued tests: TC-CHKT-PRECISION-001 (shard 2; first submit returned a WST decimal-place validation error), TC-AUTH-002 (shard 3; generic-error text visibility timeout), TC-INT-002 (shard 5; scenario timeout), TC-CRM-8469 (shard 7; conflict-recovery UI), and TC-AGENT-UXC-001 (shard 15; live trace refresh). Successful CI is not evidence of zero flakes. No assertions or timeouts were weakened; no new source root cause is claimed without reproduction/trace evidence.
- Runner: local after the prescribed Docker probe found no running app container. This PR changes only its execution record, so the docs-only gate exemption applies: manual factual review and `git diff --check` passed, with no configured Markdown lint command. The eight configured build/generate/i18n/typecheck/test commands were not rerun locally. Hosted results above are separate evidence, not a claim of local execution.
- Main may advance after the pinned base. Final review and CI on the final PR head remain required before `automerge`; tracker-only finalization will be recorded in the PR outcome comment to avoid changing a tested head merely to record its result.

## Run state
Claim-Run: 3ba3513b-8604-44a8-b2ed-9b3186af87d1
Base: 73a56134d296d79db0c83a8d02536b212a3ea529
Engine: om-auto-create-pr (steps: 4, --loop: no)

## Progress

PR: #10229

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose
- [x] 1.1 Independently inspect current/recent main CI and establish the full-suite draft PR. — feee8df5b0 (evidence above; final-head CI remains a finalization gate)

### Phase 2: Repair and verify
- [x] 2.1 Fix demonstrated root causes with regression coverage, or record that no repair is justified when all checks pass. — feee8df5b0 (evidence above; final-head CI remains a finalization gate)
- [x] 2.2 Run the configured validation gate and all 15 PR integration shards; record evidence and limitations. — feee8df5b0 (evidence above; final-head CI remains a finalization gate)

### Phase 3: Review and handoff
- [ ] 3.1 Dispatch one final independent review, validate its verdict, and apply `automerge` only after green exact-head CI.
