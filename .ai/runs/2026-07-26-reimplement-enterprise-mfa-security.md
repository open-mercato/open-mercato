# Reimplement enterprise MFA security fixes

## Goal

Independently implement the two approved enterprise MFA security corrections on top of `develop` so they can ship without retaining external contribution attribution.

## Scope

- Fail closed when MFA-enforcement verification cannot determine a user's compliance, while retaining safe bypass and enrollment-page access.
- Require the established MFA-management feature for ordinary self-service MFA mutations, preserve provider enrollment while enforcement compels a non-compliant tenant user, ensure the default employee role retains voluntary self-service access, and document the upgrade action for existing tenants.
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

1. Require `security.mfa.manage` for ordinary self-service MFA management while conditionally exempting provider enrollment during active enforcement.
2. Preserve employee self-service access, document the existing-tenant ACL-sync action, and add route and enforcement-exemption coverage.

### Phase 3: Verification and delivery

1. Run targeted and full validation, then address review findings.
2. Publish the replacement PR and close the original contribution PRs as superseded.

## Progress

PR: #4530

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: MFA enforcement resilience

- [x] 1.1 Reimplement fail-closed redirect behavior for unavailable or failing enforcement checks — d16850c52
- [x] 1.2 Add regression coverage for failure, bypass, exempt-path, and tenant-scoping behavior — d16850c52

### Phase 2: MFA mutation authorization

- [x] 2.1 Require `security.mfa.manage` for ordinary self-service MFA management while keeping compelled provider enrollment reachable — fbea98972
- [x] 2.2 Preserve employee self-service access, document the existing-tenant ACL-sync action, and add route plus enforcement-exemption coverage — fbea98972

### Phase 3: Verification and delivery

- [x] 3.1 Run targeted and full validation, then address review findings — da1575c2b
- [x] 3.2 Publish the replacement PR and close the original contribution PRs as superseded — da6e44a4e
