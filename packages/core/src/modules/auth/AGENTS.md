# Auth Module — Agent Guidelines

The auth module handles authentication, authorization, users, roles, and RBAC.

## Data Model

- **Users** — system users with credentials, profile, preferences
- **Roles** — named role definitions
- **Role ACLs** — feature permissions assigned to roles
- **User ACLs** — per-user feature overrides
- **Sessions** — JWT-based authentication sessions

## Authentication Flow

1. User submits credentials via `/api/auth/session` (POST)
2. Password verified with `bcryptjs` (cost >= 10)
3. JWT session token issued
4. Session attached to requests via middleware

### Security Rules

- Hash passwords with `bcryptjs` (cost >= 10)
- **Never log credentials**
- Return minimal error messages — never reveal whether an email exists
- Use `findWithDecryption`/`findOneWithDecryption` for user queries

## RBAC Implementation

### Two-Layer Model

1. **Role ACLs** — features assigned to roles (admin, employee, etc.)
2. **User ACLs** — per-user overrides (additional features or restrictions)

Effective permissions = Role features + User-specific features.

### Features

Features are string-based permissions: `<module>.<action>` (e.g., `users.view`, `users.edit`).

- Every module MUST expose features in `acl.ts`
- Features are assigned to roles and users through ACLs
- Pages/APIs use `requireFeatures` in metadata for access control
- Server-side check: `rbacService.userHasAllFeatures(userId, features, { tenantId, organizationId })`
- Wildcards are first-class ACL grants: `module.*` and `*` must satisfy matching concrete features in every runtime check, not only in page/API guards.
- When code inspects raw granted feature arrays instead of calling `rbacService`, MUST use shared helpers such as `matchFeature` / `hasFeature` / `hasAllFeatures` rather than `includes(...)`.

### Special Flags

- `isSuperAdmin` — bypasses all feature checks (all features granted)
- Organization visibility list — restricts which organizations a user can access

### Declarative Guards

Prefer declarative guards in page/API metadata:

```typescript
export const metadata = {
  requireAuth: true,
  requireRoles: ['admin'],
  requireFeatures: ['users.manage'],
}
```

## Key Directories

| Directory | Purpose |
|-----------|---------|
| `api/admin/` | Admin user management endpoints |
| `api/profile/` | User profile endpoints |
| `api/reset/` | Password reset flow |
| `api/roles/` | Role management endpoints |
| `api/session/` | Authentication (login/logout) |
| `api/users/` | User CRUD endpoints |
| `api/sidebar/` | Sidebar configuration |
| `api/locale/` | User locale preferences |
| `backend/auth/` | Login and auth pages |
| `backend/roles/` | Role management pages |
| `backend/users/` | User management pages |
| `commands/` | User/role management commands |
| `emails/` | Password reset, invitation emails |
| `frontend/reset/` | Public password reset page |
| `services/` | Auth services (RBAC, session) |

## Adding New Features

When adding features to any module:

1. Declare in `acl.ts`: `export const features = ['module.view', 'module.edit', ...]`
2. Add to `setup.ts` `defaultRoleFeatures` so roles are seeded during tenant creation
3. Guard pages/APIs with `requireFeatures` in metadata
4. For tenants that already exist (production, staging, demo), run `yarn mercato auth sync-role-acls --tenant <id>` after deploying — this re-applies `defaultRoleFeatures` idempotently so the new features land in existing `RoleAcl` rows. `setupTenantAndPrimaryUser` only runs during the initial tenant bootstrap.

```typescript
// acl.ts
export const features = ['my_module.view', 'my_module.manage']

// setup.ts
export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['my_module.*'],
    employee: ['my_module.view'],
  },
}
```

When exposing helper endpoints such as `/api/auth/feature-check`, keep wildcard handling normalized for callers. If a consumer bypasses the endpoint and reads raw ACL grants directly, it must apply wildcard-aware matching itself.

## Scriptable Tenant Provisioning

`mercato auth setup` is the scripting-friendly counterpart to interactive `mercato init`. Both call the same `setupInitialTenant` helper, so behaviour is identical for tenant + organization + admin user + role ACLs + `onTenantCreated` lifecycle hooks.

For non-interactive callers (staging seeding, sales-engineering demos, customer onboarding, DR restore), use:

- `--orgSlug <slug>` — persists a slug on the new organization. Triggers a **best-effort** uniqueness pre-check via `findOneWithDecryption(Organization, { slug })` (throws `OrgSlugExistsError` on collision) and forces `failIfUserExists: true` so an existing user with the same email aborts with a clear error rather than silently reusing the foreign tenant.
- `--with-examples` — runs every enabled module's `seedExamples` after tenant creation. Opt-in here (default off) so production callers don't accidentally seed demo data.
- `--json` — emits a single JSON line on stdout with `{ tenantId, organizationId, adminUserId, adminEmail, reusedExistingUser }`. Suppresses banner/progress output and silences `console.log`/`console.info` for the duration so consumers can pipe directly into `jq`.

The lib-level option (`SetupInitialTenantOptions.orgSlug`) is available to direct callers of `setupInitialTenant`; the slug pre-check uses `findOneWithDecryption` so it remains correct if `Organization` later gains encrypted fields.

### Slug uniqueness scope (race window)

The pre-check is **race-safe within a tenant** but **advisory across tenants**, because the DB constraint on `organizations` is per-tenant:

```sql
-- packages/core/src/modules/directory/migrations/Migration20260314143323.ts
alter table "organizations" add constraint "organizations_tenant_slug_uniq" unique ("tenant_id", "slug");
```

The pre-check runs **outside** `em.transactional`, so two concurrent `mercato auth setup --orgSlug=foo` invocations creating new tenants can both pass the application-level check and both succeed at the DB level (different `tenant_id`, identical `slug`). Downstream tooling that relies on the slug as a stable cross-tenant handle should either serialize provisioning calls or add a partial unique index on `slug` alone (`where slug is not null`) in a follow-up migration; in that case the pre-check can move inside the transactional block and become a true uniqueness gate.
