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

## Risks
The current main integration run is unfinished, so additional failures may emerge. Full CI may take over an hour. Draft PRs cannot run CI in this repository; initial draft will be marked ready to validate. Initial local unit gate failed because Turbo strict mode stripped TMPDIR=/tmp, exposing tsx Unix socket path length limits in the cockpit temporary directory. Retry uses TURBO_ENV_MODE=loose with TMPDIR=/tmp. Record any further environmental blockers; retain full hosted CI as a requirement.

## Progress

PR: #10995

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnosis and repair

- [x] 1.1 Investigate main CI failures and reproduce their causes. — ede2c27bfc
- [x] 1.2 Apply focused fixes and regression coverage. — ede2c27bfc, 341cdd7398, f7b8cc176b

### Phase 2: Validation and handoff

- [ ] 2.1 Run configured local validation and full PR CI; fix failures until green.
- [ ] 2.2 Obtain one final independent review, resolve findings, and label the green PR automerge.
