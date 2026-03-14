# Customer Accounts Module (`customer_accounts`) — SPEC-060

## What Was Added

This branch introduces **SPEC-060: Customer Identity & Portal Authentication** — a full customer-facing authentication system that is completely separate from the staff/admin auth. It enables B2B/B2C portals where customers (external users) can sign up, log in, manage their profile, and be governed by their own RBAC system — while staff manage them from the backoffice.

**Scale**: ~6,700 lines across 76 files — entities, services, 30 API routes, 5 backend pages, 2 CRM injection widgets, 3 subscribers, 2 workers, events, notifications, i18n, and tests.

---

## Architecture: Two-Tier Identity Model

The key design principle is **complete separation** between staff auth and customer auth:

| Aspect | Staff Auth (existing) | Customer Auth (new) |
|--------|----------------------|---------------------|
| JWT type | `type` absent | `type: 'customer'` |
| Cookie name | `auth_token` | `customer_auth_token` |
| Session cookie | — | `customer_session_token` |
| Auth extractor | `getAuthFromRequest()` | `getCustomerAuthFromRequest()` |
| RBAC service | `RbacService` | `CustomerRbacService` |
| Feature namespace | `module.action` | `portal.scope.action` |
| Entities | `users`, `roles`, `user_acls` | `customer_users`, `customer_roles`, `customer_user_acls` |

Staff auth explicitly **rejects** customer JWTs (`if (payload.type === 'customer') return null`) and vice versa. This prevents any cross-context escalation.

---

## Core Mechanisms

### 1. Authentication Flow

**Login** (`POST /api/customer_accounts/login`):

1. Validate email + password + tenantId with zod
2. Check rate limits (IP + email compound)
3. Find user by email hash in tenant
4. Verify bcrypt password (cost 10)
5. Check lockout (5 failed attempts → 15 min lock)
6. On success: reset counters, load ACL, create session
7. Set two httpOnly cookies:
   - `customer_auth_token` (JWT, 8h) — carries identity + resolved features
   - `customer_session_token` (opaque, 30 days) — for session refresh/revocation

**Signup** (`POST /api/customer_accounts/signup`):

1. Rate limit, validate input
2. Create user with hashed password + email hash
3. Auto-assign default role (`isDefault: true`)
4. Generate email verification token (hashed before storage)
5. Emit `customer_accounts.user.created` event (subscribers send verification email)
6. Return 201 — user is NOT auto-logged-in

**Magic Link** (passwordless login):

- `POST /api/customer_accounts/magic-link/request` — generates token, emits event for email delivery. Always returns 200 (no email enumeration).
- `POST /api/customer_accounts/magic-link/verify` — validates token, auto-verifies email, creates session, sets cookies.

**Password Reset**:

- `POST /api/customer_accounts/password/reset-request` — generates token, emits event. Always returns 200.
- `POST /api/customer_accounts/password/reset-confirm` — validates token, updates password, **revokes all sessions** (security).

**Invitation**:

- Staff or portal admins create invitations with pre-assigned roles
- `POST /api/customer_accounts/invitations/accept` — creates user, assigns roles, auto-verifies email, auto-logs-in

**Session Refresh** (`POST /api/customer_accounts/portal/sessions-refresh`):

- Uses long-lived `customer_session_token` cookie to issue a fresh JWT
- Reloads ACL so feature changes take effect immediately

**Logout** (`POST /api/customer_accounts/portal/logout`):

- Revokes session record, clears both cookies

### 2. Token Security

All tokens (email verification, magic link, password reset, invitation) are:

- Generated with `crypto.randomBytes(32)` (256-bit entropy)
- **SHA-256 hashed before storage** — DB compromise doesn't leak usable tokens
- Single-use (`usedAt` timestamp set on redemption)
- Time-limited (15m magic link, 1h password reset, 24h email verify, 72h invitation)

### 3. Customer RBAC

**Two layers** of permission resolution:

1. **Direct user ACL** (`CustomerUserAcl`) — per-user override, checked first
2. **Role aggregation** (`CustomerUserRole` → `CustomerRoleAcl`) — union of all assigned roles' features; `isPortalAdmin` = OR of all roles

**Three default roles** seeded per tenant:

| Role | Slug | Features | Assignable by customers | Default |
|------|------|----------|------------------------|---------|
| Portal Admin | `portal_admin` | `portal.*` (wildcard) | No (staff only) | No |
| Buyer | `buyer` | orders, quotes, invoices, catalog, account | Yes | **Yes** (auto-assigned on signup) |
| Viewer | `viewer` | orders (view), invoices, catalog, account | Yes | No |

