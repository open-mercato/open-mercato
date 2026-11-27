# Tenant-wide agent settings authorization

Issue: [#10700](https://github.com/open-mercato/open-mercato/issues/10700)  
Review follow-up: [PR #10786](https://github.com/open-mercato/open-mercato/pull/10786)

## Security invariant

Trace-capture and OTel-export settings are stored once per tenant and affect every
organization in that tenant. A write or replay therefore requires global access to
the exact write-feature set. An organization-restricted role must not gain this access
because another role contributes unrestricted visibility, because a separate role
contributes only some of the required features, or because a scoped role carries a
super-admin flag.

Use `RbacService.resolveFeatureOrganizationAccess` with the complete required feature
set. Its feature-specific `unrestricted` result is authoritative; a unioned ACL is not
sufficient. Keep current feature checks in the route, command authorization, and replay
paths so direct command execution and undo/redo preserve the same boundary.

## Migration & Backward Compatibility

This changes stable settings API and command behavior: principals whose required
features were granted only within selected organizations now receive `403` when they
change or replay tenant-wide settings. A compatibility bridge would leave those
cross-organization writes reachable, so the behavior change is limited to these
tenant-wide settings and follows the Emergency Security Exception in
`BACKWARD_COMPATIBILITY.md`.

Operators can restore access by assigning the complete required feature set through a
tenant-wide role (`organizations: null` or `__all__`) or by using a global super-admin.
A role scoped to one organization is insufficient, including a scoped super-admin
role. No client request shape, stored settings, or database schema changes; no data
migration is required. The operator migration is documented in `UPGRADE_NOTES.md`.

Named human maintainer acknowledgement for the exception is required before merge and
is pending; automated review does not satisfy this requirement.

## Regression coverage

- Feature-specific RBAC denies a mixed-role principal when the write features are
  scoped even though another role grants unrestricted organization visibility.
- Feature-specific RBAC denies a super-admin role scoped to one organization.
- Integration coverage exercises both tenant settings APIs for the scoped principals.
