# Stabilize main CI — 2026-11-23

## Goal
Diagnose main CI failures, repair their root causes, and verify every full-suite PR check before adding `automerge`.

## Scope
Use `stabilize/main-2026-11-23` from main at d45d98f51a. Reuse the existing trusted `ci-full`/`stabilize/` full-suite selection. Limit fixes to evidenced CI failures and regression coverage.

Non-goals: merge into main, bypass checks, weaken assertions, change public contracts, apply local database migrations, or change unrelated product behavior.

## Implementation Plan

### Phase 1: Diagnose and repair
1.1 Inspect current and recent main failures; reproduce and fix any remaining root causes with regression coverage.
1.2 Verify the existing full-suite selector and run the configured validation gate using the local runner or exact CI evidence where local prerequisites block execution.

### Phase 2: Verify and review
2.1 Run all 15 integration shards and all other CI checks on this PR, correcting failures until green.
2.2 Dispatch one independent final review, address findings, record evidence, and apply automerge only after green CI and approval.

## Risks
Main continues moving; evidence is tied to this branch's exact head. Full CI can take an hour. Existing main failures may already be fixed; do not invent fixes. Local dependency/tool availability may require hosted CI for the configured gate. The user explicitly authorized stabilization branch naming, CI workflow fixes, draft PR creation, and CI monitoring through completion.

## Delegation
One independent read-only investigation of recent failure signatures; parent owns all coupled implementation and validation. One final independent review after implementation (maximum two child tasks).

## Findings and verification

- Latest main run [45078489783](https://github.com/open-mercato/open-mercato/actions/runs/45078489783) at d45d98f51a completed successfully: 24 successful jobs, all 15 integration shards green.
- Historical script failures in runs 45030798659 and 45030852346 came from the lesson index declaring 196 records when it contained 197. Main commit 05e09317c6 already corrected the count. The focused lesson-catalog regression passes locally (1/1).
- Historical TC-SALES-9594 timed out opening the payment edit menu in run 45030852346. It passes unchanged on main and this PR (6.1s in PR shard 12). The old failure remains a flake lead, not a demonstrated repaired defect or justification for speculative runtime changes.
- PR [full CI run 45081660684](https://github.com/open-mercato/open-mercato/actions/runs/45081660684), head 865e694eca, passed all 15 shards, coverage merge, full typecheck/units, build, lint, Docker and database-backed jobs. Other PR checks including CodeQL passed; audit and mutation jobs were skipped by their existing scope rules.
- Existing `FORCE_FULL_SUITE` at `.github/workflows/ci.yml:7` already recognizes trusted `stabilize/` branches and `ci-full`; logs confirm `FORCE_FULL_SUITE: true`. No duplicate workflow change is needed. Local CI selector/concurrency/coverage regression checks pass (45/45).
- This PR changes only this execution/evidence record. No source, API, database, dependency, or UI behavior changes were necessary.
- Runner: local. Initial i18n sync invocation exceeded the Unix-domain socket path limit in the cockpit TMPDIR. Re-running with a shorter task-specific TMPDIR passed i18n sync/usage and typecheck. Remaining local unit/app build results will be recorded before completion.

## Progress
PR: #10411

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose and repair

- [x] 1.1 Inspect current and recent main failures; reproduce and fix any remaining root causes with regression coverage.
- [x] 1.2 Verify the existing full-suite selector and run the configured validation gate using the local runner or exact CI evidence where local prerequisites block execution.

### Phase 2: Verify and review

- [x] 2.1 Run all 15 integration shards and all other CI checks on this PR, correcting failures until green.
- [ ] 2.2 Dispatch one independent final review, address findings, record evidence, and apply automerge only after green CI and approval.