**Caching**: RBAC results cached for 5 minutes with tag-based invalidation. Role changes flush all customer RBAC; user changes flush only that user.

**Feature matching**: Supports wildcards (`portal.*` grants `portal.orders.view`, `portal.profile.edit`, etc.) via `matchFeature()` from `@open-mercato/shared/lib/auth/featureMatch`.

### 4. CRM Auto-Linking (Bidirectional)

Two event subscribers create automatic links between customer portal accounts and CRM records:

- **Forward** (`customer_accounts.user.created` → find CRM person by email hash → set `personEntityId` + `customerEntityId` on user)
- **Reverse** (`customers.person.created` → find customer user by email hash → set `personEntityId` + `customerEntityId` on user)

This means: if a CRM person exists when a customer signs up, they get linked. If a customer account exists when a CRM person is created, they also get linked. Both directions are idempotent and best-effort.

### 5. Database Schema

8 new tables, all with UUID PKs, tenant scoping, and soft deletes:

```
customer_users                    — main user accounts (email hash indexed, unique per tenant)
customer_roles                    — role definitions (slug unique per tenant)
customer_role_acls                — features per role (1:1 with role)
customer_user_roles               — user<->role junction (unique pair)
customer_user_acls                — per-user permission overrides
customer_user_sessions            — session tokens (hash indexed)
customer_user_email_verifications — email/magic-link tokens
customer_user_password_resets     — password reset tokens
customer_user_invitations         — invitation tokens with role assignment
```

**Entity Relationship Diagram**:

```
CustomerUser
├── tenantId, organizationId
├── email + emailHash (unique per tenant)
├── passwordHash (bcrypt)
├── personEntityId  ──→  CRM Person (auto-linked)
├── customerEntityId ──→ CRM Company (auto-linked)
├── isActive, failedLoginAttempts, lockedUntil, lastLoginAt
│
├── [1 → N] CustomerUserRole ──→ CustomerRole
│                                   └── [1 → 1] CustomerRoleAcl
│                                         ├── featuresJson[]
│                                         └── isPortalAdmin
│
├── [1 → 0..1] CustomerUserAcl (direct override)
│
├── [1 → N] CustomerUserSession
│              ├── tokenHash
│              ├── ipAddress, userAgent
│              └── expiresAt, lastUsedAt
│
├── [1 → N] CustomerUserEmailVerification
│              ├── token (hashed), purpose, expiresAt, usedAt
│
├── [1 → N] CustomerUserPasswordReset
│              └── token (hashed), expiresAt, usedAt
│
└── CustomerUserInvitation (standalone, links on acceptance)
               ├── email + emailHash, token (hashed)
               ├── roleIdsJson[], customerEntityId
               ├── invitedByUserId / invitedByCustomerUserId
               └── expiresAt, acceptedAt, cancelledAt
```

### 6. Events

13 typed events declared with `createModuleEvents()`:

- **CRUD**: `user.created` (broadcast), `user.updated`, `user.deleted`, `role.created/updated/deleted`
- **Lifecycle**: `login.success`, `login.failed`, `email.verified`, `password.reset`, `user.locked/unlocked`
- **Invitation**: `invitation.accepted` (broadcast)

Events with `clientBroadcast: true` propagate to the browser via SSE for real-time UI updates.

### 7. Admin Backend UI

5 pages under `/backend/customer_accounts/`:

| Page | URL | Feature | What it does |
|------|-----|---------|-------------|
| Users list | `/backend/customer_accounts` | `customer_accounts.view` | DataTable with search, status/role filters, activate/deactivate/delete actions |
| User detail | `/backend/customer_accounts/{id}` | `customer_accounts.view` | View/edit user, toggle active, assign roles, view/revoke sessions, CRM links |
| Roles list | `/backend/customer_accounts/roles` | `customer_accounts.view` | DataTable with search, system/default/assignable badges, delete (non-system) |
| Role detail | `/backend/customer_accounts/roles/{id}` | `customer_accounts.roles.manage` | Edit name/description/flags, manage portal permissions with grouped checkboxes |
| Create role | `/backend/customer_accounts/roles/create` | `customer_accounts.roles.manage` | Form with auto-slug, flags |

### 8. CRM Widget Injections

Two widgets injected into the existing Customers module forms:

