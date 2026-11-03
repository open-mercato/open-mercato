# Stabilize main CI

## Goal
Verify main CI and provide an explicit full-suite PR override.

## Scope
Add ci-full label handling to CI, with regression coverage. Latest main run 41653508026 passed all 15 integration shards and all other executed jobs; preceding runs were cancelled, not failed.

## Non-goals
No speculative product fixes, base-branch merges, or unrelated CI redesign.

## Implementation Plan
Phase 1: Add and test label-driven full integration scope, preserving existing selection.
Phase 2: Run validation and the full PR suite, fix any verified failures, then obtain one independent final review and apply automerge only after green checks.

## Validation evidence
Runner: local (no running app container). 34 targeted CI/audit tests passed. Full local gate blocked at yarn build:packages by missing node_modules install state. Broad workflow tests encounter shared esbuild host/binary mismatch; no production change justified by that local installation issue. Remote PR CI is the full-gate evidence source.

## Risks
Full CI requires remote runners. Label additions must trigger CI without unrelated label changes cancelling active suites.

## Progress
PR: #8623

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Full-suite override

- [x] 1.1 Add ci-full override and regression tests — ff69401d6e

### Phase 2: Verification

- [x] 2.1 Run validation and full PR CI; repair verified failures — ad3eed25a8; full CI run 41670095759 succeeded with all 15 shards and coverage aggregation
- [x] 2.2 Obtain independent final review and finalize green PR — review 5755516508 approved ad3eed25a8; parent verified diff and reran 8 focused tests

## Completion evidence
Full remote gate: https://github.com/open-mercato/open-mercato/actions/runs/41670095759 (success). All 15 integration shards, build, unit tests, lint, timezone, documents, Docker and coverage aggregation passed. Other PR checks, including CodeQL, passed; conditional audit/mutation jobs skipped as designed.

Shard 12 initially failed TC-STAFF-SUP-016 with a stale optimistic-lock timestamp after pausing a routing rule. The rerun passed without code changes; retained as a timing-flake observation rather than making a speculative product fix.

Independent final review: https://github.com/open-mercato/open-mercato/pull/8623#pullrequestreview-5755516508 (approve verdict, posted as COMMENTED because GitHub prevents self-approval). No code changed after review. This final commit records evidence only; final-head CI must remain green before automerge is applied.
