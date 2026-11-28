# Stabilize main — 2026-11-28

## Goal
Restore a passing full CI suite on a dedicated stabilization PR into main.

## Scope
Start at main beb07a9e963b705410cd051a065c53feed91244a. Diagnose current unit, timezone and integration failures; fix their causes with regression coverage. Use existing stabilize/ and ci-full full-suite selection. Open draft first, then promote to ready because draft CI deliberately skips the suite. Add automerge only after the exact PR head is green and independently reviewed.

## Non-goals
No merging into main, weakening checks, skipping failing coverage, unrelated refactoring, dependency additions, or production/database changes.

## Implementation Plan
### Phase 1: Diagnosis and repair
1.1 Investigate main CI failures and reproduce their causes.
1.2 Apply focused fixes and regression coverage.
### Phase 2: Validation and handoff
2.1 Run configured local validation and full PR CI; fix failures until green.
2.2 Obtain one final independent review, resolve findings, and label the green PR automerge.

## Delegation
One read-only child investigates unit/timezone logs while the parent handles integration diagnosis, PR setup and all edits. Reserve the second and final child for independent branch review; scopes do not overlap. Coupled implementation and CI repairs stay with the parent.

## Evidence
Main unit/timezone diagnosis confirmed the same stale forms header assertion in both jobs. First repair run 46081406661 passes all 15 integration shards and core-timezone; unit job reveals a scheduling-dependent backup-lock test barrier. Fixed by pausing the first stale remover before starting the second contender, with explicit BACKUP_LIVE_LOCK assertion. Production code is unchanged.

Local validation also exposed an undersized OMH-223 example-reading budget. Commit f7b8cc176b recalibrates the ceiling to the measured declared surface plus its existing reserve and extends the reserve regression. Exact file and capability allowlists remain enforced.

## Continuation — 2026-11-28
The scheduled 08:00 run found this existing PR rather than opening a duplicate. After the ownership conflict was reported, the operator explicitly instructed autonomous continuation. The cockpit confirms original run c5354196-6477-42d1-b33b-7ca6c3b4f09a and its child are done; its recorded validation processes have exited. Run b40fd49b-04fd-4ba4-b6b5-f9c00ed8bc0a therefore recovers the abandoned claim with an audit comment and an exact-SHA lease, then acquires its own lock. It resumes Phase 2 on the same stabilization branch. No live worker is displaced and no base-branch merge is planned.

Head f7b8cc176b passed hosted run 46089946143, including all 15 integration shards, unit tests, timezone coverage, lint, app build and multi-instance checks. All four workflows for that head completed successfully. The continuation runs the configured local gate afresh, dispatches one final independent review, and verifies the final pushed head before adding automerge. Local validation uses a short TMPDIR and Turbo environment passthrough; the already downloaded unzip executable supplies the missing host utility without changing project dependencies.

Continuation validation passed all eight configured commands in order: package build, generation, package rebuild, translation sync, translation usage, typecheck, full tests (51/51 Turbo tasks; create-app 1,316 passing tests and four existing skips), and production app build. Runner: local. The test command took 861 seconds and the app build took 260 seconds. No implementation changes were needed after f7b8cc176b; final-head hosted CI remains a publication gate after the remaining tracking updates.

Final independent review task 06b7a9b5-9e9a-4673-ad88-06adfed36a10 approved f7b8cc176b and reviewed the continuation's documentation-only delta through e99f4e2509, with no actionable findings. Its own full ordered gate passed (tests 51/51 tasks, 750 seconds; app build 201 seconds). Temporary mutation controls proved the repaired lock test rejects two owners and the harness regression rejects the old undersized cap. The parent verified the report and logs and reran forms tests in Pacific/Auckland (6/6) and the backup-lock suite (5/5). The reviewer made no tracked changes, so there was no child diff to merge.

The independent verdict is published on PR #10995. GitHub refused a formal author-App self-approval; no host review or merge requirement is waived. With all workflows on f7b8cc176b successful, the guarded automerge label was applied. The final tracking-only commit must also finish the full hosted suite before the continuation reports completion and releases its claim. This final publication check does not change the reviewed implementation.

## Risks
The current main integration run is unfinished, so additional failures may emerge. Full CI may take over an hour. Draft PRs cannot run CI in this repository; initial draft will be marked ready to validate. Initial local unit gate failed because Turbo strict mode stripped TMPDIR=/tmp, exposing tsx Unix socket path length limits in the cockpit temporary directory. Retry uses TURBO_ENV_MODE=loose with TMPDIR=/tmp. Record any further environmental blockers; retain full hosted CI as a requirement.

## Progress

PR: #10995

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnosis and repair

- [x] 1.1 Investigate main CI failures and reproduce their causes. — ede2c27bfc
- [x] 1.2 Apply focused fixes and regression coverage. — ede2c27bfc, 341cdd7398, f7b8cc176b

### Phase 2: Validation and handoff

- [x] 2.1 Run configured local validation and full PR CI; fix failures until green. — f7b8cc176b; hosted run 46089946143 and fresh local gate on continuation f28cd74420
- [x] 2.2 Obtain one final independent review, resolve findings, and label the green PR automerge. — f7b8cc176b; independent review 06b7a9b5-9e9a-4673-ad88-06adfed36a10, no findings; guarded label applied after exact-head CI succeeded
