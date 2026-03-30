# Customer Accounts Module — Agent Guidelines

Customer-facing identity and portal authentication with a two-tier RBAC model. This module manages customer user accounts, sessions, roles, invitations, and the authentication flow for the customer portal. It is separate from the internal `auth` module, which handles staff authentication.

## MUST Rules

1. **MUST hash passwords with `bcryptjs` (cost >= 10)** — never store plaintext passwords
2. **MUST return minimal error messages on auth endpoints** — never reveal whether an email exists (use generic "Invalid email or password")
3. **MUST rate-limit all public auth endpoints** (login, signup, password reset, magic link) — both per-email and per-IP
4. **MUST validate all inputs with zod** — schemas live in `data/validators.ts`
5. **MUST export `openApi`** from every API route file
6. **MUST scope all queries by `tenantId`** and filter `deletedAt: null` for soft-deleted records
7. **MUST NOT expose cross-tenant data** — session validation checks tenant match
8. **MUST use `hashForLookup` for email-based lookups** — emails are stored with a deterministic hash for indexed queries
9. **MUST use `hashToken` for storing session/verification/reset tokens** — raw tokens are never persisted
10. **MUST emit events via `emitCustomerAccountsEvent`** for all state changes (login, signup, lock, password reset)
11. **MUST NOT import staff auth services** — customer auth is a fully separate identity system

## Data Model

### Entities

| Entity | Table | Purpose |
|--------|-------|---------|
| `CustomerUser` | `customer_users` | Customer user accounts with credentials and CRM links |
| `CustomerRole` | `customer_roles` | Named role definitions (portal_admin, buyer, viewer) |
| `CustomerRoleAcl` | `customer_role_acls` | Feature permissions assigned to roles |
| `CustomerUserAcl` | `customer_user_acls` | Per-user feature overrides |
| `CustomerUserRole` | `customer_user_roles` | User-to-role junction (M2M) |
| `CustomerUserSession` | `customer_user_sessions` | Active sessions with hashed tokens |
| `CustomerUserEmailVerification` | `customer_user_email_verifications` | Email verification and magic link tokens |
| `CustomerUserPasswordReset` | `customer_user_password_resets` | Password reset tokens |
| `CustomerUserInvitation` | `customer_user_invitations` | Pending user invitations with role pre-assignment |

### Key Relationships

- `CustomerUser.personEntityId` -> CRM person (optional FK to customers module)
- `CustomerUser.customerEntityId` -> CRM company (optional FK to customers module)
- `CustomerUserRole` links users to roles (M2M junction)
- `CustomerRoleAcl` is 1:1 with `CustomerRole` per tenant
- `CustomerUserAcl` is 1:1 with `CustomerUser` per tenant (overrides role-based features)

### Custom Entities (ce.ts)

Two custom entity definitions are registered:
- `customer_accounts:customer_user` — labeled by `displayName`
- `customer_accounts:customer_role` — labeled by `name`

Both have `showInSidebar: false` and `defaultEditor: false`.

## Authentication Flow

### Login (`POST /api/login`)

1. Rate-limit check (per-email + per-IP)
2. Validate input with `loginSchema`
3. Look up user by email hash + tenantId
4. Check account active and not locked
5. Verify password with bcrypt
6. On failure: increment failed attempts, lock after 5 failures (15 min lockout)
7. On success: reset failed attempts, update `lastLoginAt`
8. Resolve RBAC features via `CustomerRbacService.loadAcl`
9. Create session (raw token + hashed token persisted)
10. Sign JWT with customer claims (`type: 'customer'`, features, CRM links)
11. Set `customer_auth_token` (JWT, httpOnly) and `customer_session_token` (raw, httpOnly) cookies

### Signup (`POST /api/signup`)

1. Rate-limit check (per-IP)
2. Validate input with `signupSchema`
3. Check for existing user (generic error on duplicate)
4. Create user with hashed password
5. Assign default role (`isDefault: true`)
6. Create email verification token
7. Emit `customer_accounts.user.created` event (triggers CRM auto-link + staff notification)

### Magic Link (`POST /api/magic-link/request` + `POST /api/magic-link/verify`)

1. Request: rate-limit, find user, create magic link token (15 min TTL)
2. Verify: validate token, mark used, create session

### Password Reset (`POST /api/password/reset-request` + `POST /api/password/reset-confirm`)

1. Request: rate-limit, find user, create reset token (60 min TTL)
2. Confirm: validate token, mark used, update password hash

### Email Verification (`POST /api/email/verify`)

Validates token, sets `emailVerifiedAt` on the user.

### Invitation Flow (`POST /api/admin/users-invite` + `POST /api/invitations/accept`)

1. Admin or portal admin creates invitation with email, role IDs, optional company link
2. Invitation token generated (72 hour TTL)
3. Acceptance: creates user, assigns roles, marks email verified, marks invitation accepted

