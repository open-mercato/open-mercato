# Stabilize main — 2026-11-20 16:00

## Goal

Diagnose and correct demonstrated main CI failures, verify a full-suite draft PR into main, and request automerge only after green final-head CI and independent review.

## Scope

Base: `e2099fcc8e9e45bb72cc0c2a3558f738f6160c71`. Use `stabilize/main-2026-11-20-1600`: today's unsuffixed branch and 08:00 branch already merged as #10037 and #10073. Do not overwrite their plans or branches. Existing trusted stabilization-prefix and `ci-full` routing already forces full typecheck, unit tests and all 15 shards; verify and reuse it.

Non-goals: merge into main, publish packages, suppress checks or weaken assertions, change public contracts or production dependencies, change release behavior, or implement the draft phased-integration design.

Source doc: `.ai/specs/implemented/2026-04-10-ci-cd-performance.md`

## Implementation Plan

### Phase 1: Establish evidence

1.1 Open a full-suite draft PR and independently investigate current main failures.

### Phase 2: Correct and verify

2.1 Fix demonstrated root causes with regression coverage, preserving behavior when no defect is established.
2.2 Run configured validation and verify all applicable workflows, including 15 integration shards, on the exact PR head.

### Phase 3: Review and finalize

3.1 Dispatch ONE final independent review task, validate its evidence and resolve actionable findings.
3.2 Publish evidence, finish tracking, promote the PR and apply automerge only after final-head CI is green.

## Delegation

At most two cezar subtasks: one independent, read-only main CI investigation with no repository edits; one final review of the completed branch. Keep fixes and validation together because they depend on the same evolving CI evidence. No child changes are merged without review.

## Risks

Main may advance independently. Earlier snapshot failures may predate the merged Awilix compatibility fix in #10073. Read checks and workflow runs for the exact head before declaring success. Use hosted gate evidence if local prerequisites are unavailable and disclose that limit. Never publish packages to reproduce a failure.

Claim run: `5032d9a6-7403-48b9-a8f0-93368de201fa`

Engine: om-auto-create-pr (steps: 5, --loop: no)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Establish evidence

- [ ] 1.1 Open a full-suite draft PR and independently investigate current main failures.

### Phase 2: Correct and verify

- [ ] 2.1 Fix demonstrated root causes with regression coverage, preserving behavior when no defect is established.
- [ ] 2.2 Run configured validation and verify all applicable workflows, including 15 integration shards, on the exact PR head.

### Phase 3: Review and finalize

- [ ] 3.1 Dispatch ONE final independent review task, validate its evidence and resolve actionable findings.
- [ ] 3.2 Publish evidence, finish tracking, promote the PR and apply automerge only after final-head CI is green.
