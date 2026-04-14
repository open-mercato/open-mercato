# SPEC: Eliminate Global Roles — Fix Tenant-Scoped Role Corruption

**Issue**: [open-mercato/open-mercato#687](https://github.com/open-mercato/open-mercato/issues/687)
**Date**: 2026-04-11
**Status**: Draft
**Severity**: Critical (auth/RBAC)

## Problem Statement

Global roles (`tenantId: null`) are a design flaw that causes data corruption. When `ensureRolesInContext` runs during tenant initialization, it finds a global role and **mutates its `tenantId`** to the new tenant's ID. This "steals" the role from the global scope, breaking access for any other tenant that previously relied on it.

### Root Cause

The bug is in `ensureRolesInContext` (`packages/core/src/modules/auth/lib/setup-app.ts:26-44`):

```typescript
if (tenantId !== null) {
  const globalRole = await em.findOne(Role, { name, tenantId: null })
  if (globalRole) {
    globalRole.tenantId = tenantId  // ← MUTATES the global role
    em.persist(globalRole)
    continue
  }
}
```

**Note**: The issue reporter pointed at `syncUserRoles` in `commands/users.ts`, but that function does NOT mutate `tenantId`. The actual mutation is in `ensureRolesInContext` above.

### Why Global Roles Are Fundamentally Broken

1. **RBAC service ignores them**: `rbacService.loadAcl` queries `UserRole` with `{ role: { tenantId } }` — only tenant-scoped roles resolve ACLs. A user assigned a global role gets zero permissions in any tenant context.
2. **RoleAcl requires tenantId**: The `RoleAcl` entity has `tenantId: NOT NULL`. You cannot create ACL entries for a global role without a tenant, making them permission-less.
3. **PostgreSQL UNIQUE with NULL**: The composite unique `(tenantId, name)` treats `NULL != NULL`, so multiple global "admin" roles can coexist — a data integrity gap.
4. **Race condition**: Two tenants initializing concurrently both find the same global role. First one wins and mutates its `tenantId`; the second either creates a duplicate or fails.

## Decisions

- **Data migration**: Soft-delete existing global roles. They never had working ACLs, so no permissions are lost.
- **NOT NULL constraint**: Ship in the same release as the bugfix — single migration handles soft-delete + schema tightening.
- **Third-party modules**: None create global roles; no deprecation notice needed.

## Solution

Eliminate global roles entirely. Roles MUST always be tenant-scoped. All changes ship as a single bugfix release — no phasing needed.

### Phase 1 — Fix the Bug (Minimal, Safe)

#### 1.1 Fix `ensureRolesInContext` — Stop Mutating Global Roles

**File**: `packages/core/src/modules/auth/lib/setup-app.ts:26-44`

Remove the "reuse global role" branch. Always create a new tenant-scoped role if one doesn't exist for the tenant:

```typescript
async function ensureRolesInContext(
  em: EntityManager,
  roleNames: string[],
  tenantId: string | null,
) {
  if (tenantId === null) {
    throw new Error('ensureRolesInContext requires a tenantId — global roles are not supported')
  }
  for (const name of roleNames) {
    const existing = await em.findOne(Role, { name, tenantId })
    if (existing) continue
    em.persist(em.create(Role, { name, tenantId, createdAt: new Date() }))
  }
}
```

#### 1.2 Guard `ensureRoles` — Require tenantId

**File**: `packages/core/src/modules/auth/lib/setup-app.ts:46-53`

Throw if called without a `tenantId`:

```typescript
export async function ensureRoles(em: EntityManager, options: EnsureRolesOptions = {}) {
  const roleNames = options.roleNames ?? [...DEFAULT_ROLE_NAMES]
  const tenantId = normalizeTenantId(options.tenantId ?? null) ?? null
  if (tenantId === null) {
    throw new Error('ensureRoles requires a tenantId — global roles are not supported')
  }
  await em.transactional(async (tem) => {
    await ensureRolesInContext(tem, roleNames, tenantId)
    await tem.flush()
  })
}
```

#### 1.3 Guard Role Create Command — Enforce tenantId

**File**: `packages/core/src/modules/auth/commands/roles.ts:99-137`

The `createRoleCommand` currently falls back to `ctx.auth?.tenantId ?? null`. It should reject `null`:

```typescript
const resolvedTenantId = parsed.tenantId === undefined ? ctx.auth?.tenantId ?? null : parsed.tenantId ?? null
if (!resolvedTenantId) {
  throw new CrudHttpError(400, { error: 'tenantId is required — global roles are not supported' })
}
```

#### 1.4 Guard Role Create Form — Default to Auth Tenant

**File**: `packages/core/src/modules/auth/backend/roles/create/page.tsx:79`

Change `tenantId: null` initial value to use the authenticated user's tenant context (this is cosmetic since the command guard catches it, but avoids user confusion).

#### 1.5 Fix CLI `add-user` — Remove Global Role Fallback

**File**: `packages/core/src/modules/auth/cli.ts:68`

Remove the fallback `em.findOne(Role, { name, tenantId: null })`. If a role doesn't exist for the tenant, create it for that tenant — never look for a global one.

#### 1.6 Fix `findRoleByName` — Remove Global Fallback

**File**: `packages/core/src/modules/auth/lib/setup-app.ts:55-66`

Remove the `tenantId: null` fallback:

```typescript
async function findRoleByName(
  em: EntityManager,
  name: string,
  tenantId: string | null,
): Promise<Role | null> {
  const normalizedTenant = normalizeTenantId(tenantId ?? null) ?? null
  return em.findOne(Role, { name, tenantId: normalizedTenant })
}
```

### Phase 2 — Clean Up All Global Role References

#### 2.1 Remove Global Fallback from `resolveRole`

**File**: `packages/core/src/modules/auth/commands/users.ts:746-763`

Remove the `{ tenantId: null }` branch in the `$or` filter and the name-based fallback:

```typescript
async function resolveRole(em, value, normalizedTenantId) {
  if (UUID_RE.test(value)) {
    return em.findOne(Role, { id: value, tenantId: normalizedTenantId })
  }
  return em.findOne(Role, { name: value, tenantId: normalizedTenantId })
}
```

#### 2.2 Remove Global Fallback from Roles API

**File**: `packages/core/src/modules/auth/api/roles/route.ts:150,156`

Change `{ $or: [{ tenantId: X }, { tenantId: null }] }` to `{ tenantId: X }`.

#### 2.3 Remove Global Fallback from Backend Chrome

**File**: `packages/core/src/modules/auth/lib/backendChrome.tsx:307,341-342`

Same pattern — remove `{ tenantId: null }` from `$or` filters for role queries.

#### 2.4 Data Migration — Soft-Delete Existing Global Roles

Create a migration that soft-deletes orphaned global roles (`tenantId IS NULL`). Since global roles never had working ACLs (RoleAcl requires non-null tenantId), no permissions are lost:

```sql
UPDATE roles SET deleted_at = NOW() WHERE tenant_id IS NULL AND deleted_at IS NULL;
```

#### 2.5 Schema Change — Make `tenantId` NOT NULL

**File**: `packages/core/src/modules/auth/data/entities.ts:49-50`

Change the entity:

```typescript
@Property({ name: 'tenant_id', type: 'uuid', nullable: false })
tenantId!: string
```

Then run `yarn db:generate` to produce the migration. This is the final seal — prevents future regressions at the database level.

#### 2.6 Update Zod Schemas

**File**: `packages/core/src/modules/auth/commands/roles.ts:64-73`

Change `tenantId` from `.nullable().optional()` to `.uuid()` (required) in both create and update schemas.

#### 2.7 Update Role Tenant Guard

**File**: `packages/core/src/modules/auth/lib/roleTenantGuard.ts`

The `enforceTenantSelection` already resolves a tenantId for create mode. Verify it rejects `null` and add an explicit check if not.

## Files Changed (Summary)

| File | Change |
|------|--------|
| `packages/core/src/modules/auth/lib/setup-app.ts` | Remove global role mutation in `ensureRolesInContext`, guard `ensureRoles`, remove fallback in `findRoleByName` |
| `packages/core/src/modules/auth/commands/roles.ts` | Guard create command, tighten zod schemas |
| `packages/core/src/modules/auth/commands/users.ts` | Remove `tenantId: null` fallback in `resolveRole` |
| `packages/core/src/modules/auth/api/roles/route.ts` | Remove `tenantId: null` from `$or` filters |
| `packages/core/src/modules/auth/lib/backendChrome.tsx` | Remove `tenantId: null` from `$or` filters |
| `packages/core/src/modules/auth/lib/roleTenantGuard.ts` | Verify null rejection |
| `packages/core/src/modules/auth/cli.ts` | Remove global role fallback in `add-user`, guard `seed-roles` |
| `packages/core/src/modules/auth/backend/roles/create/page.tsx` | Default to auth tenantId |
| `packages/core/src/modules/auth/data/entities.ts` | Make `tenantId` NOT NULL |
| `packages/core/src/modules/auth/data/validators.ts` | Update if role validators exist |
| New migration | Soft-delete or reassign existing global roles, then `ALTER COLUMN tenant_id SET NOT NULL` |

## Migration & Backward Compatibility

### Contract Surface Analysis

Per `BACKWARD_COMPATIBILITY.md`, `roles.tenant_id` falls under **Database Schema (#8, ADDITIVE-ONLY)** and the **standard column contract** (line 150). Narrowing `nullable → NOT NULL` is technically a contract change.

**Justification**: This is a critical auth bugfix, not a feature change. The nullable state was never intentionally designed — global roles (`tenantId IS NULL`) have been broken since inception:
- `RoleAcl.tenantId` is already `NOT NULL`, so global roles cannot hold permissions
- `rbacService.loadAcl` filters `UserRole` by `{ role: { tenantId } }`, so global roles resolve zero features
- `ensureRolesInContext` destructively mutated global roles on first tenant init, causing cross-tenant data corruption

No third-party module depends on `tenantId: null` for roles because it has never worked. This change makes the schema match the actual runtime invariant.

### Breaking Surfaces

| Surface | Impact | Mitigation |
|---------|--------|------------|
| Database schema (#8) | `roles.tenant_id` nullable → NOT NULL | Migration cleans all FK dependents + deletes NULL rows before constraint |
| API route (#7) | Role create/update rejects `tenantId: null` | 400 with clear message; OpenAPI schemas updated to reflect non-nullable |
| Function signatures (#3) | `ensureRoles()` / `ensureRolesInContext()` require `tenantId` | Throws with clear message; all internal callers already pass tenantId |

### RELEASE_NOTES Entry (to be added on release)

> **Breaking (bugfix)**: `roles.tenant_id` is now `NOT NULL`. Global roles (`tenantId IS NULL`) were never functional — the RBAC service could not load permissions for them, and `ensureRolesInContext` destructively corrupted them during tenant setup (#687). The migration deletes orphaned global roles and all their FK dependents (`role_acls`, `user_roles`, `role_sidebar_preferences`) before applying the constraint. API callers that passed `tenantId: null` when creating roles will now receive a 400 error. No action needed for callers that omit `tenantId` — it defaults to the authenticated user's tenant.

## Migration Order

The migration (`Migration20260411203200`) executes in this order:
1. `DELETE FROM role_acls WHERE role_id IN (SELECT id FROM roles WHERE tenant_id IS NULL)`
2. `DELETE FROM user_roles WHERE role_id IN (SELECT id FROM roles WHERE tenant_id IS NULL)`
3. `DELETE FROM role_sidebar_preferences WHERE role_id IN (SELECT id FROM roles WHERE tenant_id IS NULL)`
4. `DELETE FROM roles WHERE tenant_id IS NULL`
5. `ALTER TABLE roles ALTER COLUMN tenant_id SET NOT NULL`

Steps 1–4 clean all FK dependents before step 5 applies the constraint.

## Testing

### Unit Tests

- `ensureRolesInContext` throws when `tenantId` is null
- `ensureRolesInContext` creates new role when tenant role doesn't exist (no global mutation)
- `ensureRolesInContext` is idempotent (calling twice doesn't duplicate)
- `createRoleCommand` rejects payload with `tenantId: null`
- `resolveRole` does NOT fall back to `tenantId: null`
- `findRoleByName` does NOT fall back to `tenantId: null`

### Integration Tests

- **Tenant initialization**: New tenant gets its own roles (not stolen from another)
- **Multi-tenant isolation**: Two tenants initialized concurrently both get correct, independent roles
- **Role assignment**: Assigning a role in tenant-A does not affect tenant-B's roles
- **Role API**: `GET /api/roles` only returns tenant-scoped roles (no `tenantId: null` results)
- **Role creation via API**: `POST /api/roles` with `tenantId: null` returns 400
- **CLI seed-roles**: `seed-roles` without `--tenantId` iterates all tenants correctly
- **RBAC**: User with tenant-scoped role gets correct permissions

## Open Questions

None — all decisions resolved.
