# Customer role assignment and deletion locking

## Problem

Issue #8736 identifies an authorization-state integrity race: staff role deletion counts active user-role links without serializing with assignment. A concurrent assignment can commit after that check, leaving a portal user holding a deleted role. Current RBAC excludes deleted roles, so this is an integrity and access-availability correction; no privilege escalation is claimed.

## Implementation

Reuse the existing staff-auth row-lock pattern inside `customer_accounts`. Every role assignment reads fresh live role rows with `PESSIMISTIC_WRITE` inside the transaction that persists the links. Multi-role lookups lock by ascending role ID. Deletion reads the same role under the same lock, then checks the default-role guard, optimistic version, and active holders before atomically soft-deleting the role and its ACL.

Writers covered:

- Admin user creation and role updates.
- Company portal user role assignment.
- Invitation acceptance.
- Public signup's default role assignment.
- Example-account seeding (one transaction per account).

If assignment wins, deletion retains its existing assigned-user `400`. If deletion wins, a later explicit assignment retains its existing missing-role `400`; invitation/signup/seeding continue their existing skip-missing-role behavior. Events and cache invalidation happen after the transaction commits.

## Migration & Backward Compatibility

No schema, migrations, dependencies, exported signatures, routes, startup commands or configuration change. Role creation now initializes its existing nullable updated_at version and returns the additive updatedAt field. List/detail and edit/delete/ACL guards consistently use created_at for historical null-version rows; successful writes replace that fallback with a normal updated_at version. Existing headerless callers remain supported. This enforces existing sequential guards when requests overlap. Seeding keeps its fixtures and inputs; only its persistence transaction is serialized with runtime role deletion. No operator or client migration is required.

## Validation

- Existing role-delete/default/optimistic-lock and tenant/organization-denial tests remain regression coverage.
- Unit regression pauses an assignment while deletion runs: deletion must wait and then refuse to delete the now-held role.
- `TC-PORTAL-011-role-deletion-race.spec.ts` uses a real PostgreSQL row lock, queues the admin assignment and deletion HTTP requests in both orders, verifies each existing `400` outcome, and checks persisted role/link state. It creates and cleans its own role and user fixtures.
- Relevant admin-create/update, portal-role, invitation and signup unit suites verify preserved behavior and transaction rollback/error paths.

## Risks

Same-role writers now wait for each other. Multi-role locks use ID order; example seeding holds only one role per transaction. The change does not repair historical links to already-deleted roles. A PostgreSQL-backed integration environment is needed to execute the deterministic HTTP concurrency test.

## Changelog

- 2026-11-05: Implemented transaction-scoped fresh role locking across deletion and all assignment writers; added race regression coverage for #8736.

- 2026-11-07: Addressed QA follow-up #8846: initialize role versions and guard historical null versions consistently; added legacy guard units and self-contained two-actor browser/API stale-first-save, ACL/delete refusal and reload/retry coverage in TC-CACC-ROLE-INITIAL-VERSION-001.