### Session Refresh (`POST /api/portal/sessions-refresh`)

Re-signs the JWT with fresh RBAC features using the long-lived session token.

### Two-Cookie Strategy

| Cookie | Content | TTL | Purpose |
|--------|---------|-----|---------|
| `customer_auth_token` | Signed JWT | 8 hours | Short-lived auth with embedded claims |
| `customer_session_token` | Raw session token | 30 days | Long-lived session for JWT refresh |

## Customer RBAC

### Two-Layer Model (mirrors staff RBAC)

1. **Role ACLs** (`CustomerRoleAcl`) — features assigned to roles
2. **User ACLs** (`CustomerUserAcl`) — per-user overrides (takes precedence if present)

Effective permissions = User ACL (if exists) OR aggregated Role ACLs.

### Portal Admin Flag

`isPortalAdmin: true` on a role/user ACL bypasses all feature checks (equivalent to staff `isSuperAdmin`).

### Default Roles (seeded on tenant creation)

| Role | Slug | Features | Portal Admin |
|------|------|----------|-------------|
| Portal Admin | `portal_admin` | `portal.*` | Yes |
| Buyer | `buyer` | `portal.account.manage`, `portal.orders.*`, `portal.quotes.*`, `portal.invoices.view`, `portal.catalog.view` | No |
| Viewer | `viewer` | `portal.account.manage`, `portal.orders.view`, `portal.invoices.view`, `portal.catalog.view` | No |

### Feature Convention

Customer portal features use the `portal.<area>.<action>` naming convention (e.g., `portal.orders.view`, `portal.catalog.view`).

Treat `portal.*` and `*` as first-class ACL grants. When portal code reads raw feature arrays directly (for example menu filtering, injected portal navigation, or local runtime guards), use shared wildcard-aware matching instead of exact `includes(...)` checks.

### Cross-Module Feature Merging

Other modules can declare `defaultCustomerRoleFeatures` in their `setup.ts`. During `seedDefaults`, the customer_accounts module collects these from all enabled modules and merges them into the corresponding `CustomerRoleAcl` records.

### Server-Side Auth Helpers

| Helper | Import | Use |
|--------|--------|-----|
| `getCustomerAuthFromRequest` | `lib/customerAuth` | API routes — reads JWT from `Authorization` header or cookie |
| `requireCustomerAuth` | `lib/customerAuth` | API routes — throws 401 if not authenticated |
| `requireCustomerFeature` | `lib/customerAuth` | API routes — throws 403 if features missing |
| `getCustomerAuthFromCookies` | `lib/customerAuthServer` | Server components — reads JWT from Next.js `cookies()` |

### RBAC Check (Service)

```typescript
const customerRbacService = container.resolve('customerRbacService')
const hasAccess = await customerRbacService.userHasAllFeatures(userId, ['portal.orders.view'], { tenantId, organizationId })
```

When a portal UI/client helper needs batch checks, prefer `/api/customer_accounts/portal/feature-check`. If it evaluates raw granted features directly, it must preserve wildcard semantics.

## Services and DI

| DI Name | Class | Purpose |
|---------|-------|---------|
| `customerUserService` | `CustomerUserService` | User CRUD, password verification, lockout management |
| `customerSessionService` | `CustomerSessionService` | Session creation, JWT signing, token lookup, revocation |
| `customerTokenService` | `CustomerTokenService` | Email verification, magic link, and password reset tokens |
| `customerRbacService` | `CustomerRbacService` | ACL resolution with cache, feature checks |
| `customerInvitationService` | `CustomerInvitationService` | Invitation creation and acceptance |

All services are registered as **scoped** (per-request) via `di.ts`.

`CustomerRbacService` uses tag-based cache invalidation (`customer_rbac:user:<id>`, `customer_rbac:tenant:<id>`, `customer_rbac:all`) with a 5-minute TTL.

## API Directory Structure

