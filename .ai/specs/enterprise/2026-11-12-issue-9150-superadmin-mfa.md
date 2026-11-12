# Issue 9150: superadmin MFA target protection

Triage: Open, unassigned, no comments/atomic claim or implementing PR at initial check. Searches of open/closed PRs and origin/main found no implementation of #9150. Existing OSS grantChecks and enterprise cross-tenant MFA specification inspected.

Summary: Tenant security admins can inspect or reset an in-scope superadmin's MFA.

Root cause: reset/status routes invoke assertActorCanAccessSecurityUserTarget, which checks tenant/org ownership, but not target privilege. resetUserMfa command passes only scope to MfaAdminService. Sudo authenticates the actor; it does not grant authority over superadmins.

Files to change:
- api/users/[id]/mfa/reset/route.ts — apply existing core superadmin target guard after scope guard, before sudo/dispatch.
- api/users/[id]/mfa/status/route.ts — apply same guard after scope guard, before service read.
- commands/resetUserMfa.ts — scope target first with the existing decryption-aware query helper, then apply privilege guard before service mutation for direct invocation.
- api/users/__tests__/mfa-{reset,status}.route.test.ts — preserve existing route regressions.
- api/users/__tests__/superadmin-mfa-entrypoints.test.ts — exercise actual shared guard at all entrypoints, direct/role target grants, ordinary targets, superadmin actors, sudo denial.
- __integration__/TC-SEC-016-issue-9150.spec.ts — self-contained API fixtures verifying target protection and ordinary status/sudo behavior.

Approach: Reuse assertActorCanModifySuperAdminUserTarget with bound actor RBAC and trusted request context at all three real entrypoints. Retain sudo, tenant/org checks, service scopes and response schemas.

Risks: Target classification must include effective direct and role superadmin grants; actor superadmin bypass must use bound RBAC. Tests must prove forbidden calls never reach the status/reset service.

Migration & Backward Compatibility: No route/schema/signature/ACL/DB/config contract changes. This restores existing superadmin-account authorization policy on overlooked entrypoints. No compatibility waiver or bridge is needed; a tenant admin's accidental authority is the defect. Existing authorized superadmin and ordinary-user operations remain supported. No core/auth edits or migration required.

Plan: add guards and regression tests; run red/green and configured local gates; commit/publish dedicated PR; review and record QA/CI limits; release only owned claims. Plan mode is unavailable in this session; this is the recorded execution plan.

## Integration coverage
TC-SEC-016-issue-9150 creates security-admin and superadmin roles and three users, tests both affected routes for denied protected-target access and ordinary status/sudo behavior, then deletes all fixtures. Operator superadmin status remains supported. Direct command invocation and both direct/role grants are tested against the real core guard in Jest. No UI-rendering files change.

## Changelog
- 2026-11-12: Reused established target guard at all three entrypoints; added route/command regressions and API integration scenario. Validation and PR outcome recorded in the issue-specific run report.

## Parent review follow-up
The parent identified a scope-ordering disclosure in direct command invocation: checking a foreign target's privilege before service scoping could distinguish superadmins (403) from missing targets (404). The command now performs the same tenant/deleted/org preflight as MfaAdminService.loadUserForScope via findOneWithDecryption before any privilege lookup. The existing private service backstop stays intact, with no new public service API or signature.
Seven added regressions prove inaccessible/missing targets and missing actor tenant return 404 without ACL/role queries or reset mutation. They fail before the ordering correction and pass afterward.
