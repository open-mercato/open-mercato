# Auth Module — Standalone App Guide

The auth module handles staff authentication, authorization, users, roles, and RBAC. For customer portal authentication, see the `customer_accounts` module guide.

## RBAC Implementation

### Two-Layer Model

1. **Role ACLs** — features assigned to roles (admin, employee, etc.)
2. **User ACLs** — per-user overrides (additional features or restrictions)

Effective permissions = Role features + User-specific features.

### Declaring Features

Every module MUST declare features in `acl.ts` and wire them in `setup.ts`:

```typescript
// src/modules/<your_module>/acl.ts
export const features = [
  'your_module.view',
  'your_module.create',
  'your_module.update',
  'your_module.delete',
]

// src/modules/<your_module>/setup.ts
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['your_module.*'],
    admin: ['your_module.*'],
    user: ['your_module.view'],
  },
}
```

### Feature Naming Convention

Features follow the `<module>.<action>` pattern (e.g., `users.view`, `users.edit`).

### Declarative Guards

Prefer declarative guards in page and API metadata:

```typescript
export const metadata = {
  requireAuth: true,
  requireRoles: ['admin'],
  requireFeatures: ['users.manage'],
}
```

### Server-Side Checks

```typescript
const rbacService = container.resolve('rbacService')
const hasAccess = await rbacService.userHasAllFeatures(
  userId,
  ['your_module.view'],
  { tenantId, organizationId }
)
```

### Wildcards

Wildcards are first-class ACL grants: `module.*` and `*` satisfy matching concrete features. When your code inspects raw granted feature arrays (instead of calling `rbacService`), use the shared wildcard-aware matchers (`matchFeature`, `hasFeature`, `hasAllFeatures`) — never use `includes(...)`.

### Special Flags

- `isSuperAdmin` — bypasses all feature checks
- Organization visibility list — restricts which organizations a user can access

## Security Rules

- Hash passwords with `bcryptjs` (cost >= 10)
- Never log credentials
- Return minimal auth error messages — never reveal whether an email exists
- Use `findWithDecryption` / `findOneWithDecryption` for user queries

## Authentication Flow

1. User submits credentials via `POST /api/auth/session`
2. Password verified with bcryptjs
3. JWT session token issued
4. Session attached to requests via middleware

## Subscribing to Auth Events

```typescript
export const metadata = {
  event: 'auth.user.created',
  persistent: true,
  id: 'your-module-user-created',
}

export default async function handler(payload, ctx) {
  // React to new user registration
}
```