```
api/
├── post/
│   ├── login.ts                          # Customer login
│   ├── signup.ts                         # Self-registration
│   ├── email/verify.ts                   # Email verification
│   ├── password/reset-request.ts         # Request password reset
│   ├── password/reset-confirm.ts         # Confirm password reset
│   ├── magic-link/request.ts             # Request magic link
│   ├── magic-link/verify.ts              # Verify magic link
│   ├── invitations/accept.ts             # Accept invitation
│   ├── admin/users.ts                    # Admin: create user
│   ├── admin/users-invite.ts             # Admin: invite user
│   ├── admin/users/[id]/reset-password.ts # Admin: reset user password
│   ├── admin/users/[id]/verify-email.ts  # Admin: force verify email
│   ├── admin/roles.ts                    # Admin: create role
│   ├── portal/logout.ts                  # Portal: logout
│   ├── portal/sessions-refresh.ts        # Portal: refresh JWT
│   ├── portal/password-change.ts         # Portal: change password
│   ├── portal/users-invite.ts            # Portal admin: invite user
│   └── portal/feature-check.ts           # Portal: check feature access
├── get/
│   ├── admin/users.ts                    # Admin: list users
│   ├── admin/users/[id].ts              # Admin: get user detail
│   ├── admin/roles.ts                    # Admin: list roles
│   ├── admin/roles/[id].ts              # Admin: get role detail
│   ├── portal/profile.ts                # Portal: get own profile
│   ├── portal/sessions.ts               # Portal: list own sessions
│   ├── portal/users.ts                  # Portal admin: list company users
│   ├── portal/events/stream.ts          # Portal: SSE event stream
│   ├── portal/notifications.ts          # Portal: list notifications
│   └── portal/notifications/unread-count.ts # Portal: unread count
├── put/
│   ├── admin/users/[id].ts              # Admin: update user
│   ├── admin/roles/[id].ts              # Admin: update role
│   ├── admin/roles/[id]/acl.ts          # Admin: update role ACL
│   ├── portal/profile.ts                # Portal: update own profile
│   ├── portal/users/[id]/roles.ts       # Portal admin: assign roles
│   ├── portal/notifications/[id]/read.ts     # Portal: mark notification read
│   ├── portal/notifications/[id]/dismiss.ts  # Portal: dismiss notification
│   └── portal/notifications/mark-all-read.ts # Portal: mark all read
└── delete/
    ├── admin/users/[id].ts              # Admin: soft-delete user
    ├── admin/roles/[id].ts              # Admin: delete role
    ├── portal/users/[id].ts             # Portal admin: remove user
    └── portal/sessions/[id].ts          # Portal: revoke session
```

### API Scopes

- **Public** (`/api/login`, `/api/signup`, `/api/password/*`, `/api/magic-link/*`, `/api/email/*`, `/api/invitations/*`) — unauthenticated, rate-limited
- **Admin** (`/api/admin/*`) — requires staff auth + `customer_accounts.view` / `customer_accounts.manage` features
- **Portal** (`/api/portal/*`) — requires customer auth (JWT), some endpoints require `isPortalAdmin`

## Events

Declared in `events.ts` via `createModuleEvents`. Emit with `emitCustomerAccountsEvent`.

| Event ID | Category | Client Broadcast |
|----------|----------|-----------------|
| `customer_accounts.user.created` | crud | Yes |
| `customer_accounts.user.updated` | crud | No |
| `customer_accounts.user.deleted` | crud | No |
| `customer_accounts.user.locked` | lifecycle | No |
| `customer_accounts.user.unlocked` | lifecycle | No |
| `customer_accounts.login.success` | lifecycle | No |
| `customer_accounts.login.failed` | lifecycle | No |
| `customer_accounts.email.verified` | lifecycle | No |
| `customer_accounts.password.reset` | lifecycle | No |
| `customer_accounts.role.created` | crud | No |
| `customer_accounts.role.updated` | crud | No |
| `customer_accounts.role.deleted` | crud | No |
| `customer_accounts.invitation.accepted` | lifecycle | Yes |

## Subscribers

| Subscriber | Listens To | Purpose |
|------------|-----------|---------|
| `autoLinkCrm` | `customer_accounts.user.created` | Links new customer user to existing CRM person/company by email match |
| `autoLinkCrmReverse` | `customers.person.created` | Links new CRM person to existing customer user by email match |
| `notifyStaffOnSignup` | `customer_accounts.user.created` | Emits in-app notification to staff about new signups |

All three are **persistent** subscribers (retried on failure).

### CRM Auto-Linking Logic

- **Forward** (`autoLinkCrm`): When a customer user signs up, searches CRM `CustomerEntity` (kind=person) for matching email. If found, sets `personEntityId` on the user. Also looks up the person's company via `customer_people.company_entity_id` and sets `customerEntityId`.
- **Reverse** (`autoLinkCrmReverse`): When a CRM person is created, looks for an unlinked customer user with matching email hash and links them.

## Workers

| Worker | Queue | Purpose |
|--------|-------|---------|
| `cleanupExpiredSessions` | `customer-accounts-cleanup-sessions` | Deletes expired and soft-deleted sessions |
| `cleanupExpiredTokens` | `customer-accounts-cleanup-tokens` | Deletes expired/used email verifications, password resets, and accepted/cancelled invitations |

Both run with `concurrency: 1`.

## Notification Types

Declared in `notifications.ts` and `notifications.client.ts`.

| Type | Severity | Trigger |
|------|----------|---------|
| `customer_accounts.user.signup` | info | New customer registration |
| `customer_accounts.user.locked` | warning | Account locked after failed attempts |

Both link to `/backend/customer_accounts/{sourceEntityId}` for staff review.

## Widget Injection

