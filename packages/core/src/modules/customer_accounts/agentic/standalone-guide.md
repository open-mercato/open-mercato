# Customer Accounts Module — Standalone App Guide

Customer-facing identity and portal authentication. This module manages customer user accounts, sessions, roles, and the authentication flow for the customer portal. It is separate from the staff `auth` module.

## Portal Authentication

### Login Flow
1. Customer submits credentials via `POST /api/login`
2. Password verified with bcryptjs, lockout checked (5 attempts → 15 min lock)
3. JWT issued with customer claims (`type: 'customer'`, features, CRM links)
4. Two cookies set: `customer_auth_token` (JWT, 8h) + `customer_session_token` (raw, 30d)

### Other Auth Methods
- **Signup**: `POST /api/signup` — self-registration with email verification
- **Magic Link**: `POST /api/magic-link/request` + `/verify` — passwordless login (15 min TTL)
- **Password Reset**: `POST /api/password/reset-request` + `/reset-confirm` (60 min TTL)
- **Invitation**: Admin invites user → `POST /api/invitations/accept` (72h TTL)

## Customer RBAC

### Two-Layer Model (mirrors staff RBAC)
1. **Role ACLs** — features assigned to roles
2. **User ACLs** — per-user overrides (takes precedence if present)

### Default Roles (seeded on tenant creation)
| Role | Features | Portal Admin |
|------|----------|-------------|
| Portal Admin | `portal.*` | Yes |
| Buyer | Orders, quotes, catalog, account | No |
| Viewer | Read-only orders, invoices, catalog | No |

### Feature Convention
Portal features use `portal.<area>.<action>` naming (e.g., `portal.orders.view`, `portal.catalog.view`).

### Cross-Module Feature Merging
Your module can declare `defaultCustomerRoleFeatures` in `setup.ts`. During tenant setup, these are merged into the corresponding customer role ACLs:

```typescript
// src/modules/<your_module>/setup.ts
export const setup: ModuleSetupConfig = {
  defaultCustomerRoleFeatures: {
    portal_admin: ['portal.your_feature.*'],
    buyer: ['portal.your_feature.view'],
  },
}
```

## Using Customer Auth in Your Module

### Server Components (pages)
```typescript
import { getCustomerAuthFromCookies } from '@open-mercato/core/modules/customer_accounts/lib/customerAuthServer'

const auth = await getCustomerAuthFromCookies()
if (!auth) redirect('/login')
```

### API Routes
```typescript
import { requireCustomerAuth, requireCustomerFeature } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'

// In your API handler:
const auth = requireCustomerAuth(request)  // throws 401 if not authenticated
requireCustomerFeature(auth, ['portal.orders.view'])  // throws 403 if missing
```

### RBAC Service
```typescript
const rbacService = container.resolve('customerRbacService')
const hasAccess = await rbacService.userHasAllFeatures(
  userId, ['portal.orders.view'], { tenantId, organizationId }
)
```

## Portal Page Guards

Use declarative metadata for portal pages:

```typescript
export const metadata = {
  requireCustomerAuth: true,
  requireCustomerFeatures: ['portal.orders.view'],
}
```

## Subscribing to Customer Events

| Event | When |
|-------|------|
| `customer_accounts.user.created` | New customer signup |
| `customer_accounts.user.updated` | Profile updated |
| `customer_accounts.user.locked` | Account locked after failed logins |
| `customer_accounts.login.success` | Successful login |
| `customer_accounts.invitation.accepted` | Invitation accepted |

```typescript
export const metadata = {
  event: 'customer_accounts.user.created',
  persistent: true,
  id: 'your-module-customer-signup',
}

export default async function handler(payload, ctx) {
  // React to customer signup — e.g., create default preferences
}
```

## CRM Auto-Linking

When a customer signs up, the module automatically searches for a matching CRM person by email and links them (`personEntityId`). The reverse also works — creating a CRM person auto-links to an existing customer user.

## Widget Injection Spots

| Spot | Widget | Purpose |
|------|--------|---------|
| `crud-form:customers:customer_person_profile:fields` | Account status | Shows portal account status on CRM person detail |
| `crud-form:customers:customer_company_profile:fields` | Company users | Shows portal users linked to a CRM company |

## Security Notes

- All public endpoints are rate-limited (per-email + per-IP)
- Tokens stored as SHA-256 hashes — raw tokens never persisted
- Emails use deterministic hash for lookups (`hashForLookup`)
- Error messages never confirm whether an email is registered
