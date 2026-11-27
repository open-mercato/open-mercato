# Enterprise security implementation refresh

## Goal

Replace the surviving Enterprise implementation from the changes associated with #655, #1272, and #1461. Preserve tenant boundaries, verification outcomes, session behavior, and the current module contract.

## Implementation

1. Refresh the tenant-scoped sudo configuration API, command handling, challenge service, and affected tests.
2. Refresh security metadata and the Enterprise MFA and SSO session integration introduced by the prior changes.
3. Review the combined diff against the current contracts and validate the affected flows with the existing tests.

## Risks

Changes to sudo configuration must preserve tenant and organization isolation, precedence, and undo. Authentication changes must preserve employee token audiences, session association, and revocation. Keep the previous change references available for review.

## Progress

> Convention: unchecked steps are pending. Record the commit when a step lands.

### Phase 1: Implementation and verification

- [ ] 1.1 Refresh tenant-scoped sudo configuration and challenge handling
- [ ] 1.2 Refresh Enterprise security metadata and session integration
- [ ] 1.3 Verify shared contracts and run security regressions
