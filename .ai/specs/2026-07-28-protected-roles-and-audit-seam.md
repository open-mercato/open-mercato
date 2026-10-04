# SPEC: Protected Roles and Audit Log Interceptor Context Seam

## TL;DR
Prevent lockouts in tenants by enforcing a minimum active holder floor constraint for critical roles (e.g., `'admin'`), and enable seamless audit log enrichment by allowing command interceptors to atomically contribute metadata.

## Overview
1. **Protected Roles**: Ensure that a tenant cannot drop below the configured minimum active holder count (e.g., 1 admin) due to user deletes, role updates, user moves, user deactivations, or the undo of any of those.
2. **Audit Seam**: Merge interceptor `beforeExecute` metadata `logContext` into `ActionLog.contextJson` with priority ordering and collision resolution.
3. **Replay Authorization**: Re-authorize auth command undo/redo against the actor's current grants and the target's current state before any replay write or event.

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
- Auth user/role undo and redo opt into the command bus's atomic replay contract. Their pre-claim authorization, source-log claim/final transition, repeated mutation-time authorization, domain write, undo trace or redo log, and redo source finalization all use one transactional `EntityManager`; any failure rolls the entire unit back.
- Transaction-bound replay authorization bypasses RBAC caches and never calls a service path that forks. `CommandHandler.stabilizeReplay` discovers the complete actor, target, and before/after destination footprint before the first pessimistic lock, then acquires it once in the global order `ApiKey` → `User` → `Role` → `Tenant` → `Organization` → `UserRole` → `UserAcl` → `RoleAcl`, sorting identifiers within every class. The sealed lease rejects any later target extension, while a changed API-key role or membership discovery rolls back with `409` instead of appending an earlier-rank lock. The replay guard, feature-gated interceptors, endpoint checks, and mutation authorization all run after this stabilization on the same `EntityManager`.
- Every runtime `UserRole`, `UserAcl`, and `RoleAcl` writer follows the same parent-first protocol. This includes auth user/role/ACL commands, auth CLI and setup, execution-principal provisioning, enterprise SSO account linking, and agent-principal provisioning. SSO membership and its `SsoRoleGrant` diff now commit in one transaction. Parent locks close the empty-child phantom gap: a concurrent membership or ACL insert must acquire the same user or role parent before it can create a row.
- API-key deletion, session-key deletion, and one-time-key cleanup lock the `ApiKey` parent before mutation. Role and `RoleAcl` writers lock every live API key referencing the affected role before the role parent; organization writers and replay lock the tenant row as an insertion sentinel followed by the live hierarchy. Organization ancestry is read through the caller's exact transactional `EntityManager`, with no connection-pool escape.
- Action logs retain the UUID-compatible `actor_user_id` column and persist the canonical principal in `context.actorSubject`. API-key callers therefore use `api_key:<uuid>` consistently for ownership, exact-EM RBAC, locking, self-list filtering, undo, and redo. A legacy bare UUID is accepted as API-key self ownership only when the live auth tuple is coherent (`isApiKey`, `keyId`, and `sub` agree); malformed or mixed tuples fail closed.
- Password-bearing `auth.users.create` and `auth.users.update` executions are audit-only: their action logs carry no undo token or persisted command payload, so raw passwords and credential hashes cannot become replay material. Historical password-bearing logs fail closed on both undo and redo.
- Replaying a role tenant move requires the actor's current canonical superadmin grant, matching the forward command even when the destination snapshot has no ACL rows to restore.
- `packages/core/src/modules/auth/lib/sessionIntegrity.ts` invalidates deactivated users' sessions.
- `packages/core/src/modules/auth/api/login.ts` denies login to deactivated users.
- `CommandHandler.authorizeReplay` is an additive, optional hook invoked before an undo claim and before redo processing. Auth handlers use it to resolve current RBAC grants, target scope, protected-target state, grant boundaries, and snapshot freshness.
- `CommandHandler.atomicReplay` is an additive opt-in. For opted-in handlers the command bus supplies `ctx.transactionalEm` and owns the replay transaction. Handlers that omit it keep the legacy claim/release and redo-finalization flow unchanged.
- `CommandLogMetadata.replayable: false` records an audit entry without an undo token or command payload. Auth password updates use this per execution, so unrelated user updates remain replayable while credential input is never retained for replay.

