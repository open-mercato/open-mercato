# Reimplement enterprise MFA security fixes

## Goal

Independently implement the two approved enterprise MFA security corrections on top of `develop` so they can ship without retaining external contribution attribution.

## Scope

- Fail closed when MFA-enforcement verification cannot determine a user's compliance, while retaining safe bypass and enrollment-page access.
- Require the established MFA-management feature for self-service MFA mutations, ensure the default employee role retains self-service access, and document the upgrade action for existing tenants.
- Add focused regression coverage and run the repository validation gate.

## Non-goals

- Change MFA policy semantics, route URLs, or the enterprise licensing boundary.
- Reproduce prior commits, authorship, or attribution metadata.

## Risks

MFA enforcement and authorization failures can lock users out. Regression tests must preserve the emergency bypass, exempt enrollment paths, tenant-less behavior, and intended default-role access.

## Implementation Plan

### Phase 1: MFA enforcement resilience

1. Reimplement fail-closed redirect behavior for unavailable or failing enforcement checks.
2. Add regression coverage for failure, bypass, exempt-path, and tenant-scoping behavior.

### Phase 2: MFA mutation authorization

1. Require `security.mfa.manage` on each self-service MFA mutation route.
2. Preserve employee self-service access, document the existing-tenant ACL-sync action, and add route metadata coverage.

### Phase 3: Verification and delivery

1. Run targeted and full validation, then address review findings.
2. Publish the replacement PR and close the original contribution PRs as superseded.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: MFA enforcement resilience

- [x] 1.1 Reimplement fail-closed redirect behavior for unavailable or failing enforcement checks — d16850c52
- [x] 1.2 Add regression coverage for failure, bypass, exempt-path, and tenant-scoping behavior — d16850c52

### Phase 2: MFA mutation authorization

- [x] 2.1 Require `security.mfa.manage` on each self-service MFA mutation route — c5d45ce5b
- [x] 2.2 Preserve employee self-service access, document the existing-tenant ACL-sync action, and add route metadata coverage — c5d45ce5b

### Phase 3: Verification and delivery

- [ ] 3.1 Run targeted and full validation, then address review findings
- [ ] 3.2 Publish the replacement PR and close the original contribution PRs as superseded