### Injection Table

| Spot ID | Widget | Purpose |
|---------|--------|---------|
| `crud-form:customers:customer_person_profile:fields` | `account-status` | Shows portal account status on CRM person detail page |
| `crud-form:customers:customer_company_profile:fields` | `company-users` | Shows portal users linked to a CRM company |

Both inject as column 2 groups with priority 200, gated by `customer_accounts.view` feature.

## Backend Pages

| Path | Purpose |
|------|---------|
| `backend/customer_accounts/users/page.tsx` | Users list (`/backend/customer_accounts/users`) |
| `backend/customer_accounts/users/[id]/page.tsx` | User detail/edit |
| `backend/customer_accounts/roles/page.tsx` | Role list (`/backend/customer_accounts/roles`) |
| `backend/customer_accounts/roles/create/page.tsx` | Create role |
| `backend/customer_accounts/roles/[id]/page.tsx` | Role detail/edit ACL |
| `backend/customer_accounts/settings/page.tsx` | Portal settings |

### Staff Navigation

- Staff-facing `customer_accounts` pages belong in **Settings → Customer Portal**.
- Keep the whole section together: **Users**, **Roles**, and **Portal Settings** as peer items.
- Do not place these pages in the main **Customers** sidebar group unless a future spec explicitly changes the information architecture.

## Security

### Password Handling

- Hash with `bcryptjs` cost 10 (`BCRYPT_COST = 10`)
- Minimum 8 characters, maximum 128 characters
- Never log password values

### Account Lockout

- 5 failed login attempts triggers 15-minute lockout
- Failed attempts tracked per user in `failedLoginAttempts`
- Lockout stored as `lockedUntil` timestamp
- Successful login resets counter and clears lock

### Rate Limiting

All public endpoints have dual rate limits (per-identifier + per-IP). Defaults:

| Endpoint | Per-Email | Per-IP | Block Duration |
|----------|-----------|--------|----------------|
| Login | 5/60s | 20/60s | 60s |
| Signup | 3/60s | 10/60s | 120s |
| Password Reset | 3/60s | 10/60s | 120s |
| Magic Link | 3/60s | 10/60s | 120s |

Configurable via environment variables (`CUSTOMER_LOGIN_POINTS`, `CUSTOMER_LOGIN_DURATION`, etc.) using `readEndpointRateLimitConfig`.

### Token Security

- Tokens generated with `crypto.randomBytes(32)` (base64url)
- Tokens stored as SHA-256 hashes — raw tokens never persisted
- TTLs: email verification 24h, magic link 15min, password reset 60min, invitation 72h

### Email Privacy

- Emails stored in plaintext but lookups use `hashForLookup` (deterministic hash)
- Unique constraint on `(tenantId, emailHash)` prevents duplicates
- Error messages never confirm whether an email is registered

## Lib Utilities

| File | Exports | Purpose |
|------|---------|---------|
| `lib/customerAuth.ts` | `getCustomerAuthFromRequest`, `requireCustomerAuth`, `requireCustomerFeature`, `CustomerAuthContext` | Request-level auth helpers for API routes |
| `lib/customerAuthServer.ts` | `getCustomerAuthFromCookies` | Server component auth via Next.js `cookies()` |
| `lib/rateLimiter.ts` | Rate limit configs, `checkAuthRateLimit`, `resetAuthRateLimit` | Dual rate limiting for all public endpoints |
| `lib/tokenGenerator.ts` | `generateSecureToken`, `hashToken` | Cryptographic token generation and hashing |

## ACL Features (Staff-Side)

Declared in `acl.ts` — these control staff access to customer account management in the admin backend:

| Feature | Purpose |
|---------|---------|
| `customer_accounts.view` | View customer accounts and roles |
| `customer_accounts.manage` | Create, update, delete customer users |
| `customer_accounts.roles.manage` | Create, update, delete customer roles and ACLs |
| `customer_accounts.invite` | Invite customer users |

Default role assignments (from `setup.ts`):
- `superadmin`: `customer_accounts.*`
- `admin`: `customer_accounts.*`

## Key Directories

| Directory | When to modify |
|-----------|---------------|
| `api/post/` | When adding new public or admin write endpoints |
| `api/get/` | When adding read endpoints (admin or portal) |
| `api/put/` | When adding update endpoints |
| `api/delete/` | When adding deletion endpoints |
| `backend/` | When changing admin UI pages for customer management |
| `data/` | When changing ORM entities or zod validators |
| `lib/` | When modifying auth helpers, rate limiting, or token generation |
| `services/` | When modifying user, session, token, RBAC, or invitation logic |
| `subscribers/` | When adding event-driven side effects (CRM linking, notifications) |
| `workers/` | When modifying cleanup jobs for sessions/tokens |
| `widgets/injection/` | When adding/modifying widgets injected into CRM forms |