### Replay authorization contract

- For atomic auth handlers, undo/redo authorization runs inside the replay transaction before the guarded source transition. A denial therefore rolls back without changing the action-log execution state. The handler repeats authorization after canonical locks are held, closing a tenant/grant change between the first check and mutation.
- Auth replay requires the current semantic inverse permission (`create` undo requires delete authority, delete undo requires create authority, and updates require edit/manage authority). A self-service, non-password profile update remains authorized for the same user without gaining administrative edit authority.
- Existing action logs are covered because authorization is evaluated when the log is replayed, not only when it is created.
- Replay fails with `409` when the live target no longer matches the state the stored action expects. Denial occurs before domain writes and events.
- Scalar role update undo restores only scalar/custom-field changes. It does not restore an ACL snapshot unless the original command moved the role between tenants; ACL restoration paths additionally require current `auth.acl.manage` and current grant-boundary validation.
- Password-bearing `auth.users.update` executions are non-replayable. Historical password-bearing update logs are rejected by the replay guard, and new entries retain neither plaintext redo input nor credential snapshots.

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
- **Locking deadlocks** — *Severity: high, area: auth commands.* Inverse actor-target replay pairs previously took actor locks first and target locks later. Replay now predeclares and seals one total footprint, uses the canonical API-key → user → role → tenant → organization → child-row order, sorts every class by id, and requires membership, ACL, setup, CLI, SSO, and principal writers to use the compatible protocol. Residual risk: low.
- **Lock contention on a hot path** — *Severity: medium, area: `auth.users.update`.* Every profile save routes through this command. Mitigated by the skip conditions above, so only mutations that can actually reduce the holder count take the lock. Residual risk: low.
- **Information leakage** — *Severity: medium, area: cross-tenant probing.* Scoped commands return `404` for cross-tenant targets before executing floor checks, so the floor error never confirms the existence of a foreign user. Residual risk: low.
- **Superadmin cannot remove a tenant's last admin** — *Severity: low, area: platform operations.* The floor is deliberately enforced for superadmins too: a superadmin slip would lock a tenant out with no guard, and the failure mode of being blocked is recoverable while the lockout is not. Operators offboarding a tenant should delete the tenant rather than its last admin, or promote a second admin first. Internal automation uses `ctx.systemActor`. Residual risk: accepted.
- **Holder counting reads unbounded rows** — *Severity: low, area: `enforceProtectedRoleFloor`.* The active-holder query selects one row per link. Mitigated by dropping `populate: ['user']`, which keeps the rows narrow and — importantly — avoids `decryptEntityGraph` walking into every admin's encrypted `email`/`name` on each check. Tenant scoping is enforced by the query's nested `user.tenantId` filter. Residual risk: low.
- **Replay authorization can race with a tenant/grant change** — *Severity: high, area: auth command replay.* Auth replay uses one exact transactional `EntityManager` for both authorization passes and the mutation; no cache-backed, forking, or raw-pool RBAC path is reachable. It locks API keys, users, roles, authorization children, and organization hierarchy before interceptor eligibility is resolved. Compatible writers take the same parent locks, so key deletion, role/ACL mutation, tenant move, organization reparent, or feature grant/revoke either commits before the locked recheck and is observed, or waits until replay commits. Time-based API-key expiry and freshly read `rolesJson`/`RoleAcl` snapshots fail closed. Residual risk: low.
- **Replay log/domain split-brain** — *Severity: high, area: command bus.* A process or database failure between a domain replay and source-log finalization could previously leave the domain changed while the source remained retryable (or vice versa). Auth handlers opt into a single database transaction spanning source claim/final state, domain changes, undo trace or new redo log, and redo's source mark. Legacy non-auth handlers intentionally retain their prior compensating behavior; there is no claim that all command logs are atomic. Residual risk for auth replay: low.

