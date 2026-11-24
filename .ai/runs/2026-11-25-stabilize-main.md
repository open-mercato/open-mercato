# Stabilize main CI — 2026-11-25

## Goal
Verify the latest main baseline with the full CI suite and fix verified root causes on a single stabilization PR.

## Scope
Inspect main workflow failures, preserve full-suite selection for stabilization PRs and the ci-full label, and make the smallest evidenced fixes with regression coverage.

## Non-goals
No base-branch merge, release operations, test suppression, contract changes, or unrelated refactoring.

## Implementation Plan
### Phase 1: Diagnose and repair
1.1 Independently inspect recent main CI failures and identify actionable root causes.
1.2 Fix evidenced CI defects and verify regression coverage.
### Phase 2: Validate and review
2.1 Run the configured validation gate and the PR full suite; resolve failures until green.
2.2 Dispatch one final independent review, address findings, and apply automerge only after green evidence.

## Risks
Main's latest full suite is still running. Infrastructure failures must be distinguished from product defects. The existing ci-full and stabilize branch override already exists; inspect it before changing workflow behavior. Runner: to be probed before local gate.

Engine: om-auto-create-pr (steps: 4, --loop: no)
Branch: stabilize/main-2026-11-25 (operator override).
Delegation: one read-only CI investigation and one final review; tightly coupled fixes stay in the parent worktree.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose and repair
- [ ] 1.1 Independently inspect recent main CI failures and identify actionable root causes.
- [ ] 1.2 Fix evidenced CI defects and verify regression coverage.

### Phase 2: Validate and review
- [ ] 2.1 Run the configured validation gate and the PR full suite; resolve failures until green.
- [ ] 2.2 Dispatch one final independent review, address findings, and apply automerge only after green evidence.
