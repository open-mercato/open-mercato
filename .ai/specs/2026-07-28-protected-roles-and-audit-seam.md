# SPEC: Protected Roles and Audit Log Interceptor Context Seam

## TL;DR
Prevent lockouts in tenants by enforcing a minimum active holder floor constraint for critical roles (e.g., `'admin'`), and enable seamless audit log enrichment by allowing command interceptors to atomically contribute metadata.

## Overview
1. **Protected Roles**: Ensure that a tenant cannot drop below the configured minimum active holder count (e.g., 1 admin) due to user deletes, role updates, user moves, or user deactivations.
2. **Audit Seam**: Merge interceptor `beforeExecute` metadata `context` into `ActionLog.contextJson` with priority ordering and collision resolution.

## Problem Statement
- A tenant administrator can accidentally delete, deactivate, or strip roles from the last active administrator account in a tenant. This leads to administrative lockouts.
- Downstream applications cannot stamp caller metadata (IP, user agent) onto audit logs created by core CRUD commands without ejecting or writing wrappers around core routes.

## Proposed Solution
- Add a `minActiveHolders` column to the `Role` entity defaulting to `0` (non-null), set to `1` for the critical `'admin'` role.
- Enforce the floor checks atomically using database-level pessimistic write locks on roles inside the command transaction.
- Deny authentication (login) for deactivated users (`isConfirmed: false`) and terminate active sessions.
- In `CommandBus`, merge interceptor metadata `context` with the precedence: `options.metadata.context` -> `interceptorContexts` -> `logMeta.context`.

## Architecture
- `packages/shared/src/lib/commands/command-bus.ts` handles precedence merging.
- `packages/core/src/modules/auth/commands/users.ts` implements transaction-bound floor checks using `LockMode.PESSIMISTIC_WRITE` on `Role` rows.
- `packages/core/src/modules/auth/lib/sessionIntegrity.ts` invalidates deactivated users' sessions.
- `packages/core/src/modules/auth/api/login.ts` denies login to deactivated users.

## Data Model
- `roles` table: Add `min_active_holders` column (`int not null default 0`).
- Snapshots updated: `.snapshot-open-mercato.json`.

## API Contracts
- `PUT /api/auth/users` (`userUpdateSchema`): Accepts `isConfirmed?: boolean` to support user deactivation.

## Risks & Mitigations
- **Locking Deadlocks**: Lock roles in a deterministic order (`orderBy: { id: 'ASC' }`).
- **Information Leakage**: Scoped commands return `404` for cross-tenant targets before executing floor checks.

## Integration Coverage
- Covered in unit and integration test suites:
  - `packages/shared/src/lib/commands/__tests__/command-bus.test.ts`
  - `packages/core/src/modules/auth/commands/__tests__/users.protected-role-floor.test.ts`

## Migration & Backward Compatibility
- **Database Schema**: Column `min_active_holders` is added as `not null default 0`. This is additive and fully backward compatible.
- **Data Backfill**: Migration runs an update statement setting `min_active_holders = 1` for any active `admin` role in existing tenants.
- **Contract Surface**: `isConfirmed` is added as an optional field in `userUpdateSchema` (additive, non-breaking).

## Changelog
- **2026-07-28**: Initial spec drafted.
- **2026-08-01**: Expanded spec to document locking, deactivation semantics, and backward compatibility.
