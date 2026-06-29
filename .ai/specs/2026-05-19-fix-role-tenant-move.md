# Fix Role Tenant Move — ACL Reset & Missing Validation

## TL;DR
When editing a Role and changing its Tenant, the backend silently allows the move even when users are assigned (orphaning their `UserRole` rows) and the UI immediately wipes all ACL checkboxes. This spec rejects tenant moves for roles with active assignments, preserves the operator's selected permissions across tenant changes, and cleans up old-tenant `RoleAcl` rows so the data stays consistent after a legitimate move.

## Overview
The `auth` module enforces the invariant that **roles are unique per tenant**. Today this invariant is partially enforced: renaming a role with active users is blocked, but changing its tenant is not. At the same time, the role-edit UI aggressively resets the ACL editor state whenever the tenant dropdown changes, which makes a legitimate tenant move impossible without re-selecting every permission.

This spec extends the existing rename-guard pattern to tenant changes (backend reject + UI disable when users are assigned), makes the `AclEditor` carry over the operator's selections across a tenant change for unassigned roles, and removes stale `RoleAcl` rows after a tenant move so the role no longer references its previous tenant.

## Problem Statement
Reported in issue [#688](https://github.com/open-mercato/open-mercato/issues/688). Two coupled bugs on `/backend/roles/[id]/edit`:

1. **UI wipes ACL checkboxes on tenant change.** The `TenantSelect` `onChange` handler calls `setAclData({ isSuperAdmin: false, features: [], organizations: null })` (`packages/core/src/modules/auth/backend/roles/[id]/edit/page.tsx:108`). The shared `AclEditor` then refetches ACLs for the new tenant on its load effect (`packages/core/src/modules/auth/components/AclEditor.tsx:213`) and overwrites internal state with whatever the new tenant's ACL row returns — typically empty for that role. The operator loses every selection before they can save.

2. **Backend allows tenant moves that orphan user assignments.** `updateRoleCommand` updates `role.tenantId` unconditionally (`packages/core/src/modules/auth/commands/roles.ts:241-246`). There is no parallel to the existing rename guard at lines 232-236, so a role with active `UserRole` rows can be reassigned to a different tenant. `UserRole` rows are scoped to the user's tenant, so the assignments become orphaned the moment the role moves.

3. **Hidden side effect after a legitimate move.** Even when no users are assigned, the backend update command only mutates the `Role` row. Existing `RoleAcl` rows for the previous tenant are left in place, while the page's submit handler inserts new `RoleAcl` rows under the new tenant (`page.tsx:194-197`). The result is dead ACL data tied to a tenant the role no longer belongs to.

The problem is not a missing migration. The problem is a contract gap between the role-edit UI, the `auth.roles.update` command, and the `RoleAcl` table.

## Proposed Solution
Three coordinated changes:

**Backend reject (mirrors rename guard).** In `updateRoleCommand`, when `parsed.tenantId !== current.tenantId`, count active `UserRole` rows for the role. If the count is greater than zero, throw `CrudHttpError(400, { error: 'Role cannot be moved to another tenant while users are assigned' })`. Mirrors the rename validation immediately above it.

**Backend orphan cleanup.** In the same code path, when the tenant actually changes, `em.nativeDelete(RoleAcl, { role: <id> })` before the page's follow-up ACL update inserts the new-tenant rows. The existing `RoleUndoSnapshot.acls` already captures the deleted rows, so the existing `restoreRoleAcls` undo path continues to work without changes.

**UI disable for users-assigned roles.** In `roles/[id]/edit/page.tsx`, the `disabled` flag (already computed from `usersCount > 0` and applied to the `name` field) is also applied to the `TenantSelect` custom field. The operator cannot reach the broken state in the UI; the backend rejects it as a defense-in-depth measure.

**UI carry-over for unassigned roles.** Replace the eager full reset in `TenantSelect.onChange` with a targeted reset that only clears `aclData.organizations` (because organization IDs are tenant-scoped and become invalid after a move). `aclData.features` and `aclData.isSuperAdmin` carry over unchanged. Add a `preserveOnTenantChange?: boolean` prop to `AclEditor` (default `false` — current behavior). When `true`, the ACL refetch effect skips on post-mount `tenantId` changes so `granted`/`isSuperAdmin`/`organizations` remain whatever the operator currently sees. Organization options and the user-role lookup keep their tenant-aware refetches. The role-edit page opts in via `preserveOnTenantChange`; the user-edit page leaves it at the default so changing a user's tenant continues to refresh their ACL view. Render a warning banner near the ACL group when `selectedTenantId !== initial.tenantId`, telling the operator the displayed permissions will be saved under the new tenant on submit.

**Mirror the carry-over pattern in WidgetVisibilityEditor.** The same component-level issue exists for `packages/core/src/modules/dashboards/components/WidgetVisibilityEditor.tsx`: it refetches `/api/dashboards/roles/widgets?tenantId=<new>` on every `tenantId` change, but the role still belongs to the old tenant until save, so the API returns 404 `Role not found` (`api/dashboards/roles/widgets/route.ts:67`). Apply the same `preserveOnTenantChange?: boolean` prop (default `false`), capturing `tenantId`/`organizationId` from refs on initial mount and skipping the post-mount refetch when opted in. The role-edit page opts in. `save()` keeps using the current `tenantId` prop so the new row lands under the destination tenant.

## Architecture
This change stays within the `auth` module. No new entities, no cross-module surfaces, no new DI registrations.

### Source of Truth
- `packages/core/src/modules/auth/commands/roles.ts` — `updateRoleCommand` owns the rejection and cleanup
- `packages/core/src/modules/auth/components/AclEditor.tsx` — owns the carry-over behavior across `tenantId` changes
- `packages/core/src/modules/auth/backend/roles/[id]/edit/page.tsx` — owns the disable trigger and the reassignment warning

### Behavioral Rules
- Tenant change rejected when `UserRole.count({ role, deletedAt: null }) > 0`
- Tenant change permitted only when no active assignments exist
- On a permitted tenant change, the command deletes all `RoleAcl` rows for the role before the page's follow-up ACL update inserts new rows under the new tenant
- `AclEditor` refetches ACL state on initial mount (`kind`, `targetId`) using the current `tenantId`. When `preserveOnTenantChange` is `true`, subsequent `tenantId` changes do not refetch the ACL. When `false` (default), `tenantId` changes refetch the ACL — matching the original behavior used by the user-edit page.
- Tenant-aware refetches for org options and assigned roles still run on `tenantId` change regardless of `preserveOnTenantChange`
- The reassignment warning is visible only when `selectedTenantId !== initial.tenantId`

### Compatibility Notes
- Rename guard semantics unchanged.
- Tenant move was previously silently permitted with broken data — the rejection is intentionally a new 400, not a breaking removal of a documented feature.
- The orphan cleanup is silent for roles where the tenant does not change.
- `AclEditor` is shared with `/backend/users/[id]/edit`. Users have a stable tenant context — `tenantId` does not change post-mount on that page — so the carry-over change is a no-op for users.

## Data Model
No migration. `Role`, `RoleAcl`, and `UserRole` entities are unchanged. The cleanup uses `em.nativeDelete` on `RoleAcl` filtered by `role`.

### Existing Entities Touched
- `Role` — `tenantId` mutation gated by new precondition
- `RoleAcl` — deleted by role id when tenant actually changes
- `UserRole` — read-only count for the precondition

## API Contracts
`PUT /api/auth/roles` body schema is unchanged. The new failure mode is:

```
400 { "error": "Role cannot be moved to another tenant while users are assigned" }
```

`PUT /api/auth/roles/acl` is unchanged. The page submit order remains:

1. `PUT /api/auth/roles` — updates `role.tenantId`, deletes old-tenant `RoleAcl` rows
2. `PUT /api/auth/roles/acl` — inserts the new `RoleAcl` row under the new tenant from the carried-over `aclData`

### OpenAPI
The role CRUD route uses `createCrudOpenApiFactory`. No schema additions are required; the 400 error already falls under the generic CRUD error response and the `error` message itself does not need to be enumerated.

## Risks & Impact Review

| Risk | Severity | Affected Area | Mitigation | Residual Risk |
|------|----------|---------------|------------|---------------|
| Shared `AclEditor` regression on `/backend/users/[id]/edit` | High | auth UI | User edit page does not change `tenantId` after mount, so the new effect split is a no-op there. Add an integration test that opens the user edit page and asserts the ACL load completes with checkboxes populated. | Low |
| Operator confusion when tenant change is rejected | Low | auth UI | Tenant field becomes disabled before the user can attempt the change (mirrors name field), so the 400 is reachable only via direct API calls. | Low |
| `restoreRoleAcls` undo conflict after orphan cleanup | Medium | auth undo flow | `RoleUndoSnapshot.acls` already captures the rows being deleted, and `restoreRoleAcls` already deletes-and-recreates by role id. Undo continues to restore the original state. Add an integration test for undo. | Low |
| Lost rows for an unrelated tenant if a single `Role` had `RoleAcl` rows for multiple tenants in legacy data | Medium | auth data | The current Role/RoleAcl model is single-tenant per role, but legacy rows might violate this. Cleanup deletes by `role` only, which is correct for the post-condition (one role, one tenant, one set of ACLs). If legacy multi-tenant ACL rows exist they are already invalid and removing them is intentional. | Accepted |
| External callers depending on silent tenant moves | Low | API consumers | The change adds a new 400 only when `UserRole` rows exist. Existing consumers that move tenants on unassigned roles continue to work. | Low |
| Orphan `DashboardRoleWidgets` rows after tenant move | Low | dashboards data | Cross-module data is intentionally not deleted from `updateRoleCommand`. `deleteRoleCommand` already shares the same gap. Follow-up: dashboards subscriber on `auth.role.updated` that removes `DashboardRoleWidgets` rows where `tenantId != role.tenantId`. | Accepted (follow-up) |

## Final Compliance Report
- **Backward compatibility**: Additive failure mode. No removed endpoints, no schema field removals. The new 400 only fires on a previously-broken code path.
- **RBAC**: No new features. Existing `auth.role.edit` guard remains the only required permission.
- **i18n**: New warning banner copy uses `t('auth.roles.form.tenantReassign', ...)` with English fallback. Error string from the backend stays in English (matches the existing rename guard error).
- **Audit**: `updateRoleCommand` already emits CRUD side effects and writes an audit log entry with `snapshotBefore`/`snapshotAfter`. The tenant change appears in `changes.tenantId` as before; orphan cleanup is implicit in the snapshot diff (acls array shrinks then grows on the follow-up ACL update).
- **Encryption**: No GDPR-relevant fields touched.
- **Generated files**: None require regeneration.

## Tests (Integration)
- `PUT /api/auth/roles` with `tenantId` change for a role with `UserRole` assignments → 400, `Role cannot be moved to another tenant while users are assigned`.
- `PUT /api/auth/roles` with `tenantId` change for a role without users → 200, `RoleAcl` rows for the old tenant are gone, follow-up `PUT /api/auth/roles/acl` inserts under the new tenant.
- Undo of a tenant-move update restores the previous `tenantId` and the previous `RoleAcl` rows.
- UI integration: `/backend/roles/[id]/edit` for a role with users — Tenant select is disabled.
- UI integration: `/backend/roles/[id]/edit` for a role without users — selecting a new tenant keeps checkboxes intact, shows the reassignment warning, submitting persists the carried-over ACL under the new tenant.
- UI regression: `/backend/users/[id]/edit` still loads ACLs correctly on initial mount.

## Changelog
- 2026-05-19 — Initial draft (issue #688).
