# SPEC: Protected Roles and Audit Log Interceptor Context Seam

## TL;DR
Prevent lockouts in tenants by enforcing a minimum active holder floor constraint for critical roles (e.g., `'admin'`), and enable seamless audit log enrichment by allowing command interceptors to atomically contribute metadata.

## Overview
1. **Protected Roles**: Ensure that a tenant cannot drop below the configured minimum active holder count (e.g., 1 admin) due to user deletes, role updates, user moves, user deactivations, or the undo of any of those.
2. **Audit Seam**: Merge interceptor `beforeExecute` metadata `logContext` into `ActionLog.contextJson` with priority ordering and collision resolution.

## Problem Statement
- A tenant administrator can accidentally delete, deactivate, or strip roles from the last active administrator account in a tenant. This leads to administrative lockouts.
- Downstream applications cannot stamp caller metadata (IP, user agent) onto audit logs created by core CRUD commands without ejecting or writing wrappers around core routes.

## Proposed Solution
- Add a `minActiveHolders` column to the `Role` entity defaulting to `0` (non-null), set to `1` for the critical `'admin'` role.
- Enforce the floor checks atomically using database-level pessimistic write locks on roles inside the command transaction.
- Deny authentication (login) for deactivated users (`isConfirmed: false`) and terminate active sessions.
- In `CommandBus`, merge interceptor metadata `logContext` with the precedence: `options.metadata.context` -> `interceptorContexts` -> `logMeta.context`.

## Architecture
- `packages/shared/src/lib/commands/command-bus.ts` handles precedence merging.
- `packages/core/src/modules/auth/commands/users.ts` implements transaction-bound floor checks using `LockMode.PESSIMISTIC_WRITE` on `Role` rows.
- `packages/core/src/modules/auth/lib/sessionIntegrity.ts` invalidates deactivated users' sessions.
- `packages/core/src/modules/auth/api/login.ts` denies login to deactivated users.

### Enforcement points
`enforceProtectedRoleFloor` runs in every command path that can reduce a tenant's active holder count, always inside the command's `withAtomicFlush(..., { transaction: true })` block so the row lock is valid:

| Command path | Options passed |
|---|---|
| `auth.users.update` (execute) | `{ deactivating: isConfirmed === false \|\| isTenantChanging, newRoles: parsed.roles }` |
| `auth.users.delete` (execute) | `{ deleting: true }` |
| `auth.users.update` (undo) | `{ deactivating: before.isConfirmed === false \|\| isTenantChanging, newRoles: before.roles }` |
| `auth.users.create` (undo) | `{ deleting: true }` |
| `auth.roles.delete` (execute) | The existing assignment guard rejects any role with a non-deleted `UserRole` assignment, which is stricter than checking protected roles alone. |

Undo is a first-class, user-reachable operation (`POST /api/audit_logs/audit-logs/actions/undo`), so skipping it there would leave the guard trivially bypassable: promote a second admin, delete the first, then undo the promotion.

### Skip conditions
The lock and the holder queries are skipped entirely when the operation cannot reduce the holder count — `isConfirmed` untouched, `roles` absent, and the tenant unchanged. Without this gate every `auth.users.update` (including every self-service `PUT /api/auth/profile` password change, which routes through the same command) would take a tenant-wide `SELECT … FOR UPDATE` on the protected role rows and serialize all user edits in the tenant.

`ctx.systemActor === true` bypasses the floor so internal automation (CLI, migrations, tenant teardown) is never blocked. Superadmins are **not** exempt — see Risks.

## Data Model
- `roles` table: Add `min_active_holders` column (`int not null default 0`).
- Snapshots updated: `.snapshot-open-mercato.json`.

## API Contracts
- `PUT /api/auth/users` (`userUpdateSchema`): Accepts `isConfirmed?: boolean` to support user deactivation.
- `GET /api/auth/users` (`userListItemSchema`): Returns `isConfirmed: boolean` so the deactivation state an operator can set is also observable.
- Both `PUT` and `DELETE /api/auth/users` can return `400` with the localized `auth.users.errors.lastHolderOfCriticalRole` message when the floor would be breached.

