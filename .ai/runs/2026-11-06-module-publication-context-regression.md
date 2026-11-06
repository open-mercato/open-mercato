# Restore bounded publication-context regression coverage

## Goal
Fix the stale OMH-241/OMH-239 assertion exposed by #8612 CI after #8309 deliberately expanded the publication/install guidance case.

## Scope
Only the standalone overlay regression test and this execution plan. Preserve the exact discovery routing, empty publication skill list, explicit source ownership and bounded context. No harness case, runtime, UI, dependency, or budget change.

Source doc: .ai/runs/2026-10-31-canonical-module-locators-focused.md

## Implementation Plan

### Phase 1: Semantic regression fix
1.1 Replace the obsolete three-file assertion with the exact approved six-path context and source-reference/budget assertions.

### Phase 2: Verification and delivery
2.1 Run the configured gate, perform the authoritative review and publish the ready follow-up PR.

## Evidence and Risks
The targeted regression passes at 82d0a183c5, fails at introducing commit fa13c821e2 (#8309), and fails on merged main f60620c07d. #8309 adds three exact CLI source references to five required files plus one optional architecture guide, with maxContextFiles=6. The fix must pin this intentional shape rather than loosening the assertion. Full gate failures will be reported honestly and block completion.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Semantic regression fix

- [ ] 1.1 Replace the obsolete three-file assertion with the exact approved six-path context and source-reference/budget assertions.

### Phase 2: Verification and delivery

- [ ] 2.1 Run the configured gate, perform the authoritative review and publish the ready follow-up PR.