## Future Work
- `minActiveHolders` is currently seeded (`1` for `admin`, `0` otherwise) and backfilled by migration; there is no API or UI to configure it per role. Exposing it on the roles CRUD surface is deliberately out of scope for this change.
- Before `minActiveHolders` becomes configurable for high-cardinality roles, replace the in-memory distinct-user count with `COUNT(DISTINCT user_id)` plus a targeted membership check so the locked section remains constant-space.
- Enterprise SSO tracks deprovisioning in `SsoUserDeactivation`, not `isConfirmed`, so a SCIM-deprovisioned admin still counts as an active holder. Reconciling the two notions of "deactivated" is tracked separately.

## Integration Coverage
- `packages/core/src/modules/auth/__integration__/TC-AUTH-054-protected-role-floor.spec.ts` — covers `PUT /api/auth/users` (role removal, deactivation), `DELETE /api/auth/users`, rejection of `DELETE /api/auth/roles` while the protected role has an assigned holder, `POST /api/auth/login` rejection of deactivated users, `GET /api/auth/profile` session invalidation, cross-tenant `404`s on both `PUT` and `DELETE`, and the two-contender concurrency case.
- `packages/core/src/modules/auth/__integration__/TC-AUTH-065-atomic-replay-concurrency.spec.ts` — uses independent PostgreSQL connections for ten bounded races: tenant move recheck, action-log finalization rollback, exactly-one-of-two undo contenders, inverse user actor/target replay, inverse API-key/role replay with self-only grants, API-key deletion, canonical `UserRole` insertion, `RoleAcl` insertion, organization reparent, and a concurrent feature grant that makes a blocking interceptor newly applicable.
- Unit coverage:
  - `packages/shared/src/lib/commands/__tests__/command-bus.atomic-replay.test.ts`
  - `packages/shared/src/lib/commands/__tests__/command-bus.test.ts`
  - `packages/core/src/modules/auth/commands/__tests__/replay-authorization.test.ts`
  - `packages/core/src/modules/auth/commands/__tests__/roles.tenant-move.test.ts`
  - `packages/core/src/modules/auth/commands/__tests__/users.protected-role-floor.test.ts`
  - `packages/core/src/modules/auth/api/__tests__/login.test.ts`
  - `packages/core/src/modules/auth/lib/__tests__/setup-app.protected-roles.test.ts`
  - `packages/core/src/modules/auth/lib/__tests__/authorizationStateLocks.test.ts`
  - `packages/core/src/modules/auth/lib/__tests__/authorizationStateWriterCoverage.test.ts`
  - `packages/core/src/modules/directory/lib/__tests__/hierarchy-lock.test.ts`
  - `packages/core/src/modules/api_keys/services/__tests__/apiKeyService.delete.test.ts`