## Risks & Mitigations
- **Locking deadlocks** — *Severity: high, area: auth commands.* Two concurrent user mutations in the same tenant lock the same role rows. Mitigated by locking in deterministic primary-key order (`orderBy: { id: 'ASC' }`) and by taking the `Role` lock before any `User`/`UserRole` write, so every path acquires locks in the same order. Residual risk: low.
- **Lock contention on a hot path** — *Severity: medium, area: `auth.users.update`.* Every profile save routes through this command. Mitigated by the skip conditions above, so only mutations that can actually reduce the holder count take the lock. Residual risk: low.
- **Information leakage** — *Severity: medium, area: cross-tenant probing.* Scoped commands return `404` for cross-tenant targets before executing floor checks, so the floor error never confirms the existence of a foreign user. Residual risk: low.
- **Superadmin cannot remove a tenant's last admin** — *Severity: low, area: platform operations.* The floor is deliberately enforced for superadmins too: a superadmin slip would lock a tenant out with no guard, and the failure mode of being blocked is recoverable while the lockout is not. Operators offboarding a tenant should delete the tenant rather than its last admin, or promote a second admin first. Internal automation uses `ctx.systemActor`. Residual risk: accepted.
- **Holder counting reads unbounded rows** — *Severity: low, area: `enforceProtectedRoleFloor`.* The active-holder query selects one row per link. Mitigated by dropping `populate: ['user']`, which keeps the rows narrow and — importantly — avoids `decryptEntityGraph` walking into every admin's encrypted `email`/`name` on each check. Tenant scoping is enforced by the query's nested `user.tenantId` filter. Residual risk: low.
- **Undo tenant resolution can race with a tenant move** — *Severity: medium, area: user command undo.* Both undo handlers now read the user's current tenant inside the same transaction that takes the protected-role lock. The user row is deliberately not locked first because forward mutations lock protected roles before writing the user, and reversing that order would introduce a deadlock cycle. A concurrent move can still commit between the user read and the role lock, leaving a narrow residual stale-tenant window. Residual risk: low; closing it requires a retry/revalidation protocol that preserves the global lock order.

## Future Work
- `minActiveHolders` is currently seeded (`1` for `admin`, `0` otherwise) and backfilled by migration; there is no API or UI to configure it per role. Exposing it on the roles CRUD surface is deliberately out of scope for this change.
- Before `minActiveHolders` becomes configurable for high-cardinality roles, replace the in-memory distinct-user count with `COUNT(DISTINCT user_id)` plus a targeted membership check so the locked section remains constant-space.
- Enterprise SSO tracks deprovisioning in `SsoUserDeactivation`, not `isConfirmed`, so a SCIM-deprovisioned admin still counts as an active holder. Reconciling the two notions of "deactivated" is tracked separately.

## Integration Coverage
- `packages/core/src/modules/auth/__integration__/TC-AUTH-054-protected-role-floor.spec.ts` — covers `PUT /api/auth/users` (role removal, deactivation), `DELETE /api/auth/users`, rejection of `DELETE /api/auth/roles` while the protected role has an assigned holder, `POST /api/auth/login` rejection of deactivated users, `GET /api/auth/profile` session invalidation, cross-tenant `404`s on both `PUT` and `DELETE`, and the two-contender concurrency case.
- Unit coverage:
  - `packages/shared/src/lib/commands/__tests__/command-bus.test.ts`
  - `packages/core/src/modules/auth/commands/__tests__/roles.tenant-move.test.ts`
  - `packages/core/src/modules/auth/commands/__tests__/users.protected-role-floor.test.ts`
  - `packages/core/src/modules/auth/api/__tests__/login.test.ts`
  - `packages/core/src/modules/auth/lib/__tests__/setup-app.protected-roles.test.ts`

## Migration & Backward Compatibility
- **Database Schema**: Column `min_active_holders` is added as `not null default 0`. This is additive and fully backward compatible.
- **Data Backfill**: Migration runs an update statement setting `min_active_holders = 1` for any active `admin` role in existing tenants. `Role.name` is not an encrypted field (see `auth/encryption.ts`), so the plaintext `where "name" = 'admin'` match is correct.
- **Contract Surface**: `isConfirmed` is added as an optional field in `userUpdateSchema` and as a returned field on `userListItemSchema` (both additive, non-breaking).
- **Login behavior**: `POST /api/auth/login` and `resolveCanonicalStaffAuthContext` now reject users with `isConfirmed === false`. `User.isConfirmed` defaults to `true` and no seeding path sets it to `false`, so no existing account loses access; documented in `UPGRADE_NOTES.md`.
- **Audit context merge**: `ActionLog.contextJson` is now a shallow merge of `options.metadata.context`, interceptor `logContext`, and `buildLog().context`, where previously `buildLog().context` replaced the base wholesale. Documented in `UPGRADE_NOTES.md`.

## Changelog
- **2026-07-28**: Initial spec drafted.
- **2026-08-01**: Expanded spec to document locking, deactivation semantics, and backward compatibility.
- **2026-08-04**: Carried forward after review. Added undo-path enforcement, skip conditions and the `systemActor` bypass, renamed the interceptor audit key to `logContext`, documented the superadmin constraint and holder-count query shape, and expanded integration coverage and BC notes.
- **2026-08-06**: Merged the latest `develop`, moved undo tenant reads inside their protected-role transactions, documented the residual move race and holder-count scaling boundary, and pinned the existing role-delete assignment guard with unit and API integration coverage.