- **Account Status** → injected into Person profile form (`crud-form:customers:customer_person_profile:fields`). Shows portal account status, email, verified flag, last login, link to account detail.
- **Company Users** → injected into Company profile form (`crud-form:customers:customer_company_profile:fields`). Lists all portal users linked to that company with status and view links.

---

## How to Test Manually

### Prerequisites

```bash
yarn dev                # Start dev server
yarn db:migrate         # Apply the new migration (creates 8 customer_* tables)
```

If this is a fresh tenant, the module's `setup.ts` will automatically seed the 3 default roles (Portal Admin, Buyer, Viewer) on tenant creation. For existing tenants, trigger a re-seed or call the setup hooks.

### Test 1: Admin User Management

1. Log in as staff admin
2. Navigate to `/backend/customer_accounts` — should see empty user list
3. Navigate to `/backend/customer_accounts/roles` — should see 3 system roles (Portal Admin, Buyer, Viewer)
4. Click "Create Role" — create a custom role (e.g., "Manager")
5. Go to the new role detail — check some portal permissions, click Save

### Test 2: Customer Signup Flow

```bash
# 1. Sign up a new customer
curl -X POST http://localhost:3000/api/customer_accounts/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Password123!",
    "displayName": "Test User",
    "tenantId": "<your-tenant-id>",
    "organizationId": "<your-org-id>"
  }'
# Expect: 201 with user object, emailVerified: false
# Check: user appears in admin list at /backend/customer_accounts
# Check: Buyer role auto-assigned
```

### Test 3: Customer Login + Session

```bash
# 2. Log in
curl -X POST http://localhost:3000/api/customer_accounts/login \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{
    "email": "test@example.com",
    "password": "Password123!",
    "tenantId": "<your-tenant-id>"
  }'
# Expect: 200 with user + resolvedFeatures
# Check: cookies.txt has customer_auth_token and customer_session_token

# 3. Access portal profile
curl http://localhost:3000/api/customer_accounts/portal/profile \
  -b cookies.txt
# Expect: 200 with full profile, roles, features, isPortalAdmin flag

# 4. Refresh session (new JWT from session token)
curl -X POST http://localhost:3000/api/customer_accounts/portal/sessions-refresh \
  -b cookies.txt -c cookies.txt
# Expect: 200 with new resolvedFeatures, updated customer_auth_token cookie
```

### Test 4: Password Reset

```bash
# 5. Request reset (always returns 200)
curl -X POST http://localhost:3000/api/customer_accounts/password/reset-request \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "tenantId": "<your-tenant-id>"}'

# Check server logs/events for the emitted token
# Then confirm with the token:
curl -X POST http://localhost:3000/api/customer_accounts/password/reset-confirm \
  -H "Content-Type: application/json" \
  -d '{"token": "<token-from-event>", "password": "NewPassword456!"}'
# Expect: 200, all sessions revoked, old password no longer works
```

### Test 5: Account Lockout

```bash
# 6. Attempt login 5 times with wrong password
for i in {1..5}; do
  curl -X POST http://localhost:3000/api/customer_accounts/login \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","password":"wrong","tenantId":"<id>"}'
done
# 5th attempt should trigger lockout

# 7. Try again with correct password
curl -X POST http://localhost:3000/api/customer_accounts/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"NewPassword456!","tenantId":"<id>"}'
# Expect: 423 "Account is temporarily locked" (15 min duration)
```

### Test 6: Rate Limiting

```bash
# 8. Rapid-fire login attempts from same IP
for i in {1..20}; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST http://localhost:3000/api/customer_accounts/login \
    -H "Content-Type: application/json" \
    -d '{"email":"any@test.com","password":"x","tenantId":"<id>"}'
done
# Expect: 429 after exceeding IP rate limit (5 attempts/60s)
```

### Test 7: Invitation Flow

1. In admin panel at `/backend/customer_accounts`, use the API:

```bash
curl -X POST http://localhost:3000/api/customer_accounts/admin/users-invite \
  -H "Content-Type: application/json" \
  -H "Cookie: auth_token=<staff-jwt>" \
  -d '{
    "email": "invited@example.com",
    "roleIds": ["<buyer-role-id>"],
    "displayName": "Invited User"
  }'
# Check events for invitation token
```

2. Accept the invitation:

```bash
curl -X POST http://localhost:3000/api/customer_accounts/invitations/accept \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{
    "token": "<invitation-token>",
    "password": "Password123!",
    "displayName": "Invited User"
  }'
# Expect: 201, auto-logged-in, email auto-verified, Buyer role assigned
```

### Test 8: CRM Auto-Linking