## Migration & Backward Compatibility
- **Database Schema**: Column `min_active_holders` is added as `not null default 0`. This is additive and fully backward compatible.
- **Data Backfill**: Migration runs an update statement setting `min_active_holders = 1` for any active `admin` role in existing tenants. `Role.name` is not an encrypted field (see `auth/encryption.ts`), so the plaintext `where "name" = 'admin'` match is correct.
- **Contract Surface**: `isConfirmed` is added as an optional field in `userUpdateSchema` and as a returned field on `userListItemSchema` (both additive, non-breaking).
- **Login behavior**: `POST /api/auth/login` and `resolveCanonicalStaffAuthContext` now reject users with `isConfirmed === false`. `User.isConfirmed` defaults to `true` and no seeding path sets it to `false`, so no existing account loses access; documented in `UPGRADE_NOTES.md`.
- **Audit context merge**: `ActionLog.contextJson` is now a shallow merge of `options.metadata.context`, interceptor `logContext`, and `buildLog().context`, where previously `buildLog().context` replaced the base wholesale. Documented in `UPGRADE_NOTES.md`.
- **Command handler contract**: `CommandHandler.authorizeReplay`, `CommandHandler.atomicReplay`, `CommandHandler.stabilizeReplay`, `CommandLogMetadata.replayable`, and `CommandExecuteResult.replaySourceFinalized` are additive optional fields. Existing handlers and log builders compile and retain their previous replay behavior when they omit them.
- **Service seams**: `RbacService.loadAclWithEntityManager`, `userHasAllFeaturesWithEntityManager`, and `getGrantedFeaturesWithEntityManager` are additive exact-EM APIs. `CommandRuntimeContext.replayTransactionGuard` is an additive optional request guard that atomic handlers bind to the replay transaction and rerun after auth locks. `ActionLogService.log`, `claimForUndo`, `releaseUndoClaim`, and `markUndone` gain an optional trailing `EntityManager`; `claimForRedo` is additive. Existing callers preserve their prior behavior.
- **Stored action logs**: no migration or backfill is required. New user/API-key entries add `context.actorSubject` while `actor_user_id` remains a UUID. Existing bare-UUID entries remain readable; API-key self replay additionally requires a coherent live API-key auth tuple. Current authorization and freshness checks apply when any existing auth log is replayed. Historical password-update logs stop being replayable by design; this is the vulnerable behavior being removed, not a request/response or schema change.
- **Audit-log persistence**: entries marked `replayable: false` continue to record action metadata and before/after display snapshots, but omit `undoToken` and `commandPayload`. Consumers already treat a missing token as non-undoable.
- **HTTP behavior**: replay endpoints keep their URLs and response schemas. They may now return the already-supported domain `403`/`409` rejection when current authority or expected target state no longer permits replay.

## Changelog
- **2026-07-28**: Initial spec drafted.
- **2026-08-01**: Expanded spec to document locking, deactivation semantics, and backward compatibility.
- **2026-08-04**: Carried forward after review. Added undo-path enforcement, skip conditions and the `systemActor` bypass, renamed the interceptor audit key to `logContext`, documented the superadmin constraint and holder-count query shape, and expanded integration coverage and BC notes.
- **2026-08-06**: Merged the latest `develop`, moved undo tenant reads inside their protected-role transactions, documented the residual move race and holder-count scaling boundary, and pinned the existing role-delete assignment guard with unit and API integration coverage.
- **2026-10-04**: Added the fail-closed auth replay contract and closed its review gaps: password-bearing user create/update logs are audit-only and legacy credential logs fail closed; current privilege/target/freshness checks repeat under transaction-local target/grant locks; role tenant-move replay requires current canonical superadmin authority even for empty ACL snapshots; regressions prove denial has no write or event side effects while safe replay remains functional.
- **2026-10-04 (review remediation)**: Bound every auth replay authorization read to the mutation transaction, changed membership/ACL locking to canonical user-parent → role-parent → child-row order, made auth undo/redo domain and action-log transitions atomic, and added real PostgreSQL race/rollback/contender coverage. Non-auth replay compatibility remains unchanged.
- **2026-10-04 (final TOCTOU remediation)**: Extended canonical replay locking to API-key principals and organization hierarchy, aligned API-key/role/ACL/hierarchy writers, and moved feature-gated replay interceptor resolution behind the stabilized authorization snapshot. Expanded the PostgreSQL suite from three to six multi-connection races.
- **2026-10-04 (containment completion)**: Replaced partial actor-then-target locking with a single sealed total footprint, added a tenant insertion sentinel and repository-wide membership/ACL writer adoption, made SSO membership/grant sync atomic, canonicalized API-key audit subjects with safe legacy handling, and expanded PostgreSQL coverage with inverse and insertion-phantom races.
