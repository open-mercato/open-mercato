---
date: 2026-02-24
topic: sso-jit-role-sync
---

# SSO JIT Role Sync — Brainstorm

## What We're Building

Fix and verify that SSO role assignments from the IdP (Entra ID) are properly synchronized on each login. When a user's role changes in Entra (e.g., admin → employee), the change must be reflected in Open Mercato immediately upon next login.

## Bug Found

**Root cause:** `AuthService.getUserRoles()` in `packages/core/src/modules/auth/services/authService.ts:56` queries `UserRole` without filtering `deletedAt: null`. The `syncMappedRoles()` logic in the SSO module correctly soft-deletes stale `UserRole` records and removes their `SsoRoleGrant` tracking records, but `getUserRoles()` returns all records including soft-deleted ones.

**Impact:** After role changes in Entra, users accumulate roles instead of having them replaced. The JWT issued at login and session refreshes both include stale roles.

**Fix:** Added `deletedAt: null` to the `getUserRoles()` query filter (minimal core change).

## Key Decisions

- **Minimal core fix accepted**: Adding `deletedAt: null` to `getUserRoles` is the correct fix since the query is used everywhere (login, SSO callback, session refresh, profile API).
- **syncMappedRoles is correct**: The SSO role sync logic properly diffs `SsoRoleGrant` records, adds new roles, and removes stale ones on each login. The bug was in the reader, not the writer.
- **Manually assigned roles are preserved**: The `SsoRoleGrant` tracking table ensures only SSO-sourced roles are touched during sync. Roles assigned manually through the admin UI are untouched.

## SSO Role Sync Scenarios (verified in code)

| Scenario | Behavior |
|----------|----------|
| User gets role A in Entra, logs in | JIT provisions with role A, creates SsoRoleGrant(A) |
| Role changed to B in Entra, user logs in | syncMappedRoles removes A, adds B |
| User granted roles A+B in Entra | Both roles assigned via SsoRoleGrant |
| Role A revoked in Entra (only B remains) | syncMappedRoles removes A, keeps B |
| No matching roles from Entra | Login denied ("No roles could be resolved") |
| Manual role C added by admin | Untouched by SSO sync (no SsoRoleGrant for C) |

## Additional Issues Noted (not fixed yet)

Two other queries in core also miss `deletedAt: null` on `UserRole`:
1. `loadUserRoleNames()` at `commands/users.ts:725` — used in command undo/redo
2. `rbacService` at `services/rbacService.ts:195` — used for superadmin checks and feature resolution

These should be addressed separately.

## Open Questions

- Should `ssoRequired` enforcement be implemented (block password login for SSO domains)?
- Should the debug `console.log` statements in `oidc-provider.ts:68-70` be removed before merging?

## Next Steps

→ Test the fix by logging in with the changed Entra role and verifying only `employee` appears.
