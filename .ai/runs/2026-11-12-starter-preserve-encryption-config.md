# Preserve configured encryption during starter environment creation

Goal: fix the current-main script-test regression blocking enterprise RLS PR #9353, in a separate mergeable PR.
Scope: remove duplicate starter fallback assignment introduced by #8377, retain the earlier encryption preservation logic from #8913, and strengthen the existing regression case. No RLS, production Compose, public API or pipeline change.

Source doc: .ai/specs/2026-11-06-setup-encryption-preflight.md

## Implementation Plan

1. Reproduce current-main fallback injection and remove only the duplicate assignment.
2. Verify fresh root/app key sharing, explicit keys, ambient/company values and Vault configuration; run the full configured local gate plus script tests.
3. Review and publish the standalone fix so a maintainer can merge it before rerunning #9353.

## Risks

Removing fresh-environment key generation would permit plaintext storage. Preserve `freshEnvironment` root generation and `suppliedSettings` propagation and prove the existing #8377 regression test still passes. Do not print fixture key values.

## Progress

PR: #9356

### Phase 1: Fix and verification

- [x] 1.1 Reproduce and remove duplicate fallback assignment.
- [x] 1.2 Verify encryption preservation and the configured validation gate — all eight commands passed on Node 24; 80 focused tests passed; full script suite: 1,662 passed / 4 standard skips / 0 failures.
- [x] 1.3 Review and publish the standalone fix PR — #9356; independent source review found no issues. GitHub CI is pending and maintainer approval is still required; no author self-approval is substituted.
