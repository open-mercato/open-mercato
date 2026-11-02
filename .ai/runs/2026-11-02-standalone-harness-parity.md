# Share standalone integration configuration and verify lane parity

## Goal

Prevent the existing snapshot and local standalone runners from silently diverging in their app/test configuration after #8452, without adding automatic standalone execution on pull requests.

## Scope

Deliver one self-contained PR against main. Share environment and lifecycle helpers between the existing published snapshot lane and local runners; retain optional manual package verification, discovery diagnostics, configuration guards, and resource cleanup. Snapshot triggers and frequency remain unchanged.

## Implementation Plan

### Phase 1: Shared configuration

1.1 Reuse the environment builder in the snapshot workflow and local parity runner, preserving server-only flags and shared cross-process paths.
1.2 Document lane settings, test-selection expectations, and failure ownership without changing branch protection or publishing behavior.

### Phase 2: Verification

2.1 Add regression tests for caller wiring, prerequisites, configuration validation, and intentional server/test differences.
2.2 Run targeted checks and the configured validation gate, review the final diff, and publish the verified outcome.

### Phase 3: Consolidation

3.1 Remove automatic PR execution, update guards/documentation, and consolidate into one main-targeted PR.

## Risks

- Preserve disabled email and browser telemetry rather than quietly broadening snapshot runtime behavior. Their exclusion remains explicit.
- Full scaffold/build/integration execution requires available database and browser infrastructure. Record actual validation limits.
- Initial full unit execution hit an SMTP Jest worker SIGSEGV; the affected credentials suites pass alone (23 tests). The full retry completed 47 Turbo tasks before the docs test exhausted its 1 GiB Node heap. The full gate is not green; draft status is retained.
- Normal main-targeted CI must validate the consolidated head. No new standalone PR workflow or branch-protection check is added.

## Non-goals

Production behavior, API/database contracts, official-module pointers, branch-protection settings, automatic reverts, and production dependencies.

## Progress

PR: #8467

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Shared configuration

- [x] 1.1 Reuse the environment builder in the snapshot workflow and local parity runner — 91142b182
- [x] 1.2 Document lane settings, test-selection expectations, and failure ownership — 91142b182

### Phase 2: Verification

- [x] 2.1 Add regression tests for caller wiring, prerequisites, configuration validation, and intentional server/test differences — ad3f4727c, 180baaba2
- [ ] 2.2 Run targeted checks and the configured validation gate, review the final diff, and publish the verified outcome

### Phase 3: Consolidation

- [ ] 3.1 Remove automatic PR execution, update guards/documentation, and consolidate into one main-targeted PR
