# Stabilize main CI

## Goal
Find and fix current main CI root causes and ship a reviewed PR with green checks.

## Scope
Investigate the main CI integration shards and snapshot release failures. Make the smallest evidenced correction, retaining public behavior and test coverage.

Non-goals: release changes, unrelated refactors, weakening checks, merging into main.

## Implementation Plan
### Phase 1: Diagnosis and correction
1.1 Correlate failed jobs with current main and implement regression fixes with tests.
### Phase 2: Verification and review
2.1 Run configured validation and verify remote CI outcomes.
2.2 Obtain independent final review and address findings.

## Risks
Latest main CI is running; historical failures may already be fixed. Local full validation depends on available dependencies and infrastructure. Snapshot investigation delegated read-only to cezar task 0d7135f4; final review reserved as second and final subtask.

## Evidence
- Snapshot root cause: standalone app workers disabled but test process defaults to managed workers; fixed both snapshot lanes in fe718ca53a.
- Parsed-YAML regression fails before fix and passes after. Eight focused workflow tests pass locally.
- Full workflow test file locally blocked by existing shared esbuild host 0.28.1/binary 0.28.2 mismatch; no application dependencies changed.
- Historical CI 41591269753 shard 4 has media-warning flakes and one final failure; investigate current run before altering runtime behavior.

## Progress
PR: #8585

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnosis and correction

- [ ] 1.1 Correlate failed jobs with current main and implement regression fixes with tests.

### Phase 2: Verification and review

- [ ] 2.1 Run configured validation and verify remote CI outcomes.
- [ ] 2.2 Obtain independent final review and address findings.
