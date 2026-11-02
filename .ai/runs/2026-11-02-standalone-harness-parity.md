# Share standalone integration configuration and verify lane parity

## Goal

Prevent the snapshot and pre-merge standalone lanes from silently diverging in their app/test configuration after #8452.

## Scope

Stack this PR on the pre-merge standalone gate PR. Reuse its shared environment builder in the published snapshot lane and local standalone runner. Add executable checks for configuration parity and intentional exclusions, and document failure ownership and rollout.

## Implementation Plan

### Phase 1: Shared configuration

1.1 Reuse the environment builder in the snapshot workflow and local parity runner, preserving server-only flags and shared cross-process paths.
1.2 Document lane settings, test-selection expectations, and failure ownership without changing branch protection or publishing behavior.

### Phase 2: Verification

2.1 Add regression tests for caller wiring, prerequisites, configuration validation, and intentional server/test differences.
2.2 Run targeted checks and the configured validation gate, review the final diff, and publish the verified outcome.

## Risks

- The follow-up depends on the pre-merge gate PR; keep the PR diff separate by targeting that branch until it merges.
- Preserve disabled email and browser telemetry rather than quietly broadening snapshot runtime behavior. Their exclusion remains explicit.
- Full scaffold/build/integration execution requires available database and browser infrastructure. Record actual validation limits.

## Non-goals

Production behavior, API/database contracts, official-module pointers, branch-protection settings, automatic reverts, and production dependencies.

## Progress

PR: #8467

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Shared configuration

- [x] 1.1 Reuse the environment builder in the snapshot workflow and local parity runner — 91142b182
- [x] 1.2 Document lane settings, test-selection expectations, and failure ownership — 91142b182

### Phase 2: Verification

- [ ] 2.1 Add regression tests for caller wiring, prerequisites, configuration validation, and intentional server/test differences
- [ ] 2.2 Run targeted checks and the configured validation gate, review the final diff, and publish the verified outcome
