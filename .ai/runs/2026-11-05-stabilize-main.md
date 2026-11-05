# Stabilize main CI — 2026-11-05

## Goal
Restore green CI by fixing the root cause of main run 41919324974 on a dedicated stabilization PR.

## Scope
Start from origin/main (5d3536acd2), diagnose the sidebar group visibility failure, fix the smallest proven defect, and run the full PR suite using the existing ci-full label. All fixes stay on stabilize/main-2026-11-05. No merge into main, schema changes, or unrelated cleanup.

## Implementation Plan
### Phase 1: Diagnose and repair
1.1 Diagnose the failure using logs and independent read-only analysis.
1.2 Implement a focused regression fix and appropriate tests.
### Phase 2: Validate and review
2.1 Run configured validation and full 15-shard PR CI; fix any proven failures.
2.2 Obtain an independent final review through cezar and address findings.
2.3 Mark the completed PR ready and apply automerge only after green CI.

## Risks
CI may reveal additional independent failures. Existing ci-full support makes a workflow edit unnecessary. Local resource or dependency limitations must be disclosed. User explicitly authorizes stabilization branch naming, full-suite label, pipeline changes needed for this goal, and waiting for CI. Two child tasks maximum: read-only diagnosis and final review. Implementation stays local because diagnosis and repair are tightly coupled.

## Progress

PR: #8739

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose and repair

- [x] 1.1 Diagnose the failure using logs and independent read-only analysis.
- [ ] 1.2 Implement a focused regression fix and appropriate tests.

### Phase 2: Validate and review

- [ ] 2.1 Run configured validation and full 15-shard PR CI; fix any proven failures.
- [ ] 2.2 Obtain an independent final review through cezar and address findings.
- [ ] 2.3 Mark the completed PR ready and apply automerge only after green CI.