1. Create a customer user with email `alice@company.com`
2. In Customers CRM, create a Person with the same email
3. Reload the Person detail page — the Account Status widget should show the linked portal account
4. Reload the customer user detail — should show linked Person entity with a "View person" link

### Test 9: Admin Role Management

1. Go to `/backend/customer_accounts/roles/{buyer-role-id}`
2. Uncheck "Create orders" from portal permissions, click Save
3. Refresh the customer's session (`POST /api/customer_accounts/portal/sessions-refresh`)
4. Verify `portal.orders.create` is no longer in `resolvedFeatures`

### Test 10: Session Management

1. Log in as a customer (creates a session)
2. In admin panel, go to the customer's detail page
3. See the session listed with IP and user agent
4. Click "Revoke" — session revoked
5. Try to refresh the customer session — should get 401

### Test 11: Staff/Customer Auth Separation

```bash
# Use a customer JWT in a staff endpoint
curl http://localhost:3000/api/auth/profile \
  -H "Cookie: auth_token=<customer-jwt>"
# Expect: 401 (staff auth rejects customer tokens)

# Use a staff JWT in a customer endpoint
curl http://localhost:3000/api/customer_accounts/portal/profile \
  -H "Cookie: customer_auth_token=<staff-jwt>"
# Expect: 401 (customer auth rejects non-customer tokens)
```

---

## API Reference

### Public Endpoints (No Auth)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/customer_accounts/signup` | Register new customer account |
| POST | `/api/customer_accounts/login` | Authenticate with email + password |
| POST | `/api/customer_accounts/magic-link/request` | Request passwordless login link |
| POST | `/api/customer_accounts/magic-link/verify` | Verify magic link token |
| POST | `/api/customer_accounts/email/verify` | Verify email address |
| POST | `/api/customer_accounts/password/reset-request` | Request password reset |
| POST | `/api/customer_accounts/password/reset-confirm` | Confirm password reset |
| POST | `/api/customer_accounts/invitations/accept` | Accept invitation |

### Portal Endpoints (Customer Auth Required)

| Method | Path | Feature | Purpose |
|--------|------|---------|---------|
| GET | `/api/customer_accounts/portal/profile` | — | Get authenticated user profile |
| PUT | `/api/customer_accounts/portal/profile` | `portal.account.manage` | Update profile |
| POST | `/api/customer_accounts/portal/password-change` | — | Change password |
| GET | `/api/customer_accounts/portal/sessions` | — | List own sessions |
| POST | `/api/customer_accounts/portal/sessions-refresh` | — | Refresh JWT from session |
| POST | `/api/customer_accounts/portal/logout` | — | Logout and clear cookies |
| GET | `/api/customer_accounts/portal/users` | `portal.users.view` | List company team members |
| POST | `/api/customer_accounts/portal/users-invite` | `portal.users.manage` | Invite team member |
| PUT | `/api/customer_accounts/portal/users/{id}/roles` | `portal.users.manage` | Assign roles to team member |
| DELETE | `/api/customer_accounts/portal/users/{id}` | `portal.users.manage` | Remove team member |
| DELETE | `/api/customer_accounts/portal/sessions/{id}` | — | Revoke own session |

### Admin Endpoints (Staff Auth Required)

| Method | Path | Feature | Purpose |
|--------|------|---------|---------|
| GET | `/api/customer_accounts/admin/users` | `customer_accounts.view` | List all customer users |
| GET | `/api/customer_accounts/admin/users/{id}` | `customer_accounts.view` | Get customer user detail |
| PUT | `/api/customer_accounts/admin/users/{id}` | `customer_accounts.manage` | Update customer user |
| DELETE | `/api/customer_accounts/admin/users/{id}` | `customer_accounts.manage` | Delete customer user |
| POST | `/api/customer_accounts/admin/users-invite` | `customer_accounts.invite` | Invite customer user |
| GET | `/api/customer_accounts/admin/roles` | `customer_accounts.view` | List customer roles |
| GET | `/api/customer_accounts/admin/roles/{id}` | `customer_accounts.view` | Get role detail |
| POST | `/api/customer_accounts/admin/roles` | `customer_accounts.roles.manage` | Create role |
| PUT | `/api/customer_accounts/admin/roles/{id}` | `customer_accounts.roles.manage` | Update role |
| PUT | `/api/customer_accounts/admin/roles/{id}/acl` | `customer_accounts.roles.manage` | Update role permissions |
| DELETE | `/api/customer_accounts/admin/roles/{id}` | `customer_accounts.roles.manage` | Delete role |
