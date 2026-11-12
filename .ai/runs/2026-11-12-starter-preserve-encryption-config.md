# Preserve configured encryption during starter environment creation

Goal: fix the current-main script-test regression blocking enterprise RLS PR #9353, in a separate mergeable PR.
Scope: remove duplicate starter fallback assignment introduced by #8377, retain the earlier encryption preservation logic from #8913, and strengthen the existing regression case. No RLS, production Compose, public API or pipeline change.

## Implementation Plan

1. Reproduce current-main fallback injection and remove only the duplicate assignment.
2. Verify fresh root/app key sharing, explicit keys, ambient/company values and Vault configuration; run the full configured local gate plus script tests.
3. Review and publish the standalone fix so a maintainer can merge it before rerunning #9353.

## Risks

Removing fresh-environment key generation would permit plaintext storage. Preserve `freshEnvironment` root generation and `suppliedSettings` propagation and prove the existing #8377 regression test still passes. Do not print fixture key values.

## Progress

### Phase 1: Fix and verification

- [ ] 1.1 Reproduce and remove duplicate fallback assignment.
- [ ] 1.2 Verify encryption preservation and the configured validation gate.
- [ ] 1.3 Review and publish the standalone fix PR.
