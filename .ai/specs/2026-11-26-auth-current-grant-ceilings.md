# Current grant ceilings for staff administration

## Scope

Apply the actor's existing grant ceiling to the current target when staff
administrators modify account authority or replace a role or user ACL.

## Authorization

- The staff user command checks the current roles and direct ACLs after the
  existing authorization-state locks. This applies to credential and email
  changes, activation changes, membership changes and deletion.
- The role and user ACL commands check the stored ACL after taking the existing
  write lock and before persisting a replacement. The routes retain their
  existing checks on requested privileges.
- Routine profile edits and existing system call paths keep their authorization
  model. The target tenant and organization remain part of each grant check.

## Migration & Backward Compatibility

Request and success response shapes stay compatible. Staff and ACL administrators
outside the current target's grant ceiling receive the established HTTP 403
response. Allowing the previous write alongside this check would preserve
unauthorized modification of the target. The change has no data migration.
Operators should route affected administrative changes through an authorized
staff role. See the upgrade notes and the security exception in the
compatibility contract.

## Integration coverage

`TC-AUTH-current-grant-ceilings.spec.ts` exercises staff update and delete against
both role and direct grants, plus role and user ACL replacement with an actor
below the target's privileges. It verifies updates and role ACL replacement
within the actor's ceiling and uses a separately created tenant to confirm that
a denied cross-tenant update and delete leave the target record intact.
