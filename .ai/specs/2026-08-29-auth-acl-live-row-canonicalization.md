# Auth ACL Live-Row Canonicalization

## TLDR

Auth ACL resolution must treat exactly one non-deleted `user_acls` row per `(user_id, tenant_id)` and one non-deleted `role_acls` row per `(role_id, tenant_id)` as current. The change repairs historical duplicates, enforces that invariant with PostgreSQL partial unique indexes, and makes every authorization, target-protection, setup, API, and undo reader ignore revoked rows.

## Problem Statement

The ACL tables historically allowed duplicate live rows for the same principal and tenant. Reads were consequently order-dependent, and adding soft-delete-based uniqueness without updating every consumer would leave remediated duplicates behaviorally active in some paths.

## Proposed Solution

Choose the most recently changed row in each duplicate live group, soft-delete the rest, then create partial unique indexes over live rows only. Apply the same `deleted_at IS NULL` and live-role-membership semantics to every current-state reader while preserving historical rows for auditability.

## Overview

This is one coupled auth integrity capability: canonical live ACL resolution. The migration is unsafe without the reader changes, and the reader changes cannot prevent future ambiguity without the indexes, so they ship together.

PostgreSQL is the relevant reference implementation. Its official documentation supports partial unique indexes as the native way to enforce uniqueness over only rows satisfying a predicate. The design adopts that mechanism and rejects application-only deduplication because concurrent writers could still create multiple live rows. See [PostgreSQL partial indexes](https://www.postgresql.org/docs/current/indexes-partial.html) and [unique indexes](https://www.postgresql.org/docs/current/indexes-unique.html).

## Architecture

### Migration

`Migration20260828120000_auth.ts` performs the following operations for both ACL tables inside the migration transaction:

1. Partition live rows by principal ID and tenant ID.
2. Rank each partition by `coalesce(updated_at, created_at) DESC`, then `created_at DESC`, then `id DESC`.
3. Set `deleted_at` on every row ranked after the winner.
4. Create a partial unique index on the principal/tenant pair with `WHERE deleted_at IS NULL`.

The deterministic tie-breaker makes reruns select the same winner. Soft deletion preserves the superseded records for audit and diagnosis.

### Runtime reads

Every path that asks for current ACL state includes `deletedAt: null`:

- human and API-key grant resolution in `RbacService`;
- super-admin target protection and exclusion lists in `grantChecks.ts`;
- role/user ACL GET and PUT routes;
- protected role filtering in the roles list;
- setup reconciliation;
- command snapshots used by delete/update undo.
- notification role/feature recipient resolution.

Role-derived grants additionally require a live `user_roles` link and a live `roles` row. This matches the canonical session-integrity resolver.

Entity loads in target guards continue to omit a target `deletedAt` predicate intentionally so a deleted privileged target remains protected from non-super-admin mutation, but the loads use `findOneWithDecryption` as required by the auth data policy.

### Cache behavior

No cache key or TTL changes. Existing ACL write commands invalidate user or tenant RBAC tags. Migration deployment requires application instances to restart or begin with empty process-local ACL caches, which is the standard deployment behavior.

## Data Models

No columns or relationships change.

| Table | Live-row invariant | Historical rows |
|---|---|---|
| `user_acls` | At most one row per `(user_id, tenant_id)` where `deleted_at IS NULL` | Preserved with non-null `deleted_at` |
| `role_acls` | At most one row per `(role_id, tenant_id)` where `deleted_at IS NULL` | Preserved with non-null `deleted_at` |

The partial indexes are raw SQL migration artifacts because MikroORM metadata does not express the required soft-delete predicate. Entity comments point maintainers to the migration as the source of truth; generated snapshots intentionally remain unchanged.

No new sensitive fields are introduced. Reads of `User`, `Role`, `UserRole`, `UserAcl`, and `RoleAcl` continue through the module's decryption-aware helpers where required.

## API Contracts

No route, request, response, status-code, OpenAPI, event, ACL feature, or import-path contract changes.

- `GET /api/auth/users/acl` returns the one live ACL row or the existing empty response.
- `PUT /api/auth/users/acl` updates the one live row or creates one when only revoked history exists.
- `GET /api/auth/roles/acl` returns the one live ACL row or the existing empty response.
- `PUT /api/auth/roles/acl` updates the one live row or creates one when only revoked history exists.
- User and role list responses retain their current shapes; only revoked grants and memberships stop affecting protection filters.

Optimistic-lock versions continue to come from the selected live ACL row.

## UI/UX and Internationalization

No UI or user-facing string changes. Existing forms and conflict handling continue unchanged.

## Migration & Backward Compatibility

The change is additive under `BACKWARD_COMPATIBILITY.md`: it adds indexes and narrows current-state reads to rows already defined as live. No public surface is removed or renamed.

The migration `up()` remediation is intentionally not data-reversible: `down()` drops the partial indexes but does not clear `deleted_at`, because doing so would reactivate ambiguous and potentially privileged rows. The historical payload remains stored, so an operator can inspect or explicitly restore a chosen row after rollback.

Rolling deployments must ship migration and reader changes as one release. An old process running briefly after remediation may still read a newly revoked duplicate; deployment orchestration must drain/restart old instances and clear process-local RBAC caches. The new application code remains compatible before and after the migration because explicit live-row predicates work without the indexes.

Standard `CREATE UNIQUE INDEX` is used because project migrations run transactionally and PostgreSQL does not permit `CREATE INDEX CONCURRENTLY` inside a transaction. Operators should schedule the migration with awareness that writes to the two ACL tables may briefly block while each index builds.

## Implementation Plan

### Phase 1: Canonical live ACL state

1. Add deterministic duplicate remediation and partial unique indexes for both ACL tables.
2. Audit every live ACL, role-membership, setup, API, and snapshot consumer and add explicit lifecycle predicates.
3. Align grant, session, and target-protection semantics for revoked links and roles.
4. Add focused unit and route tests, then run auth integration coverage and the package validation gate.

All four steps ship together; no intermediate phase is independently deployable without weakening the invariant.

### Testing Strategy

- Migration SQL: verify deterministic ranking, live-row predicates, index names, and rollback statements.
- Unit: direct/role super-admin grants, foreign-tenant grants, soft-deleted ACLs, soft-deleted assignments, soft-deleted roles, API-key ACLs, deterministic selection, and target protection.
- Route: user/role ACL GET and PUT queries must carry `deletedAt: null`; role list protection must do the same.
- Command: user and role snapshots must exclude revoked ACL history so undo cannot reactivate it or violate the new indexes.
- Setup: reconciliation must ignore revoked ACL history and create/update the one live row.
- Integration: existing `TC-AUTH-051`, `TC-AUTH-043`, `TC-AUTH-049`, `TC-AUTH-058`, `TC-LOCK-OSS-031`, and `TC-LOCK-OSS-032` cover the affected user/role ACL writes, reads, audit trail, and optimistic locking. These routes remain the manual QA surface after deployment.

## Risks & Impact Review

#### Stale duplicate remains authoritative in an unreviewed consumer
- **Scenario**: A reader omits `deleted_at IS NULL` and returns or grants from a row remediated by the migration.
- **Severity**: High
- **Affected area**: Auth grants, API keys, ACL forms, setup, commands, and protected-target filters
- **Mitigation**: Complete consumer audit plus query-shape and behavior regression tests for every consumer class.
- **Residual risk**: Future raw ACL queries can regress; entity comments and partial-index names make the live-row contract discoverable in review.

#### Revoked membership still confers super-admin
- **Scenario**: A soft-deleted `user_roles` link or `roles` row is populated and used to derive a live role ACL grant.
- **Severity**: High
- **Affected area**: Session authorization, RBAC service, super-admin target protection, and list exclusions
- **Mitigation**: Require both link and role `deletedAt: null` in every role-derived resolver and test each revoked state.
- **Residual risk**: None known within the auth module; cross-module consumers remain covered by the module-decoupling and security review gates.

#### Index creation blocks ACL writes
- **Scenario**: A large ACL table makes transactional index creation hold a write-conflicting lock longer than the deployment window allows.
- **Severity**: Medium
- **Affected area**: Role and user permission administration during deployment
- **Mitigation**: Inspect table cardinality before production rollout, schedule the migration appropriately, and monitor migration duration and blocked sessions.
- **Residual risk**: Brief write unavailability is accepted because concurrent index creation is incompatible with the transactional migration runner.

#### Rolling instances retain old semantics
- **Scenario**: An old application instance reads a migration-soft-deleted duplicate or serves a cached grant during a rolling deployment.
- **Severity**: High
- **Affected area**: Authorization during the rollout window
- **Mitigation**: Drain/restart old instances as part of the release and start new instances with empty local RBAC caches.
- **Residual risk**: A short orchestration-dependent window remains; deployments must not leave mixed application versions running indefinitely.

#### Rollback reactivates ambiguous privileges
- **Scenario**: A rollback drops indexes and automatically restores all remediated rows as live.
- **Severity**: Critical
- **Affected area**: Tenant authorization and administrative access
- **Mitigation**: `down()` drops only indexes and deliberately leaves remediated rows soft-deleted. Restoration requires an explicit operator choice.
- **Residual risk**: Rolling back application code to readers that ignore `deleted_at` is unsafe; rollback uses a fixed release or an operator-reviewed data repair.

## Final Compliance Report — 2026-08-29

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/auth/AGENTS.md`
- `packages/core/src/modules/notifications/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| Root `AGENTS.md` | Preserve tenant isolation and mutation guards | Compliant | Existing route guards remain; ACL reads bind principal and tenant and ignore revoked state. |
| Root `AGENTS.md` | Use decryption-aware entity reads | Compliant | New target loads use `findOneWithDecryption`; ACL and membership reads use the shared helpers where applicable. |
| Root `AGENTS.md` | Never edit generated files manually | Compliant | Partial indexes live only in the handwritten migration; generated snapshots are unchanged. |
| `packages/core/AGENTS.md` | Keep auth behavior scoped and command side effects intact | Compliant | Commands retain atomic writes, audit logging, invalidation, and optimistic locking. |
| Auth `AGENTS.md` | Canonical session/RBAC semantics must agree | Compliant | Grant and target readers require live ACLs, assignments, and roles. |
| Notifications `AGENTS.md` | Preserve tenant-scoped notification delivery | Compliant | Role/feature recipients require live tenant roles, links, ACLs, and users. |
| `BACKWARD_COMPATIBILITY.md` | Database schema changes are additive-only and documented | Compliant | Adds partial indexes, preserves rows, and documents rollback/deployment compatibility. |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | No response or entity-field shape changes. |
| API contracts match UI/UX section | Pass | UI behavior and response shapes are unchanged. |
| Risks cover all write operations | Pass | Migration, ACL writes, setup, undo, cache, and rollback are covered. |
| Commands defined for all mutations | Pass | Existing ACL/user/role commands remain authoritative. |
| Cache strategy covers all read APIs | Pass | Existing user/tenant invalidation remains unchanged. |

### Non-Compliant Items

None.

### Verdict

**Fully compliant: Approved — ready for implementation.**

## Changelog

### 2026-08-29

- Added the live ACL canonicalization, migration, compatibility, consumer-audit, and validation contract.
- **Scope-cohesion review — Fresh-context agent**: Passed; remediation, uniqueness enforcement, and lifecycle-aware consumers are mutually necessary layers of one canonical live ACL capability.
- **Review — Agent**: Security passed; performance passed with deployment monitoring; cache passed; commands passed; risks passed; verdict approved.
