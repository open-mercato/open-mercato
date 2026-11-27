# Enterprise security implementation refresh

## Goal

Replace the surviving Enterprise implementation from the changes associated with #655, #1272, and #1461. Preserve tenant boundaries, verification outcomes, session behavior, and the current module contract.

## Implementation

1. Refresh the tenant-scoped sudo configuration API, command handling, challenge service, and affected tests.
2. Trace security metadata and replace the Enterprise MFA and SSO session integration introduced by the prior changes. Later changes had already superseded the metadata implementation from #655.
3. Review the combined diff against the current contracts and validate the affected flows with the existing tests.

## Risks

Changes to sudo configuration must preserve tenant and organization isolation, precedence, and undo. Authentication changes must preserve employee token audiences, session association, and revocation. Keep the previous change references available for review.

## Progress

PR: #10880

> Convention: checked steps are complete.

### Phase 1: Implementation and verification

- [x] 1.1 Refresh tenant-scoped sudo configuration and challenge handling — 03b7d3b7af
- [x] 1.2 Refresh Enterprise security metadata and session integration — dde64ba157
- [ ] 1.3 Verify shared contracts and run security regressions
