# SPEC-060: Customer Identity & Portal Authentication

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Author** | Open Mercato Team |
| **Created** | 2026-03-04 |
| **Related** | SPEC-029 (Ecommerce Storefront), SPEC-053 (B2B PRM Starter), SPEC-041 (UMES) |

## TLDR
**Key Points:**
- New `customer_accounts` core module at `packages/core/src/modules/customer_accounts/` providing a **two-tier customer identity layer**: `CustomerUser` (the person who logs in) linked to CRM entities (the company they represent and the person record they are).
- **Full RBAC for customer users** mirroring the staff system: `CustomerRole` + `CustomerRoleAcl` + `CustomerUserRole` + `CustomerUserAcl`, with wildcard feature matching via shared `matchFeature()` extracted to `packages/shared/src/lib/auth/featureMatch.ts`.
- Separate JWT pipeline with `customer_auth_token` cookie and `type: 'customer'` discriminator — fully isolated from staff auth.
- Portal access is an **RBAC feature** (`portal.storefront.access`, `portal.partner.access`), not a separate entity. One system controls all authorization.
- **Invitation system** for customer admin self-service user onboarding and staff-initiated invitations.

**Scope:**
- 9-entity data model: `CustomerUser`, `CustomerRole`, `CustomerRoleAcl`, `CustomerUserRole`, `CustomerUserAcl`, `CustomerUserSession`, `CustomerUserEmailVerification`, `CustomerUserPasswordReset`, `CustomerUserInvitation`.
- Customer user lifecycle: signup, login, email verification, password reset, magic link.
- Session management with refresh tokens, device tracking, and revocation.
- Full RBAC: roles, features, per-user overrides, `is_portal_admin` flag.
- Customer portal self-service: profile, sessions, company user management.
- Staff admin CRUD for users, roles, and ACL.
- CRM integration: auto-link to person and company entities, UMES widgets.
- Invitation flow: staff-initiated and customer-admin-initiated.
- Defensive guard in existing `getAuthFromRequest()` to reject customer JWTs.
- Extract `matchFeature()`/`hasAllFeatures()` to shared package.

**Concerns:**
- JWT cross-acceptance between staff and customer tokens is a critical security risk requiring defensive checks on both sides.
- Email delivery reliability affects signup, verification, magic link, and invitation flows.
- CRM auto-linking by email is probabilistic; multiple person records may share an email.
- RBAC cache invalidation must be correct — stale permissions are a security risk.

## Overview

Open Mercato has mature staff authentication (JWT + refresh tokens, RBAC, multi-tenant) and a rich CRM customers module, but customers are passive data objects with no self-service capability. This blocks downstream specs that require authenticated customer experiences:

- **SPEC-029** (Ecommerce Storefront) explicitly deferred customer account design as Open Question #1.
- **SPEC-053** (B2B PRM) needs partner self-onboarding with authenticated identity.
- Any future self-service portal (support tickets, order tracking, document signing) requires customer auth.

The critical insight is that **a customer (company) is not the entity that logs in — people log in on behalf of a customer**. This demands a two-tier model where `CustomerUser` is the authenticatable identity, connected to a CRM person (who they are) and optionally to a CRM company (who they represent). Multiple users can represent the same customer with different access levels, controlled by a full RBAC system that mirrors the staff auth architecture.

> **Market Reference**: Studied **SAP Commerce Cloud** (B2BCustomer/B2BUnit hierarchy with purchase-threshold RBAC and OAuth 2.0), **OroCommerce** (Customer/CustomerUser composition with 4-level entity ACL scoping: User/Department/Corporate/None), **Magento 2 / Adobe Commerce** (customer_entity + company linkage table with per-company resource-permission roles), **Shopify Customer Accounts API** (headless customer identity with multi-user B2B support), **Saleor** (customer + company member model with role-based permissions), and **Keycloak** (realm-based isolation with group-scoped roles). Adopted: composition over inheritance for identity model — `CustomerUser` linked to CRM entities via FK IDs, not via class inheritance (OroCommerce/Magento pattern; avoids SAP's `B2BCustomer extends Customer` coupling that pollutes B2C). Full feature-based RBAC (Magento's resource-permission model, not SAP's financial-threshold-only approach). Strict realm isolation (Keycloak). Magic link as first-class auth method (Supabase). Portal access as RBAC feature — novel pattern not found in any reference platform (all use separate configuration). `customer_assignable` flag on roles to prevent customer admins from self-assigning privileged roles (inspired by OroCommerce's `selfManaged`/`public` role flags). Rejected: OAuth/OIDC complexity for MVP (Keycloak), social login providers (deferred), single shared user table (all recommend separation for security isolation), flat portal-access-list approach (insufficient for B2B multi-user scenarios), entity-level ACL scoping for MVP (OroCommerce's User/Department/Corporate levels deferred to future extension — see Future Extensions).

## Problem Statement

1. **No customer-facing authentication**: Customers exist only as CRM records (`CustomerEntity`) — they cannot sign up, log in, or access any self-service features.
2. **Blocked downstream specs**: SPEC-029 and SPEC-053 both require customer auth but cannot implement it independently without creating conflicting approaches.
3. **Staff auth is unsuitable for customers**: The existing `User` entity is designed for internal staff with RBAC, organization switching, and admin capabilities. Reusing it for customers introduces privilege escalation risk and semantic confusion.
4. **Multiple users per customer**: In B2B, a company (customer) may have multiple people who need portal access — a procurement manager, a project lead, and an accounts payable contact — each with different permissions. A flat one-account-per-customer model cannot represent this.
5. **No portal authorization mechanism**: Even if customers could authenticate, there is no mechanism to control which portals/features they can access, at what granularity.

## Proposed Solution

Create a `customer_accounts` core module with a two-tier identity model and full RBAC:

1. **`CustomerUser` entity** — the person who logs in. Linked to CRM via two FK IDs: `person_entity_id` (who they are in CRM) and `customer_entity_id` (which company they represent). Both nullable to support progressive linking and B2C scenarios.
2. **Full RBAC** mirroring staff system: `CustomerRole` → `CustomerRoleAcl` (features + `is_portal_admin`), `CustomerUserRole` (M:M), `CustomerUserAcl` (per-user override). Same wildcard matching logic, extracted to a shared utility.
3. **Portal access as RBAC features**: Instead of a separate `PortalAccess` entity, portal authorization uses feature checks (`portal.storefront.access`, `portal.partner.access`). One system, maximum flexibility.
4. **Isolated JWT pipeline** using distinct cookie (`customer_auth_token`), distinct JWT discriminator (`type: 'customer'`), and separate TTLs.
5. **Two auth methods**: email/password (primary) and magic link (passwordless).
6. **Invitation system**: Customer admins (with `portal.users.manage`) can invite people from their company. Staff can also invite directly.
7. **CRM integration** via event-driven auto-linking and UMES widgets for staff visibility.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| `CustomerUser` (not `CustomerAccount`) as entity name | A "user" is the person who authenticates. An "account" implies a singular identity per customer. The new model supports multiple users per customer — "user" is the correct term. |
| Two CRM links: `person_entity_id` + `customer_entity_id` | The person link identifies WHO this user is in CRM (their contact record, activities, deals). The company link identifies WHICH customer they represent in the portal. Decoupling these supports: B2C (no company), multi-company (future), and progressive CRM linking. |
| Full RBAC instead of simple portal-access list | B2B customers need granular permissions: one user can place orders, another can only view them, a third manages other users. A portal-access string list cannot express this. RBAC provides infinite granularity with a proven pattern. |
| Portal access as RBAC feature, not separate entity | `portal.storefront.access` is a feature check via RBAC. This eliminates the `CustomerAccountPortalAccess` table and unifies all authorization into one system. Adding a new portal = adding a new feature, no schema changes. |
| Mirror staff RBAC exactly | Same resolution logic (user ACL overrides → aggregate role ACLs), same wildcard matching, same `is_portal_admin` / `is_super_admin` concept. Reduces cognitive load, enables code sharing. |
| Extract `matchFeature()` to shared | The wildcard matching logic in `RbacService` (lines 63-76) is duplicated for customer RBAC. Extracting to `packages/shared/src/lib/auth/featureMatch.ts` ensures both services use identical logic. |
| Tenant-level roles (not per-customer) | Roles are defined once per tenant (e.g., "Portal Admin", "Buyer", "Viewer"). All customers share the same role definitions. Different permission sets are achieved by assigning different roles to different users. Per-customer roles would add complexity with minimal benefit in MVP. |
| One `CustomerUser` per email per tenant | Prevents confusion from multi-company login. Multi-company access (one person, multiple customers) is a future extension using a junction entity. |
| Invitation system with secure token | Customer admins should be able to onboard their own team. Staff can also invite. Uses a time-limited token (72h TTL) with email delivery. |
| Nullable `customer_entity_id` | B2C users have no company. B2B users may sign up before their company is set up in CRM. Progressive linking via subscriber or staff action. |
| Application-level `kind='person'` validation on person link | Database FK goes to `customer_entities.id` (no DB-level kind constraint). Validation in the linking logic ensures only person-kind entities are linked. |
| Separate JWT cookie (`customer_auth_token`) | Prevents accidental cross-acceptance. Staff middleware reads `auth_token`, customer middleware reads `customer_auth_token`. |
| `customer_assignable` flag on `CustomerRole` | Customer admins with `portal.users.roles.manage` can only assign roles where `customer_assignable: true`. Prevents self-escalation to privileged roles like `portal_admin`. Staff can assign any role regardless. Inspired by OroCommerce's `selfManaged`/`public` role flags and Magento's irrevocable company-admin concept. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Reuse staff `User` entity with `type` discriminator | Privilege escalation risk, pollutes staff auth with customer fields, complicates RBAC. Every staff auth query would need `type` filtering. |
| Flat `CustomerAccount` with portal-access-list | Cannot support multiple users per customer, cannot express granular B2B permissions. Rejected by stakeholder review. |
| Per-customer role definitions | Adds complexity: tenant admin must manage N × M role definitions instead of N. Tenant-level roles with per-user assignment achieve the same result. |
| Link `CustomerUser` to `CustomerPersonProfile` instead of `CustomerEntity` | `CustomerPersonProfile` is a subordinate 1:1 extension. Primary email lives on `CustomerEntity`. Linking to the parent provides access to the full CRM graph. |
| Encode portal access in JWT claims | Portal grants change dynamically. JWT claims are static until refresh. Would require forced re-authentication on permission changes. |
| OAuth 2.0 / OIDC from the start | Over-engineering for email/password + magic link. Social login is a natural future extension. |

## User Stories / Use Cases

### Customer Self-Service
- **Customer user** wants to **sign up with email and password** so that they can **access the storefront and track orders**.
- **Customer user** wants to **log in via magic link** so that they can **access their account without remembering a password**.
- **Customer user** wants to **verify their email** so that their **account is fully activated and trustworthy**.
- **Customer user** wants to **reset their password** so that they can **regain access if they forget credentials**.
- **Customer user** wants to **view and revoke active sessions** so that they can **secure their account if a device is compromised**.

### Customer Admin (portal.users.manage)
- **Customer admin** wants to **invite a colleague to the portal** so that **their team can collaborate on orders**.
- **Customer admin** wants to **view all users from their company** so that they can **manage team access**.
- **Customer admin** wants to **assign roles to company users** so that they can **control who can place orders vs. only view them**.
- **Customer admin** wants to **remove a user from their company** so that **former employees lose access**.

### Staff Administration
- **Staff admin** wants to **view all customer users** so that they can **support customers and manage access**.
- **Staff admin** wants to **manage customer roles and their permissions** so that they can **define what each role can do across all portals**.
- **Staff admin** wants to **see account status on the CRM person detail page** so that they have **full context when interacting with a customer**.
- **Staff admin** wants to **invite a customer user directly** so that they can **onboard key contacts during sales handoff**.
- **Staff admin** wants to **lock/unlock a customer user** so that they can **handle abuse or support requests**.

### Integration
- **Storefront module** wants to **check `portal.storefront.access` feature** so that it can **serve authenticated pages to authorized users only**.
- **PRM module** wants to **subscribe to user creation events** so that it can **auto-assign partner roles**.

## Architecture

### Module Topology
```text
packages/core/src/modules/customer_accounts/
  index.ts                    # Module metadata
  acl.ts                      # Staff admin features
  di.ts                       # Service registration (Awilix)
  events.ts                   # Typed event declarations
  setup.ts                    # Tenant init, default roles seeding, default role features
  notifications.ts            # Notification type definitions
  notifications.client.ts     # Client-side notification renderers
  translations.ts             # Translatable fields
  data/
    entities.ts               # MikroORM entities (9 entities)
    validators.ts             # Zod schemas
    extensions.ts             # Extension link to customers module
  lib/
    customerAuth.ts           # getCustomerAuthFromRequest(), middleware helpers
    tokenGenerator.ts         # Secure token generation (256-bit)
    rateLimiter.ts            # Compound IP+email rate limiting
  services/
    customerUserService.ts    # User CRUD, password hashing, lockout
    customerSessionService.ts # Session/refresh token management
    customerTokenService.ts   # Email verification, magic link, password reset tokens
    customerRbacService.ts    # RBAC resolution (mirrors staff RbacService)
    customerInvitationService.ts # Invitation creation, acceptance, validation
  commands/
    signup.ts                 # Signup command
    login.ts                  # Login command
    requestMagicLink.ts       # Magic link request command
    verifyMagicLink.ts        # Magic link verification command
    verifyEmail.ts            # Email verification command
    requestPasswordReset.ts   # Password reset request command
    confirmPasswordReset.ts   # Password reset confirmation command
    updateProfile.ts          # Profile update command
    changePassword.ts         # Password change command
    revokeSession.ts          # Session revocation command
    inviteUser.ts             # Invitation creation (staff or customer admin)
    acceptInvitation.ts       # Invitation acceptance with account setup
    assignRoles.ts            # Role assignment to user (staff or customer admin)
    removeUser.ts             # Remove user from company (soft delete)
  api/
    post/
      signup.ts               # POST /api/customer-accounts/signup
      login.ts                # POST /api/customer-accounts/login
    magic-link/
      post/request.ts         # POST /api/customer-accounts/magic-link/request
      post/verify.ts          # POST /api/customer-accounts/magic-link/verify
    email/
      post/verify.ts          # POST /api/customer-accounts/email/verify
    password/
      post/reset-request.ts   # POST /api/customer-accounts/password/reset-request
      post/reset-confirm.ts   # POST /api/customer-accounts/password/reset-confirm
    invitations/
      post/accept.ts          # POST /api/customer-accounts/invitations/accept
    portal/
      get/profile.ts          # GET  /api/customer-portal/profile
      put/profile.ts          # PUT  /api/customer-portal/profile
      post/password-change.ts # POST /api/customer-portal/password/change
      get/sessions.ts         # GET  /api/customer-portal/sessions
      delete/sessions/[id].ts # DELETE /api/customer-portal/sessions/:id
      post/sessions-refresh.ts # POST /api/customer-portal/sessions/refresh
      post/logout.ts          # POST /api/customer-portal/logout
      get/users.ts            # GET  /api/customer-portal/users
      post/users-invite.ts    # POST /api/customer-portal/users/invite
      put/users/[id]/roles.ts # PUT  /api/customer-portal/users/:id/roles
      delete/users/[id].ts    # DELETE /api/customer-portal/users/:id
    admin/
      get/users.ts            # GET  /api/customer-accounts/admin/users
      get/users/[id].ts       # GET  /api/customer-accounts/admin/users/:id
      put/users/[id].ts       # PUT  /api/customer-accounts/admin/users/:id
      delete/users/[id].ts    # DELETE /api/customer-accounts/admin/users/:id
      post/users-invite.ts    # POST /api/customer-accounts/admin/users/invite
      get/roles.ts            # GET  /api/customer-accounts/admin/roles
      post/roles.ts           # POST /api/customer-accounts/admin/roles
      get/roles/[id].ts       # GET  /api/customer-accounts/admin/roles/:id
      put/roles/[id].ts       # PUT  /api/customer-accounts/admin/roles/:id
      delete/roles/[id].ts    # DELETE /api/customer-accounts/admin/roles/:id
      put/roles/[id]/acl.ts   # PUT  /api/customer-accounts/admin/roles/:id/acl
    interceptors.ts           # API interceptors (none initially)
  subscribers/
    autoLinkCrm.ts            # Auto-link person entity on user creation
    autoLinkCrmReverse.ts     # Auto-link when new CRM person created with matching email
    notifyStaffOnSignup.ts    # Notify staff when customer signs up
  workers/
    cleanupExpiredSessions.ts # Daily cleanup of expired session rows
    cleanupExpiredTokens.ts   # Daily cleanup of used/expired verification, reset, and invitation tokens
  backend/
    page.tsx                  # /backend/customer_accounts — staff "Customers Portal" list (Settings → Customer Portal)
    [id]/
      page.tsx                # /backend/customer_accounts/:id — admin user detail
    roles/
      page.tsx                # /backend/customer_accounts/roles — role management
      [id]/
        page.tsx              # /backend/customer_accounts/roles/:id — role detail + ACL editor
    settings/
      page.tsx                # /backend/customer_accounts/settings — portal settings
  widgets/
    injection/
      AccountStatusCard.tsx   # UMES widget: account status on CRM person detail
      CompanyUsersCard.tsx    # UMES widget: portal users on CRM company detail
    injection-table.ts        # Widget-to-slot mappings

packages/shared/src/lib/auth/
  featureMatch.ts             # Shared matchFeature() + hasAllFeatures() (extracted from rbacService)
```

### Auth Pipeline Isolation

```text
┌─────────────────────┐     ┌──────────────────────────┐
│   Staff Request      │     │  Customer User Request     │
│  (auth_token cookie) │     │ (customer_auth_token)      │
└─────────┬───────────┘     └──────────┬───────────────┘
          │                             │
          ▼                             ▼
  getAuthFromRequest()         getCustomerAuthFromRequest()
  ├─ reads auth_token          ├─ reads customer_auth_token
  ├─ verifyJwt()               ├─ verifyJwt()
  ├─ REJECTS type='customer'   ├─ REQUIRES type='customer'
  └─ returns AuthContext        └─ returns CustomerAuthContext
                                  ├─ loads RBAC (CustomerRbacService)
                                  └─ resolvedFeatures: string[]
```

### Two-Tier Identity Model

```text
CustomerEntity (kind='company') ─── the "customer" (existing CRM entity, no new table)
  │
  ├── CustomerUser 1 (linked to CRM person via person_entity_id)
  │     ├── email: alice@acme.com, auth credentials
  │     └── Roles: [portal_admin] → features: portal.*
  │
  ├── CustomerUser 2 (linked to CRM person via person_entity_id)
  │     ├── email: bob@acme.com, auth credentials
  │     └── Roles: [buyer] → features: portal.storefront.*
  │
  └── CustomerUser 3 (linked to CRM person via person_entity_id)
        ├── email: carol@acme.com, auth credentials
        └── Roles: [viewer] → features: portal.storefront.orders.view
```

### CRM Linking — Dual Connection

The `CustomerUser` connects to CRM through two nullable FKs:

```text
┌──────────────────┐        ┌──────────────────────┐
│  CustomerUser     │   FK   │   CustomerEntity      │
│                   │───────►│  (kind='company')     │
│ customer_entity_  │        │  Company record       │
│ id (nullable)     │        └──────────────────────┘
│                   │
│                   │        ┌──────────────────────┐        ┌──────────────────────┐
│ person_entity_    │   FK   │   CustomerEntity      │  1:1   │ CustomerPersonProfile │
│ id (nullable)     │───────►│  (kind='person')      │◄──────│  firstName, lastName, │
│                   │        │  Contact record       │        │  jobTitle, etc.       │
│ email             │        └──────────────────────┘        └──────────────────────┘
└──────────────────┘

Auto-link by email match (subscriber: customer_accounts.user.created):
  1. Find CustomerEntity WHERE primaryEmail = user.email
     AND kind = 'person' AND tenant_id = user.tenant_id
  2. If exactly one match → set person_entity_id
  3. If matched person has company → set customer_entity_id
  4. If zero matches → leave null (link later)
  5. If multiple matches → leave null, emit ambiguity event
```

**Why two links:**
- `person_entity_id` connects the login identity to the CRM person (their name, phone, activities, deals).
- `customer_entity_id` connects the user to the company they represent in the portal. This determines which company's orders/quotes/data they see.
- B2C users have `customer_entity_id = NULL` (no company).
- A person CRM record may belong to a company (`CustomerPersonProfile.company_entity_id`), which the auto-link subscriber uses to derive `customer_entity_id`.

### RBAC Resolution (mirrors staff exactly)

```text
┌──────────────────────────────────────────────────────┐
│  CustomerRbacService.loadAcl(userId, scope)          │
│                                                       │
│  1. Check CustomerUserAcl for user+tenant             │
│     → if found, use exclusively (override mode)       │
│                                                       │
│  2. Otherwise, aggregate CustomerRoleAcl from         │
│     all assigned roles (via CustomerUserRole)         │
│     → union all features_json arrays                  │
│     → Phase 1: extractFeatureStrings() to get         │
│       flat string array (scope metadata preserved     │
│       in raw entries for future Extension 1)          │
│                                                       │
│  3. is_portal_admin grants all portal.* features      │
│     (like staff isSuperAdmin for all features)        │
│                                                       │
│  4. Wildcard matching via shared matchFeature()       │
│     from @open-mercato/shared/lib/auth/featureMatch   │
│                                                       │
│  5. Return: resolvedFeatures (string[]) for JWT +     │
│     rawEntries (FeatureEntry[]) for future scope use  │
└──────────────────────────────────────────────────────┘
```

### Event and Command Contract

**Commands:**
- `customer_accounts.user.signup` — Create user with email/password, assign default role
- `customer_accounts.user.login` — Authenticate with email/password
- `customer_accounts.user.login_magic_link` — Authenticate via magic link
- `customer_accounts.user.verify_email` — Verify email address
- `customer_accounts.user.request_magic_link` — Request magic link token
- `customer_accounts.user.request_password_reset` — Request password reset
- `customer_accounts.user.confirm_password_reset` — Confirm password reset with token
- `customer_accounts.user.change_password` — Change password (authenticated)
- `customer_accounts.user.update_profile` — Update display name
- `customer_accounts.user.invite` — Create invitation (staff or customer admin)
- `customer_accounts.user.accept_invitation` — Accept invitation, create user, assign roles
- `customer_accounts.user.assign_roles` — Assign roles to user
- `customer_accounts.user.remove` — Remove user from company (soft delete)
- `customer_accounts.session.revoke` — Revoke a specific session

**Events:**
- `customer_accounts.user.created` — After successful signup or invitation acceptance (`{ userId, email, tenantId, customerEntityId }`)
- `customer_accounts.user.email_verified` — After email verification (`{ userId }`)
- `customer_accounts.user.logged_in` — After successful login (`{ userId, method: 'password' | 'magic_link' }`)
- `customer_accounts.user.login_failed` — After failed login attempt (`{ email, reason, tenantId }`)
- `customer_accounts.user.locked` — After lockout triggered (`{ userId }`)
- `customer_accounts.user.password_changed` — After password change/reset (`{ userId }`)
- `customer_accounts.user.crm_linked` — After CRM entity linked (`{ userId, personEntityId, customerEntityId }`)
- `customer_accounts.user.crm_link_ambiguous` — Multiple CRM matches found (`{ userId, email, matchCount }`)
- `customer_accounts.user.invited` — After invitation created (`{ invitationId, email, customerEntityId, invitedByType }`)
- `customer_accounts.user.roles_assigned` — After roles assigned to user (`{ userId, roleIds }`)
- `customer_accounts.user.removed` — After user soft-deleted (`{ userId, customerEntityId }`)
- `customer_accounts.session.created` — After new session created (`{ userId, sessionId }`)
- `customer_accounts.session.revoked` — After session revoked (`{ userId, sessionId }`)

**Client broadcast events** (`clientBroadcast: true`):
- `customer_accounts.user.created` — Staff dashboard real-time signup notifications
- `customer_accounts.user.locked` — Staff notification of security events

### Subscriber Contracts

| Subscriber | Event | Persistent | ID | Purpose |
|------------|-------|------------|-----|---------|
| `autoLinkCrm.ts` | `customer_accounts.user.created` | `true` | `customer_accounts:auto-link-crm` | Find `CustomerEntity` (kind='person') by email match → set `person_entity_id`, derive `customer_entity_id` from person's company |
| `autoLinkCrmReverse.ts` | `customers.person.created` | `true` | `customer_accounts:auto-link-crm-reverse` | Find `CustomerUser` by email match when new CRM person created → set `person_entity_id` |
| `notifyStaffOnSignup.ts` | `customer_accounts.user.created` | `true` | `customer_accounts:notify-staff-signup` | Notify CRM entity owner (if linked) or org admins about new customer signup |

All subscribers are persistent and idempotent: they check current state before mutating.

### Worker Contracts

| Worker | Queue | ID | Concurrency | Schedule |
|--------|-------|-----|------------|----------|
| `cleanupExpiredSessions.ts` | `customer_accounts:cleanup` | `customer_accounts:cleanup-sessions` | 1 | Daily, batches of 1000 |
| `cleanupExpiredTokens.ts` | `customer_accounts:cleanup` | `customer_accounts:cleanup-tokens` | 1 | Daily, batches of 1000 (email verifications, password resets, and expired invitations) |

Workers are idempotent: they delete rows matching `expires_at < now()` or `used_at IS NOT NULL AND created_at < now() - interval '7 days'`.

### Transaction and Undo Contract

- `user.signup`: Atomic insert of `CustomerUser` + `CustomerUserEmailVerification` token + `CustomerUserRole` (default role). Undo: soft-delete user (`deleted_at`).
- `user.login`: Read-only credential check + atomic session insert. Undo: N/A (session can be revoked).
- `user.verify_email`: Atomic update `email_verified_at` + mark token used. Undo: clear `email_verified_at` (staff action).
- `user.request_password_reset`: Atomic insert token row. Undo: mark token expired.
- `user.confirm_password_reset`: Atomic update `password_hash` + mark token used + revoke all sessions. Undo: N/A (password is hashed; previous password cannot be restored).
- `user.invite`: Atomic insert `CustomerUserInvitation`. Undo: mark invitation cancelled (`cancelled_at`).
- `user.accept_invitation`: Atomic: create `CustomerUser` + assign roles from invitation + mark invitation accepted. Undo: soft-delete created user.
- `user.assign_roles`: Atomic: delete existing `CustomerUserRole` rows + insert new ones. Undo: restore previous role set.
- `user.remove`: Soft-delete `CustomerUser` + revoke all sessions. Undo: restore by clearing `deleted_at`.
- `session.revoke`: Soft-delete session. Undo: N/A (customer must re-authenticate; by design).

### Service Wiring and Isolation

- All write paths execute through DI-registered services (Awilix), not inline handler logic.
- Cross-module references use IDs only: `person_entity_id` and `customer_entity_id` FK to `customer_entities`, separate fetch to resolve.
- Side effects (CRM auto-linking, staff notifications) run via event subscribers.
- No direct ORM relationships between `customer_accounts` and `customers` modules.
- `CustomerRbacService` is registered in DI with cache support (tag-based invalidation).

## Data Models

### CustomerUser (singular, table: `customer_users`)

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `tenant_id` | uuid | NOT NULL, INDEX | Tenant scoping |
| `organization_id` | uuid | NOT NULL, INDEX | Organization scoping |
| `email` | text | NOT NULL | Encrypted at rest (use `findWithDecryption`) |
| `email_hash` | text | NOT NULL | HMAC hash for lookups |
| `password_hash` | text | NULL | bcryptjs cost >= 10. NULL for magic-link-only or pending invitation |
| `display_name` | text | NULL | Customer-facing display name |
| `email_verified_at` | timestamptz | NULL | NULL = unverified |
| `failed_login_attempts` | integer | NOT NULL, DEFAULT 0 | Reset on successful login |
| `locked_until` | timestamptz | NULL | NULL = not locked |
| `last_login_at` | timestamptz | NULL | Updated on each successful login |
| `person_entity_id` | uuid | NULL, INDEX | FK to `customer_entities.id` (kind='person'). Who this user IS in CRM |
| `customer_entity_id` | uuid | NULL, INDEX | FK to `customer_entities.id` (kind='company'). Which company they represent. NULL for B2C |
| `is_active` | boolean | NOT NULL, DEFAULT true | Soft disable by staff |
| `created_at` | timestamptz | NOT NULL, DEFAULT now() | |
| `updated_at` | timestamptz | NOT NULL, DEFAULT now() | |
| `deleted_at` | timestamptz | NULL | Soft delete |

**Indexes:**
- `UNIQUE (tenant_id, email_hash) WHERE deleted_at IS NULL` — One active user per email per tenant
- `INDEX (tenant_id, organization_id)` — Tenant-scoped queries
- `INDEX (person_entity_id)` — Reverse lookup from CRM person
- `INDEX (customer_entity_id)` — List users for a company

### CustomerRole (singular, table: `customer_roles`)

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `tenant_id` | uuid | NOT NULL | Tenant scoping |
| `organization_id` | uuid | NOT NULL | Organization scoping |
| `name` | text | NOT NULL | Role display name (e.g., "Portal Admin", "Buyer") |
| `slug` | text | NOT NULL | Machine-readable key (e.g., `portal_admin`, `buyer`) |
| `description` | text | NULL | Role description |
| `is_default` | boolean | NOT NULL, DEFAULT false | Auto-assigned to new signups |
| `is_system` | boolean | NOT NULL, DEFAULT false | Cannot be deleted by staff (seeded roles) |
| `customer_assignable` | boolean | NOT NULL, DEFAULT true | If `false`, only staff can assign this role to customer users. Customer admins with `portal.users.roles.manage` can only assign roles where `customer_assignable = true`. Prevents self-escalation to privileged roles. |
| `created_at` | timestamptz | NOT NULL, DEFAULT now() | |
| `updated_at` | timestamptz | NOT NULL, DEFAULT now() | |
| `deleted_at` | timestamptz | NULL | Soft delete |

**Indexes:**
- `UNIQUE (tenant_id, slug) WHERE deleted_at IS NULL` — One role per slug per tenant
- `INDEX (tenant_id, organization_id)` — Tenant-scoped queries

### CustomerRoleAcl (singular, table: `customer_role_acls`)

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `role_id` | uuid | NOT NULL, FK → `customer_roles.id` | |
| `tenant_id` | uuid | NOT NULL | For evaluation scoping |
| `features_json` | json | NULL | Array of feature entries. Phase 1: string-only format `["portal.storefront.*", "portal.account.*"]` (all features default to `corporate` scope — full company access). Future: mixed format supporting scoped entries `[{ "feature": "portal.storefront.orders.view", "scope": "user" }, "portal.account.*"]`. See "Feature Entry Format" below. |
| `is_portal_admin` | boolean | NOT NULL, DEFAULT false | Grants all `portal.*` features |
| `created_at` | timestamptz | NOT NULL, DEFAULT now() | |
| `updated_at` | timestamptz | NOT NULL, DEFAULT now() | |

**Feature Entry Format** (forward-compatible):

Phase 1 uses simple string entries only. The schema is designed to support future entity-level scoping without migration:
```typescript
// Phase 1: string-only (binary access, implicit scope: 'corporate')
type FeatureEntry = string

// Future (Extension 1): mixed format with optional scope
type FeatureEntry = string | { feature: string; scope: 'user' | 'department' | 'corporate' }

// Scope levels (inspired by OroCommerce entity ACL):
// - 'user': Can only access own records (e.g., own orders)
// - 'department': Can access records from users in the same team (requires Extension 4: org hierarchy)
// - 'corporate': Can access all records within the company (Phase 1 default)
```

When resolving features, `matchFeature()` treats a bare string as `{ feature: string, scope: 'corporate' }`. This ensures all Phase 1 data remains valid when scope support is added.

**Indexes:**
- `UNIQUE (role_id, tenant_id)` — One ACL per role per tenant
- `INDEX (tenant_id)` — Tenant-scoped queries

### CustomerUserRole (singular, table: `customer_user_roles`)

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `user_id` | uuid | NOT NULL, FK → `customer_users.id` | |
| `role_id` | uuid | NOT NULL, FK → `customer_roles.id` | |
| `created_at` | timestamptz | NOT NULL, DEFAULT now() | |

**Indexes:**
- `UNIQUE (user_id, role_id)` — No duplicate assignments

### CustomerUserAcl (singular, table: `customer_user_acls`)

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `user_id` | uuid | NOT NULL, FK → `customer_users.id` | |
| `tenant_id` | uuid | NOT NULL | For evaluation scoping |
| `features_json` | json | NULL | Array of feature entries (overrides role-based features). Same format as `CustomerRoleAcl.features_json` — see "Feature Entry Format" above. |
| `is_portal_admin` | boolean | NOT NULL, DEFAULT false | Grants all `portal.*` features |
| `created_at` | timestamptz | NOT NULL, DEFAULT now() | |
| `updated_at` | timestamptz | NOT NULL, DEFAULT now() | |

**Indexes:**
- `UNIQUE (user_id, tenant_id)` — One override per user per tenant

### CustomerUserSession (singular, table: `customer_user_sessions`)

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `tenant_id` | uuid | NOT NULL | |
| `user_id` | uuid | NOT NULL, FK → `customer_users.id` | |
| `token` | text | NOT NULL, UNIQUE | 256-bit random, hashed for storage |
| `ip_address` | text | NULL | Client IP at creation |
| `user_agent` | text | NULL | Browser/device info |
| `expires_at` | timestamptz | NOT NULL | Default: 14 days from creation |
| `last_used_at` | timestamptz | NULL | Updated on refresh |
| `created_at` | timestamptz | NOT NULL, DEFAULT now() | |
| `deleted_at` | timestamptz | NULL | Revoked sessions |

**Indexes:**
- `UNIQUE (token)` — Token lookup
- `INDEX (user_id, deleted_at)` — Active sessions for a user
- `INDEX (expires_at)` — Cleanup of expired sessions

### CustomerUserEmailVerification (singular, table: `customer_user_email_verifications`)

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `tenant_id` | uuid | NOT NULL | |
| `user_id` | uuid | NOT NULL, FK → `customer_users.id` | |
| `token` | text | NOT NULL, UNIQUE | 256-bit random token |
| `purpose` | text | NOT NULL | `'email_verify'` or `'magic_link'` |
| `expires_at` | timestamptz | NOT NULL | 24h for email verify, 15min for magic link |
| `used_at` | timestamptz | NULL | NULL = unused |
| `created_at` | timestamptz | NOT NULL, DEFAULT now() | |

**Indexes:**
- `UNIQUE (token)` — Token lookup
- `INDEX (user_id, purpose, used_at)` — Find active tokens for a user

### CustomerUserPasswordReset (singular, table: `customer_user_password_resets`)

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `tenant_id` | uuid | NOT NULL | |
| `user_id` | uuid | NOT NULL, FK → `customer_users.id` | |
| `token` | text | NOT NULL, UNIQUE | 256-bit random token |
| `expires_at` | timestamptz | NOT NULL | 60 minutes TTL |
| `used_at` | timestamptz | NULL | NULL = unused |
| `created_at` | timestamptz | NOT NULL, DEFAULT now() | |

**Indexes:**
- `UNIQUE (token)` — Token lookup
- `INDEX (user_id, used_at)` — Find active resets for a user

### CustomerUserInvitation (singular, table: `customer_user_invitations`)

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `tenant_id` | uuid | NOT NULL | |
| `organization_id` | uuid | NOT NULL | |
| `email` | text | NOT NULL | Invited email (encrypted at rest) |
| `email_hash` | text | NOT NULL | HMAC hash for lookup |
| `token` | text | NOT NULL, UNIQUE | 256-bit random token |
| `customer_entity_id` | uuid | NULL | Company the user is invited to represent |
| `role_ids_json` | json | NOT NULL | Array of role IDs to assign on acceptance |
| `invited_by_user_id` | uuid | NULL | FK to `users.id` (staff) — NULL if invited by customer admin |
| `invited_by_customer_user_id` | uuid | NULL | FK to `customer_users.id` (customer admin) |
| `display_name` | text | NULL | Pre-filled display name for the invitee |
| `expires_at` | timestamptz | NOT NULL | 72 hours TTL |
| `accepted_at` | timestamptz | NULL | NULL = pending |
| `cancelled_at` | timestamptz | NULL | NULL = not cancelled |
| `created_at` | timestamptz | NOT NULL, DEFAULT now() | |

**Indexes:**
- `UNIQUE (token)` — Token lookup
- `UNIQUE (tenant_id, email_hash) WHERE accepted_at IS NULL AND cancelled_at IS NULL AND expires_at > now()` — One active invitation per email per tenant
- `INDEX (customer_entity_id)` — List invitations for a company

## Feature Namespace: `portal.*`

Features control all portal authorization. Consuming modules check features via `CustomerRbacService`.

| Feature | Description |
|---------|-------------|
| `portal.storefront.access` | Can access storefront portal |
| `portal.storefront.orders.view` | View orders |
| `portal.storefront.orders.create` | Place orders |
| `portal.storefront.quotes.request` | Request quotes |
| `portal.partner.access` | Access partner portal |
| `portal.partner.rfp.respond` | Respond to RFPs |
| `portal.account.view` | View own profile |
| `portal.account.manage` | Update own profile |
| `portal.users.view` | View company users |
| `portal.users.manage` | Invite/manage company users |
| `portal.users.roles.manage` | Assign roles within company |

### Default Roles (seeded via `setup.ts`)

| Role | Slug | Features | `is_default` | `is_system` | `is_portal_admin` | `customer_assignable` |
|------|------|----------|------------|-----------|-----------------|---------------------|
| Portal Admin | `portal_admin` | `portal.*` (via `is_portal_admin: true`) | false | true | true | false |
| Buyer | `buyer` | `portal.storefront.*`, `portal.account.*` | true | true | false | true |
| Viewer | `viewer` | `portal.storefront.access`, `portal.storefront.orders.view`, `portal.account.view` | false | true | false | true |

The `buyer` role is `is_default: true` — automatically assigned to self-signups. The `portal_admin` role has `customer_assignable: false` — only staff can assign it. This prevents customer admins from self-escalating or granting full portal admin to other users without staff oversight. Staff can assign any role regardless of `customer_assignable`.

### Staff Admin Features (acl.ts)

These are standard staff RBAC features controlling access to the admin interface:

| Feature | Description |
|---------|-------------|
| `customer_accounts.view` | View customer users list |
| `customer_accounts.manage` | Create/update/lock/unlock customer users |
| `customer_accounts.roles.manage` | Create/update/delete customer roles and ACLs |
| `customer_accounts.invite` | Send invitations to customer users |

## API Contracts

### Request/Response/Error Conventions
- Request and response bodies follow the platform `ApiResult` envelope.
- Validation failures return `400`/`422` with machine-readable field errors.
- Authorization failures return `401`/`403`.
- Not found resources return `404`.
- Rate limit exceeded returns `429` with `Retry-After` header.
- All routes export `openApi`.

### Public Routes (no auth required)

#### Signup
- `POST /api/customer-accounts/signup`
- Rate limit: 5 requests / email / hour + 20 requests / IP / hour
- Request:
```json
{
  "email": "customer@example.com",
  "password": "SecureP@ss1",
  "displayName": "Jane Doe",
  "tenantId": "uuid"
}
```
- Success `201`:
```json
{
  "ok": true,
  "data": { "id": "uuid", "email": "customer@example.com", "emailVerified": false }
}
```
- Assigns `is_default: true` role automatically (the `buyer` role).
- Error `409`: Generic message — `{ "ok": false, "error": "Unable to create account. Please try logging in or resetting your password." }` (prevents email enumeration)
- Side effects: Sends verification email. Emits `customer_accounts.user.created`.

#### Login
- `POST /api/customer-accounts/login`
- Rate limit: 10 requests / email / 15min + 30 requests / IP / 15min
- Request:
```json
{
  "email": "customer@example.com",
  "password": "SecureP@ss1",
  "tenantId": "uuid"
}
```
- Success `200`:
```json
{
  "ok": true,
  "data": {
    "accessToken": "jwt...",
    "expiresIn": 14400,
    "user": {
      "id": "uuid",
      "email": "customer@example.com",
      "displayName": "Jane Doe",
      "customerEntityId": "uuid-or-null",
      "personEntityId": "uuid-or-null"
    },
    "resolvedFeatures": ["portal.storefront.*", "portal.account.*"]
  }
}
```
- Sets `customer_auth_token` cookie (httpOnly, sameSite: lax, secure in production, 4h maxAge).
- Sets `customer_session_token` cookie (httpOnly, sameSite: lax, secure in production, 14d maxAge).
- JWT payload: `{ sub, type: 'customer', tenantId, orgId, email, customerEntityId, personEntityId }`
- Error `401`: Generic `"Invalid email or password"` (never reveals whether email exists).
- Error `423`: `"Account is temporarily locked. Please try again later."` (lockout active).

#### Magic Link Request
- `POST /api/customer-accounts/magic-link/request`
- Rate limit: 3 requests / email / hour + 10 requests / IP / hour
- Request:
```json
{
  "email": "customer@example.com",
  "tenantId": "uuid"
}
```
- Success `200`: `{ "ok": true }` (always 200, never reveals if email exists)
- Side effect: If user exists and is active, sends magic link email with 15-min TTL token.

#### Magic Link Verify
- `POST /api/customer-accounts/magic-link/verify`
- Rate limit: 10 requests / token / 15min
- Request:
```json
{
  "token": "base64url-encoded-token"
}
```
- Success `200`: Same as login response (sets both cookies, returns access token + user + resolved features).
- Also verifies email if not already verified.
- Error `401`: `"Invalid or expired link"`.

#### Email Verify
- `POST /api/customer-accounts/email/verify`
- Request:
```json
{
  "token": "base64url-encoded-token"
}
```
- Success `200`: `{ "ok": true, "data": { "emailVerified": true } }`
- Error `401`: `"Invalid or expired verification token"`.

#### Password Reset Request
- `POST /api/customer-accounts/password/reset-request`
- Rate limit: 3 requests / email / hour + 10 requests / IP / hour
- Request:
```json
{
  "email": "customer@example.com",
  "tenantId": "uuid"
}
```
- Success `200`: `{ "ok": true }` (always 200, never reveals if email exists)

#### Password Reset Confirm
- `POST /api/customer-accounts/password/reset-confirm`
- Rate limit: 5 requests / token / hour
- Request:
```json
{
  "token": "base64url-encoded-token",
  "password": "NewSecureP@ss2"
}
```
- Success `200`: `{ "ok": true }` — Revokes all existing sessions.
- Error `401`: `"Invalid or expired reset token"`.

#### Accept Invitation
- `POST /api/customer-accounts/invitations/accept`
- Request:
```json
{
  "token": "base64url-encoded-token",
  "password": "SecureP@ss1",
  "displayName": "Bob Smith"
}
```
- Success `201`:
```json
{
  "ok": true,
  "data": {
    "accessToken": "jwt...",
    "expiresIn": 14400,
    "user": { "id": "uuid", "email": "bob@example.com", "displayName": "Bob Smith" },
    "resolvedFeatures": ["portal.storefront.*"]
  }
}
```
- Creates `CustomerUser`, assigns roles from invitation, sets `customer_entity_id` from invitation, marks invitation accepted.
- Sets auth cookies (auto-login after acceptance).
- If email already has an active user: returns `409` with `"An account with this email already exists. Please log in."`.
- Error `401`: `"Invalid or expired invitation"`.

### Customer-Authenticated Routes

All require valid `customer_auth_token` cookie or `Authorization: Bearer <jwt>` with `type: 'customer'`.

#### Get Profile
- `GET /api/customer-portal/profile`
- Response `200`:
```json
{
  "ok": true,
  "data": {
    "id": "uuid",
    "email": "customer@example.com",
    "displayName": "Jane Doe",
    "emailVerified": true,
    "customerEntityId": "uuid-or-null",
    "personEntityId": "uuid-or-null",
    "resolvedFeatures": ["portal.storefront.*", "portal.account.*"],
    "roles": [{ "id": "uuid", "name": "Buyer", "slug": "buyer" }],
    "createdAt": "2026-03-04T..."
  }
}
```

#### Update Profile
- `PUT /api/customer-portal/profile`
- Requires feature: `portal.account.manage`
- Request: `{ "displayName": "Jane Smith" }`
- Response `200`: Updated profile object.

#### Change Password
- `POST /api/customer-portal/password/change`
- Request: `{ "currentPassword": "OldP@ss1", "newPassword": "NewP@ss2" }`
- Response `200`: `{ "ok": true }` — Does NOT revoke sessions (user explicitly changing their own password).

#### List Sessions
- `GET /api/customer-portal/sessions`
- Response `200`:
```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": "uuid",
        "ipAddress": "203.0.113.1",
        "userAgent": "Mozilla/5.0...",
        "lastUsedAt": "2026-03-04T...",
        "createdAt": "2026-03-04T...",
        "isCurrent": true
      }
    ]
  }
}
```

#### Revoke Session
- `DELETE /api/customer-portal/sessions/:id`
- Response `200`: `{ "ok": true }`
- Cannot revoke current session (use logout instead).

#### Refresh Session
- `POST /api/customer-portal/sessions/refresh`
- Rate limit: 10 requests / session token / 15min
- Reads `customer_session_token` cookie (browser flow) or accepts `{ "refreshToken": "..." }` JSON body (API flow).
- Validates session row is active (`deleted_at IS NULL`) and not expired (`expires_at > now()`).
- Issues new JWT access token, updates `last_used_at` on session row, reloads RBAC features.
- Response `200`:
```json
{
  "ok": true,
  "data": {
    "accessToken": "jwt...",
    "expiresIn": 14400,
    "resolvedFeatures": ["portal.storefront.*", "portal.account.*"]
  }
}
```
- Sets new `customer_auth_token` cookie (browser flow).
- Error `401`: `"Invalid or expired session"`.

#### Logout
- `POST /api/customer-portal/logout`
- Clears `customer_auth_token` and `customer_session_token` cookies.
- Soft-deletes current session.
- Response `200`: `{ "ok": true }`

#### List Company Users
- `GET /api/customer-portal/users`
- Requires feature: `portal.users.view`
- Scoped by authenticated user's `customer_entity_id`. Returns 403 if `customer_entity_id` is NULL.
- Query params: `page`, `pageSize` (max 100)
- Response `200`:
```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": "uuid",
        "email": "alice@acme.com",
        "displayName": "Alice",
        "roles": [{ "id": "uuid", "name": "Portal Admin", "slug": "portal_admin" }],
        "lastLoginAt": "2026-03-04T...",
        "isActive": true
      }
    ],
    "total": 3
  }
}
```

#### Invite User
- `POST /api/customer-portal/users/invite`
- Requires feature: `portal.users.manage`
- Scoped by authenticated user's `customer_entity_id`.
- Request:
```json
{
  "email": "newuser@acme.com",
  "displayName": "New User",
  "roleIds": ["uuid-buyer-role"]
}
```
- Success `201`: `{ "ok": true, "data": { "invitationId": "uuid" } }`
- Validates: email not already an active user for this tenant; roleIds exist and are valid for this tenant; all roleIds must reference roles where `customer_assignable = true` (returns `403` otherwise).
- Side effect: Sends invitation email with 72h TTL token.
- Error `409`: `"A user with this email already exists."` (customer admins can see this; it's not a public endpoint).

#### Assign Roles
- `PUT /api/customer-portal/users/:id/roles`
- Requires feature: `portal.users.roles.manage`
- Target user must belong to same `customer_entity_id`.
- Request: `{ "roleIds": ["uuid-buyer-role", "uuid-viewer-role"] }`
- Response `200`: Updated user with new roles.
- Cannot remove `portal_admin` role from self.
- **Validates `customer_assignable`**: All `roleIds` must reference roles where `customer_assignable = true`. Returns `403` if any role has `customer_assignable = false`. This prevents customer admins from assigning privileged roles (e.g., `portal_admin`) that only staff should grant.

#### Remove User
- `DELETE /api/customer-portal/users/:id`
- Requires feature: `portal.users.manage`
- Target user must belong to same `customer_entity_id`.
- Cannot remove self.
- Soft-deletes user, revokes all sessions.
- Response `200`: `{ "ok": true }`

### Staff Admin Routes

All require staff `auth_token` with appropriate `customer_accounts.*` features.

#### List Customer Users
- `GET /api/customer-accounts/admin/users`
- Requires feature: `customer_accounts.view`
- Query params: `page`, `pageSize` (max 100), `search` (email/name), `status` (active/locked/unverified), `customerEntityId` (filter by company)
- Response `200`: Paginated list of users with roles summary.

#### Get Customer User
- `GET /api/customer-accounts/admin/users/:id`
- Requires feature: `customer_accounts.view`
- Response `200`: Full user detail including CRM links, roles, session count.

#### Update Customer User (admin)
- `PUT /api/customer-accounts/admin/users/:id`
- Requires feature: `customer_accounts.manage`
- Request: `{ "isActive": false }` or `{ "lockedUntil": null }` (unlock) or `{ "customerEntityId": "uuid" }` (manual company link) or `{ "personEntityId": "uuid" }` (manual person link) or `{ "roleIds": ["uuid"] }` (role assignment)
- Response `200`: Updated user.
- **Staff bypasses `customer_assignable`**: When `roleIds` is provided, staff can assign any role including those with `customer_assignable = false` (e.g., `portal_admin`). This is the intended escalation path for granting privileged roles.

#### Delete Customer User (admin)
- `DELETE /api/customer-accounts/admin/users/:id`
- Requires feature: `customer_accounts.manage`
- Soft-deletes user and all sessions.
- Response `200`: `{ "ok": true }`

#### Invite Customer User (staff)
- `POST /api/customer-accounts/admin/users/invite`
- Requires feature: `customer_accounts.invite`
- Request:
```json
{
  "email": "user@example.com",
  "displayName": "User Name",
  "customerEntityId": "uuid-or-null",
  "roleIds": ["uuid-buyer-role"]
}
```
- Success `201`: `{ "ok": true, "data": { "invitationId": "uuid" } }`

#### List Customer Roles
- `GET /api/customer-accounts/admin/roles`
- Requires feature: `customer_accounts.view`
- Response `200`: Paginated list of roles with feature summaries.

#### Create Customer Role
- `POST /api/customer-accounts/admin/roles`
- Requires feature: `customer_accounts.roles.manage`
- Request:
```json
{
  "name": "Procurement Manager",
  "slug": "procurement_manager",
  "description": "Can create and manage purchase orders",
  "isDefault": false,
  "customerAssignable": true
}
```
- `customerAssignable` defaults to `true`. Set to `false` for roles that only staff should assign.
- Success `201`: Created role.

#### Get Customer Role
- `GET /api/customer-accounts/admin/roles/:id`
- Requires feature: `customer_accounts.view`
- Response `200`: Role detail with full ACL.

#### Update Customer Role
- `PUT /api/customer-accounts/admin/roles/:id`
- Requires feature: `customer_accounts.roles.manage`
- Cannot update `is_system: true` roles' slug.
- Request: `{ "name": "Updated Name", "description": "Updated desc" }`
- Response `200`: Updated role.

#### Delete Customer Role
- `DELETE /api/customer-accounts/admin/roles/:id`
- Requires feature: `customer_accounts.roles.manage`
- Cannot delete `is_system: true` roles.
- Cannot delete roles that are currently assigned to users (returns `409`).
- Response `200`: `{ "ok": true }`

#### Update Role ACL
- `PUT /api/customer-accounts/admin/roles/:id/acl`
- Requires feature: `customer_accounts.roles.manage`
- Request:
```json
{
  "featuresJson": ["portal.storefront.*", "portal.account.*"],
  "isPortalAdmin": false
}
```
- `featuresJson` accepts an array of feature entries. Phase 1: string-only entries. Future (Extension 1): mixed format with scoped entries `[{ "feature": "portal.storefront.orders.view", "scope": "user" }, "portal.account.*"]`. Invalid scope values are rejected with `422`.
- Response `200`: Updated ACL.
- Side effect: Invalidates RBAC cache for all users with this role (`customer_rbac:role:{roleId}`).

## Internationalization (i18n)

Translation key namespace: `customer_accounts.*`

Key groups:
- `customer_accounts.auth.*` — Login, signup, verification messages
- `customer_accounts.email.*` — Email subject lines and body templates
- `customer_accounts.admin.*` — Staff admin page labels
- `customer_accounts.portal.*` — Portal feature labels
- `customer_accounts.roles.*` — Role names and descriptions
- `customer_accounts.errors.*` — User-facing error messages
- `customer_accounts.widget.*` — UMES widget labels
- `customer_accounts.invitation.*` — Invitation email and acceptance messages

Translatable entity fields (declared in `translations.ts`):
- `CustomerRole`: `name`, `description` (role names are user-facing in the admin and portal UIs)

No hardcoded user-facing strings. All error messages, email subjects, and UI labels use locale files.

## UI/UX

### Staff Admin Pages

1. **`/backend/customer_accounts`** — Staff "Customers Portal" list page
   - DataTable with columns: Email, Display Name, Company (CRM link), Status (active/locked/unverified), Roles (badges), Last Login, Created At
   - Filters: status, company, role, CRM link status
   - Row actions: View, Lock/Unlock, Deactivate
   - Bulk actions: None (security-sensitive operations should be explicit)
   - Uses `CrudForm` patterns from customers module
   - Appears in staff navigation under **Settings → Customer Portal**

2. **`/backend/customer_accounts/:id`** — Admin user detail page
   - User info section: email, display name, status, verification state, last login
   - CRM links section: person entity link (clickable to `/backend/customers/people/:id`), company entity link (clickable to `/backend/customers/companies/:id`), or "Unlinked" with "Link Manually" action
   - Roles section: assigned roles with Add/Remove actions
   - Sessions section: active session list with Revoke action
   - Invitations section: pending/accepted invitations sent to this email

3. **`/backend/customer_accounts/roles`** — Role management page
   - DataTable with columns: Name, Slug, Users Count, Is Default, Is System, Features Summary
   - Row actions: View, Edit, Delete (disabled for system roles)
   - "Create Role" button
   - Appears in staff navigation under **Settings → Customer Portal**

4. **`/backend/customer_accounts/roles/:id`** — Role detail + ACL editor page
   - Role info: name, slug, description, is_default, is_system
   - ACL editor: feature tree with checkboxes. Group by namespace (`portal.storefront.*`, `portal.partner.*`, `portal.account.*`, `portal.users.*`).
   - `is_portal_admin` toggle at top (grants all `portal.*`)
   - "Save" button applies changes, invalidates RBAC cache

5. **`/backend/customer_accounts/settings`** — Portal settings page
   - Portal URL and quick links
   - Demo credentials reference
   - Appears in staff navigation under **Settings → Customer Portal**

### UMES Widgets

1. **Account Status Card** on CRM person detail page (spot: `crud-form:customers_person:fields`)
   - Shows: Account status (No Account / Active / Locked / Unverified), last login, roles badges, company link
   - Action: "Create Account" if no linked account exists (pre-fills email from CRM entity)
   - Action: "Invite to Portal" — creates invitation pre-linked to this person
   - Uses `useInjectionDataWidgets` pattern

2. **Company Portal Users Card** on CRM company detail page (spot: `crud-form:customers_company:fields`)
   - Shows: List of customer users linked to this company (name, email, roles, last login)
   - Action: "Invite User" — creates invitation pre-linked to this company
   - Uses `useInjectionDataWidgets` pattern

### Customer-Facing Pages
Customer-facing login/signup/portal pages are NOT part of this module. They are the responsibility of consuming portals (storefront, partner portal). This module provides only the **API layer** that those pages call.

## Configuration

Environment variables:
| Variable | Default | Description |
|----------|---------|-------------|
| `OM_CUSTOMER_JWT_TTL_SEC` | `14400` (4h) | Customer access token TTL |
| `OM_CUSTOMER_SESSION_TTL_SEC` | `1209600` (14d) | Customer refresh token TTL |
| `OM_CUSTOMER_MAX_FAILED_LOGINS` | `5` | Failed attempts before lockout |
| `OM_CUSTOMER_LOCKOUT_DURATION_SEC` | `1800` (30min) | Lockout duration |
| `OM_CUSTOMER_MAGIC_LINK_TTL_SEC` | `900` (15min) | Magic link token TTL |
| `OM_CUSTOMER_EMAIL_VERIFY_TTL_SEC` | `86400` (24h) | Email verification token TTL |
| `OM_CUSTOMER_PASSWORD_RESET_TTL_SEC` | `3600` (60min) | Password reset token TTL |
| `OM_CUSTOMER_INVITATION_TTL_SEC` | `259200` (72h) | Invitation token TTL |

All variables use existing env var reading patterns. No new infrastructure dependencies.

## Shared Code Extraction

### `matchFeature()` and `hasAllFeatures()` — Extract to Shared

**Source**: `packages/core/src/modules/auth/services/rbacService.ts` (lines 63-76)
**Target**: `packages/shared/src/lib/auth/featureMatch.ts`

```typescript
// packages/shared/src/lib/auth/featureMatch.ts

/** A feature entry is either a simple string or a scoped object (future Extension 1). */
export type FeatureEntry = string | { feature: string; scope: 'user' | 'department' | 'corporate' }

/** Extract the feature string from a FeatureEntry. */
export function featureString(entry: FeatureEntry): string {
  return typeof entry === 'string' ? entry : entry.feature
}

/** Extract the scope from a FeatureEntry. Defaults to 'corporate' for simple strings. */
export function featureScope(entry: FeatureEntry): 'user' | 'department' | 'corporate' {
  return typeof entry === 'string' ? 'corporate' : entry.scope
}

/**
 * Check if a required feature matches a granted feature string.
 * Phase 1: operates on feature strings only (scope is not evaluated here).
 * Future: scope evaluation is handled by the consuming service (e.g., query-level filtering).
 */
export function matchFeature(required: string, granted: string): boolean {
  if (granted === '*') return true
  if (granted.endsWith('.*')) {
    const prefix = granted.slice(0, -2)
    return required === prefix || required.startsWith(prefix + '.')
  }
  return granted === required
}

export function hasAllFeatures(required: string[], granted: string[]): boolean {
  if (!required.length) return true
  if (!granted.length) return false
  return required.every((req) => granted.some((g) => matchFeature(req, g)))
}

/**
 * Normalize a mixed features_json array to feature strings (Phase 1 behavior).
 * Future: this function will preserve scope metadata for query-level ACL filtering.
 */
export function extractFeatureStrings(entries: FeatureEntry[]): string[] {
  return entries.map(featureString)
}
```

**Design note on scope extensibility**: The `FeatureEntry` type and helper functions (`featureString`, `featureScope`, `extractFeatureStrings`) are defined in Phase 1 but only the string path is active. The `matchFeature()` function operates on extracted feature strings — scope evaluation is intentionally NOT embedded in the matching logic. When Extension 1 (entity-level RBAC scoping) is implemented, scope will be evaluated at the query level (OroCommerce's `AclHelper` pattern: DQL/SQL queries are modified to filter results by ownership chain based on the granted scope), not in the feature matching function.

**Changes to existing code:**
- `packages/core/src/modules/auth/services/rbacService.ts`: Replace private `matchFeature` and `hasAllFeatures` methods with imports from `@open-mercato/shared/lib/auth/featureMatch`. The class methods become thin wrappers or are removed entirely.
- This is a backward-compatible refactor: the public API of `RbacService` does not change.

## Migration & Compatibility

### Database Migrations
- 9 new tables, no modifications to existing tables.
- All migrations are additive-only: no column renames, no table drops.
- FK from `customer_users.person_entity_id` and `customer_users.customer_entity_id` to `customer_entities.id` are nullable and do not alter the `customer_entities` table.
- No data backfill required for initial deployment.

### Code Changes to Existing Files
1. **`packages/shared/src/lib/auth/server.ts`** — Add one-line guard to reject JWTs where `type === 'customer'`. Backward-compatible: existing staff JWTs do not have a `type` field.
2. **`packages/shared/src/lib/auth/featureMatch.ts`** — New file. Extract `matchFeature()`/`hasAllFeatures()` from `RbacService`.
3. **`packages/core/src/modules/auth/services/rbacService.ts`** — Import `matchFeature`/`hasAllFeatures` from shared instead of inline private methods. Public API unchanged.
4. **`apps/mercato/src/modules.ts`** — Register `customer_accounts` module.

### Backward Compatibility
- No existing API routes are modified.
- No existing database columns or tables are altered.
- No existing event IDs are renamed.
- The guard in `getAuthFromRequest()` is additive (only affects tokens that were never valid before).
- The `matchFeature` extraction is a pure refactor — staff RBAC behavior is identical.
- New module registration is additive.

### Integration Points for Consuming Modules
Consuming modules (storefront, PRM) integrate by:
1. Importing `getCustomerAuthFromRequest` from `@open-mercato/core/modules/customer_accounts/lib/customerAuth`
2. Checking features via `CustomerRbacService.userHasAllFeatures(userId, ['portal.storefront.access'], scope)` — or reading `resolvedFeatures` from the auth context
3. Subscribing to events (e.g., `customer_accounts.user.created`) for automation
4. No coupling to internal service classes — only the auth helper, RBAC service, and event contracts are public API

## Implementation Plan

### Phase 1: Foundation — 9 Entities, Signup, Login, Email Verify, RBAC Service, matchFeature Extraction, Default Roles
**Effort**: 4-6 days

1. Extract `matchFeature()` and `hasAllFeatures()` to `packages/shared/src/lib/auth/featureMatch.ts`. Update staff `RbacService` to import from shared.
2. Create module scaffold: `index.ts`, `acl.ts`, `di.ts`, `events.ts`, `setup.ts`, `translations.ts`.
3. Implement 9 MikroORM entities in `data/entities.ts` with all indexes and constraints.
4. Create Zod validators in `data/validators.ts` (signup, login, email verify, password reset, role, ACL schemas).
5. Implement `customerUserService.ts`: create user (bcryptjs hash), find by email (encrypted lookup), verify password, update last login, lockout logic.
6. Implement `customerSessionService.ts`: create session (256-bit token), refresh from token, delete session.
7. Implement `customerTokenService.ts`: create/verify email verification tokens, password reset tokens.
8. Implement `customerRbacService.ts`: `loadAcl()`, `userHasAllFeatures()`, cache with tag-based invalidation. Uses shared `matchFeature()`.
9. Implement `lib/customerAuth.ts`: `getCustomerAuthFromRequest()`, `CustomerAuthContext` type with resolved features.
10. Implement `lib/tokenGenerator.ts`: `generateSecureToken()` using `crypto.randomBytes(32)`.
11. Implement `lib/rateLimiter.ts`: compound IP+email rate limiter.
12. Add defensive guard in `packages/shared/src/lib/auth/server.ts` to reject `type === 'customer'` JWTs.
13. Implement `setup.ts`: seed 3 default roles (`portal_admin`, `buyer`, `viewer`) with ACLs on `onTenantCreated`. `portal_admin` seeded with `customer_assignable: false`; `buyer` and `viewer` with `customer_assignable: true`. Declare `defaultRoleFeatures` for staff admin features.
14. Implement API routes: `signup`, `login`, `email/verify`, `password/reset-request`, `password/reset-confirm`, `logout`.
15. All routes export `openApi`.
16. Register module in `apps/mercato/src/modules.ts`.
17. Run `yarn db:generate` for migrations, `yarn generate` for module discovery.
18. Integration tests: signup flow (with default role assignment), login flow (with resolved features), email verification, password reset, rate limiting, lockout, RBAC resolution, cross-auth rejection.

### Phase 2: Magic Link + Invitation Flow
**Effort**: 2-3 days

1. Implement `commands/requestMagicLink.ts` and `commands/verifyMagicLink.ts`.
2. Implement API routes: `magic-link/request`, `magic-link/verify`.
3. Extend `customerTokenService.ts` with magic link token generation (15-min TTL, `purpose: 'magic_link'`).
4. Magic link verify also sets `email_verified_at` if not already verified.
5. Implement `customerInvitationService.ts`: create invitation, validate token, accept invitation.
6. Implement `commands/inviteUser.ts` and `commands/acceptInvitation.ts`.
7. Implement API route: `invitations/accept`.
8. Invitation acceptance: create user, assign roles from invitation, set `customer_entity_id`, auto-login.
9. Integration tests: magic link request (always 200), magic link verify (success + expiry + reuse), invitation creation, invitation acceptance (happy path + expired + already accepted + email conflict).

### Phase 3: Customer Portal Self-Service
**Effort**: 2-3 days

1. Implement customer-authenticated API routes: `portal/profile` (GET/PUT), `portal/password/change`, `portal/sessions` (GET/DELETE), `portal/sessions/refresh`, `portal/logout`.
2. Implement company user management API routes: `portal/users` (GET), `portal/users/invite` (POST), `portal/users/:id/roles` (PUT), `portal/users/:id` (DELETE).
3. All portal routes validate `customer_auth_token` and check features via `CustomerRbacService`.
4. Company user routes scoped by `customer_entity_id` — returns 403 if user has no company.
5. Role assignment validates target user belongs to same company.
6. Invite route validates email not already active, roleIds valid.
7. Integration tests: profile CRUD, session management, company user listing, user invitation (customer admin flow), role assignment, user removal, feature-based access control.

### Phase 4: Staff Admin UI
**Effort**: 3-4 days

1. Implement staff admin API routes: CRUD for users (`admin/users`), CRUD for roles (`admin/roles`), ACL editor (`admin/roles/:id/acl`), staff-initiated invite (`admin/users/invite`).
2. Build `/backend/customer_accounts` list page with DataTable (columns: email, name, company, status, roles, last login).
3. Build `/backend/customer_accounts/:id` detail page with CRM links, roles, sessions, invitations.
4. Build `/backend/customer_accounts/roles` list page with DataTable.
5. Build `/backend/customer_accounts/roles/:id` detail page with ACL editor (feature tree with checkboxes).
6. Manual CRM linking action on user detail page (staff selects person/company entity).
7. Use `CrudForm`, `LoadingMessage`, `ErrorMessage`, `DataTable` patterns.
8. Integration tests: admin list, admin detail, admin update (lock/unlock/deactivate/link), role CRUD, ACL editor save, staff-initiated invitation.

### Phase 5: CRM Integration (UMES Widgets, Auto-Linking)
**Effort**: 2-3 days

1. Implement `subscribers/autoLinkCrm.ts`: on `customer_accounts.user.created`, find `CustomerEntity` by email match (kind='person', same tenant), set `person_entity_id`, derive `customer_entity_id` from person's company association.
2. Implement `subscribers/autoLinkCrmReverse.ts`: on `customers.person.created`, check if a `CustomerUser` exists with matching email, set `person_entity_id`.
3. Implement `data/extensions.ts` declaring extension link to customers module.
4. Build `AccountStatusCard` UMES widget for CRM person detail page (spot: `crud-form:customers_person:fields`).
5. Build `CompanyUsersCard` UMES widget for CRM company detail page (spot: `crud-form:customers_company:fields`).
6. Register widgets in `widgets/injection-table.ts`.
7. Implement `subscribers/notifyStaffOnSignup.ts`.
8. Integration tests: auto-link on signup, auto-link on person creation, widget rendering, ambiguous email handling.

### Phase 6: Cleanup Workers, Notifications, Polish
**Effort**: 1-2 days

1. Implement `workers/cleanupExpiredSessions.ts`: daily batch deletion of expired sessions.
2. Implement `workers/cleanupExpiredTokens.ts`: daily batch deletion of used/expired tokens (email verification, password reset, invitations).
3. Implement `notifications.ts` and `notifications.client.ts` for staff notifications on customer events.
4. Add structured logging for security events (login failure, lockout, rate limit hit).
5. Final pass on i18n keys, error messages, and edge cases.
6. Integration tests: cleanup worker behavior, notification rendering.

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `packages/shared/src/lib/auth/featureMatch.ts` | Create | Shared `matchFeature()` + `hasAllFeatures()` |
| `packages/core/src/modules/auth/services/rbacService.ts` | Modify | Import feature matching from shared |
| `packages/shared/src/lib/auth/server.ts` | Modify | Add customer JWT rejection guard (~1 line) |
| `packages/core/src/modules/customer_accounts/index.ts` | Create | Module metadata |
| `packages/core/src/modules/customer_accounts/acl.ts` | Create | Staff admin features |
| `packages/core/src/modules/customer_accounts/di.ts` | Create | DI registration (5 services) |
| `packages/core/src/modules/customer_accounts/events.ts` | Create | Event declarations (13 events) |
| `packages/core/src/modules/customer_accounts/setup.ts` | Create | Tenant init, default roles seeding |
| `packages/core/src/modules/customer_accounts/translations.ts` | Create | Translatable fields (CustomerRole: name, description) |
| `packages/core/src/modules/customer_accounts/notifications.ts` | Create | Notification types |
| `packages/core/src/modules/customer_accounts/notifications.client.ts` | Create | Client notification renderers |
| `packages/core/src/modules/customer_accounts/data/entities.ts` | Create | 9 MikroORM entities |
| `packages/core/src/modules/customer_accounts/data/validators.ts` | Create | Zod schemas |
| `packages/core/src/modules/customer_accounts/data/extensions.ts` | Create | CRM extension link |
| `packages/core/src/modules/customer_accounts/lib/customerAuth.ts` | Create | Auth helper |
| `packages/core/src/modules/customer_accounts/lib/tokenGenerator.ts` | Create | Secure token generation |
| `packages/core/src/modules/customer_accounts/lib/rateLimiter.ts` | Create | Rate limiting |
| `packages/core/src/modules/customer_accounts/services/customerUserService.ts` | Create | User service |
| `packages/core/src/modules/customer_accounts/services/customerSessionService.ts` | Create | Session service |
| `packages/core/src/modules/customer_accounts/services/customerTokenService.ts` | Create | Token service |
| `packages/core/src/modules/customer_accounts/services/customerRbacService.ts` | Create | Customer RBAC service |
| `packages/core/src/modules/customer_accounts/services/customerInvitationService.ts` | Create | Invitation service |
| `packages/core/src/modules/customer_accounts/commands/*.ts` | Create | Command handlers (14 files) |
| `packages/core/src/modules/customer_accounts/api/**/*.ts` | Create | API routes (~30 files) |
| `packages/core/src/modules/customer_accounts/subscribers/*.ts` | Create | Event subscribers (3 files) |
| `packages/core/src/modules/customer_accounts/workers/*.ts` | Create | Background workers (2 files) |
| `packages/core/src/modules/customer_accounts/backend/**/*.tsx` | Create | Admin pages (4 pages) |
| `packages/core/src/modules/customer_accounts/widgets/**/*` | Create | UMES widgets (2 widgets) + injection table |
| `apps/mercato/src/modules.ts` | Modify | Register customer_accounts module |

### Testing Strategy

- **Unit**: Token generation, password hashing, lockout logic, rate limiter, JWT discriminator check, `matchFeature()` (shared), RBAC resolution logic.
- **API integration**:
  - Auth flows: signup → verify → login → profile → logout
  - Magic link flow: request → verify (success + expiry + reuse)
  - Password reset flow: request → confirm → sessions revoked
  - Invitation flow: create → accept → auto-login → roles assigned
  - Session management: list, revoke, refresh, cannot revoke current
  - Company user management: list, invite, assign roles, remove
  - Staff admin: user CRUD, role CRUD, ACL editor, staff-initiated invite
  - RBAC: feature-based access control on portal routes, wildcard matching, per-user override
- **UMES integration**: Widget rendering on CRM person/company detail, auto-linking subscriber.
- **Security**: Rate limiting enforcement, lockout behavior, email enumeration prevention, cross-auth rejection (customer JWT rejected by staff middleware, staff JWT rejected by customer middleware), tenant isolation, company scoping on portal routes.

## Performance, Cache & Scale

### Query and Index Strategy
- User lookup by email: `(tenant_id, email_hash) WHERE deleted_at IS NULL` — point lookup, O(1).
- Session token refresh: `(token)` unique index — point lookup, O(1).
- Active sessions for user: `(user_id, deleted_at)` — narrow range, typically < 10 rows.
- RBAC load: 2 queries — `CustomerUserAcl` point lookup (0-1 row) or `CustomerUserRole` + `CustomerRoleAcl` join (typically 1-3 roles).
- Company users list: `(customer_entity_id)` index — typically < 50 users per company.
- CRM reverse lookup: `(person_entity_id)` — point lookup, 0-1 row.
- Admin list: `(tenant_id, organization_id)` with pagination — bounded by `pageSize <= 100`. Roles loaded via batch `WHERE user_id IN (...)` query (2 queries per page, not per-row N+1).
- Invitation lookup: `(token)` unique index — point lookup, O(1).

### Scale Controls
- Session cleanup: background worker (`cleanupExpiredSessions.ts`) deletes sessions past `expires_at` (daily, batched 1000 per iteration).
- Token cleanup: background worker (`cleanupExpiredTokens.ts`) deletes used/expired verification, reset, and invitation tokens (daily, batched 1000 per iteration).
- Rate limiting uses in-memory counters with sliding window (no external dependency for MVP). Can be upgraded to Redis-backed for multi-instance deployments.

### Cache Strategy
- **RBAC cache** (Phase 1): `CustomerRbacService` caches resolved ACLs per user using tag-based invalidation:
  - Key: `customer_rbac:user:<userId>:<tenantId>`
  - TTL: 5 minutes
  - Invalidation tags: `customer_rbac:user:<userId>`, `customer_rbac:role:<roleId>`, `customer_rbac:tenant:<tenantId>`
  - On role ACL update → invalidate `customer_rbac:role:<roleId>` (all users with that role)
  - On user role assignment → invalidate `customer_rbac:user:<userId>`
  - On user ACL override → invalidate `customer_rbac:user:<userId>`
  - Cache miss: direct DB query (2 queries, fast)
  - No cross-tenant cache sharing
- **No caching for auth operations** (Phase 1-6): Login, session refresh, profile reads are security-sensitive; staleness risks outweigh performance gains.
  - `GET /api/customer-portal/profile`: No cache — must reflect current email verification and lockout state.
  - `GET /api/customer-portal/sessions`: No cache — must reflect real-time session state.
  - `GET /api/customer-accounts/admin/*`: No cache — admin usage is low-traffic.
- **Phase 7+ consideration**: Portal feature checks on hot paths (every storefront request) may benefit from short-TTL tenant-scoped cache for the full resolved feature set. The RBAC cache in Phase 1 already covers this.

## Risks & Impact Review

### Data Integrity Failures

#### Signup interrupted between user creation and role assignment
- **Scenario**: Server crashes after `CustomerUser` insert but before `CustomerUserRole` insert and `CustomerUserEmailVerification` insert.
- **Severity**: Medium
- **Affected area**: User exists without a role or verification token. Cannot verify email, has no permissions.
- **Mitigation**: Wrap all three inserts in a single database transaction. If any fails, the entire operation rolls back.
- **Residual risk**: None — transaction atomicity guarantees consistency.

#### Race condition on concurrent signups with same email
- **Scenario**: Two concurrent signup requests for the same email reach the insert simultaneously.
- **Severity**: Low
- **Affected area**: One request fails with a constraint violation.
- **Mitigation**: Unique constraint `(tenant_id, email_hash) WHERE deleted_at IS NULL` ensures one succeeds. The failing request receives a generic error (same as "email exists" to prevent enumeration).
- **Residual risk**: None — database constraint is authoritative.

#### Invitation acceptance race condition
- **Scenario**: Same invitation token submitted concurrently by two browser tabs.
- **Severity**: Low
- **Affected area**: Two users could be created for the same invitation.
- **Mitigation**: Transaction: check `accepted_at IS NULL` + set `accepted_at` + create user atomically. Second request sees `accepted_at` is set and returns error.
- **Residual risk**: None — transaction + unique constraint prevent duplication.

### Cascading Failures & Side Effects

#### CRM auto-linking subscriber fails
- **Scenario**: The `autoLinkCrm` subscriber throws when querying `CustomerEntity` by email.
- **Severity**: Low
- **Affected area**: User exists but `person_entity_id` and `customer_entity_id` remain null.
- **Mitigation**: Subscriber is non-blocking (async event). User creation succeeds regardless. Staff can manually link via admin UI. Subscriber uses retry with exponential backoff.
- **Residual risk**: Temporary CRM disconnect; resolved on retry or manual intervention.

#### Email delivery failure
- **Scenario**: Verification email, magic link, password reset, or invitation email fails to send.
- **Severity**: High
- **Affected area**: Customer cannot complete signup verification, use magic link, reset password, or accept invitation.
- **Mitigation**: Email sending is queued via the platform's email infrastructure. Failed emails can be retried. Resend mechanisms available for verification and magic link. Invitations can be resent by staff/admin.
- **Residual risk**: If email infrastructure is fully down, customers must wait. No data loss.

#### RBAC cache stale after role ACL update
- **Scenario**: Staff updates role ACL, but cached resolved features are not yet invalidated. Customer accesses a portal they no longer have permission for.
- **Severity**: Medium
- **Affected area**: Customer may see unauthorized content for up to 5 minutes (cache TTL).
- **Mitigation**: Tag-based cache invalidation on role ACL update immediately clears affected entries. The 5-minute TTL is a safety net, not the primary invalidation mechanism.
- **Residual risk**: Brief window if invalidation message is delayed. Acceptable for portal features (not financial transactions).

### Tenant & Data Isolation Risks

#### Cross-tenant customer token accepted
- **Scenario**: Customer JWT from tenant A is presented to tenant B's portal.
- **Severity**: Critical
- **Affected area**: Data leakage between tenants.
- **Mitigation**: JWT payload includes `tenantId`. `getCustomerAuthFromRequest()` validates JWT `tenantId` matches the request's tenant context. All database queries filter by `tenant_id`.
- **Residual risk**: None if validation is correctly implemented. Integration tests cover cross-tenant rejection.

#### Customer JWT accepted by staff middleware
- **Scenario**: Customer JWT (with `type: 'customer'`) is presented to a staff API route.
- **Severity**: Critical
- **Affected area**: Customer could access staff-only APIs.
- **Mitigation**: Three layers of defense: (1) separate cookie name, (2) `type === 'customer'` rejection in `getAuthFromRequest()`, (3) customer RBAC features don't match staff feature names.
- **Residual risk**: Near-zero. Would require all three guards to be bypassed simultaneously.

#### Company scoping bypass on portal routes
- **Scenario**: Customer user from Company A accesses Company B's user list or manages Company B's users.
- **Severity**: Critical
- **Affected area**: Cross-company data leakage within a tenant.
- **Mitigation**: All portal company-scoped routes filter by `customer_entity_id` from the authenticated user's JWT. The ID comes from a trusted source (DB lookup during login), not from request parameters.
- **Residual risk**: None if `customer_entity_id` is correctly embedded in JWT and validated.

### Migration & Deployment Risks

#### New tables on large tenant databases
- **Scenario**: `CREATE TABLE` statements lock the schema during deployment.
- **Severity**: Low
- **Affected area**: Brief schema lock during migration.
- **Mitigation**: All 9 tables are new (no `ALTER TABLE`). PostgreSQL `CREATE TABLE` is fast and non-blocking for existing queries.
- **Residual risk**: None for typical deployments.

#### matchFeature extraction breaks staff RBAC
- **Scenario**: Extracting `matchFeature()` to shared introduces a behavioral difference.
- **Severity**: High
- **Affected area**: Staff RBAC resolution could change, granting or denying features incorrectly.
- **Mitigation**: Pure function extraction — same implementation, same tests. Staff `RbacService` unit tests must pass before and after extraction. No logic changes, only import path changes.
- **Residual risk**: None if tests pass.

### Operational Risks

#### Brute force attacks on login endpoint
- **Scenario**: Attacker attempts credential stuffing against `/api/customer-accounts/login`.
- **Severity**: High
- **Affected area**: Customer accounts may be compromised if passwords are weak.
- **Mitigation**: Compound rate limiting (per-email + per-IP). Account lockout after configurable failed attempts. Password policy enforcement. Generic error messages prevent targeted attacks.
- **Residual risk**: Distributed attacks from many IPs can partially bypass IP-based limiting. Lockout protects individual accounts regardless.

#### Expired session/token accumulation
- **Scenario**: Over time, millions of expired rows accumulate across session, token, and invitation tables.
- **Severity**: Low
- **Affected area**: Storage growth, index performance.
- **Mitigation**: Daily background workers clean up expired rows in batches of 1000.
- **Residual risk**: Minimal. Cleanup can be tuned for frequency and batch size.

#### RBAC complexity leads to permission errors
- **Scenario**: Complex role/user ACL interactions lead to unexpected permission grants or denials.
- **Severity**: Medium
- **Affected area**: Customer access control.
- **Mitigation**: RBAC resolution mirrors proven staff system exactly. Profile endpoint returns `resolvedFeatures` for transparency. Staff admin UI shows effective permissions. Integration tests cover all resolution paths (role-based, user override, portal admin, wildcard).
- **Residual risk**: Low. Same resolution logic has been production-tested in staff auth.

## Final Compliance Report — 2026-03-04

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/auth/AGENTS.md`
- `packages/core/src/modules/customers/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`
- `packages/events/AGENTS.md`
- `packages/cache/AGENTS.md`
- `packages/queue/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | Uses FK IDs only. `person_entity_id` and `customer_entity_id` are plain UUID columns, no MikroORM relations to customers module. |
| root AGENTS.md | Filter by `organization_id` for tenant-scoped entities | Compliant | All entities include `tenant_id` + `organization_id`. All queries filter by both. |
| root AGENTS.md | Never expose cross-tenant data | Compliant | JWT `tenantId` validated on every request. Unique constraints are tenant-scoped. Company scoping on portal routes uses JWT-embedded `customer_entity_id`. |
| root AGENTS.md | Use DI (Awilix) for services | Compliant | `di.ts` registers 5 services via `asClass().scoped()`. |
| root AGENTS.md | Validate inputs with zod in `data/validators.ts` | Compliant | All API inputs validated with zod schemas. |
| root AGENTS.md | Use `findWithDecryption` for encrypted fields | Compliant | Email is encrypted; lookups use `email_hash`, reads use `findWithDecryption`. |
| root AGENTS.md | Hash passwords with bcryptjs (cost >= 10) | Compliant | Explicit in service implementation. |
| root AGENTS.md | Return minimal error messages for auth | Compliant | Generic messages for signup conflict, login failure, all token operations, invitation acceptance. |
| root AGENTS.md | Use `apiCall`/`apiCallOrThrow` in backend pages | Compliant | Admin pages use `apiCall` pattern. |
| root AGENTS.md | Modules: plural, snake_case | Compliant | Module name: `customer_accounts`. |
| root AGENTS.md | Event IDs: `module.entity.action` (singular, past tense) | Compliant | e.g., `customer_accounts.user.created`, `customer_accounts.session.revoked`. |
| root AGENTS.md | Feature naming: `<module>.<action>` | Compliant | Staff: `customer_accounts.view`, `customer_accounts.manage`. Portal: `portal.storefront.access`, etc. |
| root AGENTS.md | `pageSize` at or below 100 | Compliant | All list endpoints enforce `pageSize <= 100`. |
| root AGENTS.md | Every dialog: `Cmd/Ctrl+Enter` submit, `Escape` cancel | Compliant | Admin pages follow platform dialog patterns. |
| root AGENTS.md | XSS: no unsafe raw HTML rendering | Compliant | All user-facing text rendered via React (default escaping). Email templates use escaped variables. |
| packages/core/AGENTS.md | API routes MUST export `openApi` | Compliant | All routes export `openApi`. |
| packages/core/AGENTS.md | CRUD routes use `makeCrudRoute` with `indexer` | Compliant | Admin CRUD routes use `makeCrudRoute`. Public auth routes (signup, login, etc.) are custom write routes exempt from CRUD contract. |
| packages/core/AGENTS.md | `setup.ts` declares `defaultRoleFeatures` | Compliant | Staff admin role gets `customer_accounts.*`. Seeds 3 default customer roles on `onTenantCreated`. |
| packages/core/AGENTS.md | Events use `createModuleEvents()` with `as const` | Compliant | Declared in `events.ts`. |
| packages/core/AGENTS.md | Widget injection declared in `widgets/injection/`, mapped via `injection-table.ts` | Compliant | AccountStatusCard and CompanyUsersCard follow pattern. |
| packages/core/AGENTS.md | Translatable fields declared in `translations.ts` | Compliant | `CustomerRole`: `name`, `description`. |
| packages/shared/AGENTS.md | Boolean parsing uses `parseBooleanToken` | N/A | No boolean query params in this module's public API. |
| packages/events/AGENTS.md | `clientBroadcast: true` for SSE events | Compliant | `user.created` and `user.locked` broadcast to staff. |
| packages/events/AGENTS.md | Persistent subscribers must be idempotent | Compliant | All 3 subscribers: `persistent: true`, unique IDs, idempotency via state checks. |
| packages/cache/AGENTS.md | Tag-based invalidation for cache | Compliant | RBAC cache uses tag-based invalidation with tenant/role/user scoping. |
| packages/queue/AGENTS.md | Workers export `metadata` with `{ queue, id, concurrency }` | Compliant | 2 cleanup workers with metadata. |
| Backward Compatibility | No column/table rename/remove | Compliant | 9 new tables, 0 modifications to existing schema. |
| Backward Compatibility | Event IDs are FROZEN once created | Compliant | All 13 events are new; naming is final. |
| Backward Compatibility | Widget injection spot IDs are FROZEN | Compliant | Uses existing spots: `crud-form:customers_person:fields`, `crud-form:customers_company:fields`. |
| Backward Compatibility | Function signatures: cannot remove/reorder params | Compliant | `matchFeature` extraction preserves exact function signature. `RbacService` public API unchanged. |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | All 9 entities map to documented API routes. All request/response fields correspond to entity columns. |
| API contracts match UI/UX section | Pass | Admin pages consume admin API routes. UMES widgets use CRM reverse lookup. Portal routes serve customer self-service UI. |
| Risks cover all write operations | Pass | Signup, login, email verify, password reset, magic link, invitation, role assignment, user removal, session revoke — all covered. |
| Commands defined for all mutations | Pass | 14 commands cover all write paths. |
| Cache strategy covers all read APIs | Pass | RBAC cache with tag-based invalidation. Auth/profile reads explicitly no-cache with security justification. Admin reads no-cache (low traffic). |
| Events defined for all state transitions | Pass | 13 events cover user lifecycle, sessions, invitations, and CRM linking. |

### Non-Compliant Items
- None.

### Verdict
- **Fully compliant**: Approved — ready for implementation.

## Future Extensions

The following capabilities are explicitly deferred from the current scope. They are documented here to ensure the Phase 1–6 schema and architecture do not block their future implementation. Each item includes a schema migration path analysis.

> **Context**: These extensions are informed by an enterprise architecture review against SAP Commerce Cloud, OroCommerce, and Magento 2 / Adobe Commerce. All three platforms evolved these capabilities over multiple major releases — implementing them all at MVP would be over-engineering.

### Extension 1: Entity-Level RBAC Scoping (Phase 7+)

**What**: OroCommerce implements 4 access levels per feature per entity: `None`, `User` (own records only), `Department` (same team), `Corporate` (full company hierarchy). The current SPEC-057 RBAC is binary — a feature is either granted or not.

**Why deferred**: In most B2B portal scenarios, buyers within the same company share access to the same orders and quotes. Entity-level scoping matters when companies have 50+ users with segmented responsibilities (e.g., "regional procurement managers who should only see their region's orders"). This is uncommon at MVP scale.

**Schema migration path**:
- Option A (recommended): Evolve `features_json` in `CustomerRoleAcl` and `CustomerUserAcl` to support mixed format — strings for binary features, objects for scoped features:
  ```json
  [
    "portal.account.*",
    { "feature": "portal.storefront.orders.view", "scope": "user" },
    { "feature": "portal.storefront.orders.create", "scope": "corporate" }
  ]
  ```
  The `matchFeature()` function in `featureMatch.ts` would be extended with an optional `scope` parameter. Existing string entries default to `corporate` scope (full company access), preserving backward compatibility.
- Option B: Add a separate `customer_role_acl_scopes` table mapping `(role_acl_id, feature, scope)` — avoids JSON format change but adds join complexity.
- **No schema changes needed in Phase 1**: The current `features_json` string array is forward-compatible with Option A. The `matchFeature()` signature (`required: string, granted: string`) can be extended to `matchFeature(required: string, granted: string | FeatureGrant)` without breaking existing callers.

### Extension 2: Multi-Company Support (Phase 7+)

**What**: A single person (one email) can represent multiple companies in the portal. SAP supports this via `B2BCustomer` membership in multiple `B2BUnit` nodes. Magento 2 added company switching in 2025. OroCommerce scopes `CustomerUser` to one `Customer` but allows customer hierarchy.

**Why deferred**: The current `UNIQUE (tenant_id, email_hash) WHERE deleted_at IS NULL` constraint enforces one active user per email per tenant. Multi-company requires a junction model.

**Schema migration path**:
1. Create a `customer_user_companies` junction table: `(user_id, customer_entity_id, is_primary, created_at)`.
2. Migrate existing `customer_users.customer_entity_id` values into junction rows.
3. Make `customer_users.customer_entity_id` nullable (already nullable) and deprecated — reads resolve via junction.
4. Add `activeCustomerEntityId` to JWT payload (selected at login or via company-switch endpoint).
5. The `UNIQUE (tenant_id, email_hash)` constraint remains valid — one user record, multiple company associations.
6. Portal company-scoped routes use `activeCustomerEntityId` from JWT instead of the direct FK.
- **No schema changes needed in Phase 1**: The unique constraint and nullable `customer_entity_id` are both forward-compatible.

### Extension 3: Company Registration Approval Workflow (Phase 8+)

**What**: Both SAP Commerce Cloud and Magento 2 have a company registration approval flow: company self-registers → status = `pending` → staff reviews → approves/rejects → company admin activated. The current spec creates immediately active users on signup.

**Why deferred**: For B2C and light B2B (where customers are pre-known via CRM), immediate activation with email verification is sufficient. Approval workflows add friction that is only justified for open B2B marketplaces where unknown companies can self-register.

**Implementation path**:
- Add `requires_signup_approval` tenant-level configuration (default: `false`).
- When enabled, `signup` command sets `is_active = false` and emits `customer_accounts.user.pending_approval` event.
- Staff receives notification and approves/rejects via admin UI (`PUT /api/customer-accounts/admin/users/:id` with `{ "isActive": true }`).
- On approval, emit `customer_accounts.user.approved` event → send welcome email.
- **No schema changes needed**: `is_active` column already exists on `CustomerUser`. Configuration can use existing tenant settings infrastructure.

### Extension 4: Organization Hierarchy — Teams & Departments (Phase 8+)

**What**: SAP uses `B2BUnit` tree (self-referential parent FK). Magento 2 uses `company_structure` table with `entity_type: 'team' | 'customer'` nodes. OroCommerce models departments within customers. All three support arbitrary-depth org charts.

**Why deferred**: Org hierarchy is only meaningful when combined with entity-level RBAC scoping (Extension 1) — specifically the `Department` access level. Without scoped permissions, a flat company → users model provides equivalent functionality.

**Implementation path**:
- Create `customer_teams` table: `(id, tenant_id, customer_entity_id, name, parent_team_id, created_at)`.
- Add `team_id` nullable FK to `customer_users`.
- Extend RBAC scoping with `department` level that resolves via team membership.
- **No schema changes needed in Phase 1**: Adding a nullable `team_id` FK to `customer_users` is additive-only.

### Extension 5: Guest Visitor Tracking (Phase 9+)

**What**: OroCommerce maintains a `CustomerVisitor` entity with cookie-based session tracking for anonymous users (30-day cookie, `sessionId` generated via `random_bytes`). This feeds cart abandonment detection, personalization, and conversion analytics (visitor → registered user).

**Why deferred**: Guest tracking is a storefront concern (SPEC-029), not an identity concern. The `customer_accounts` module handles authenticated users; anonymous visitor tracking belongs in the storefront or analytics module.

**Integration path**:
- Storefront module creates `StorefrontVisitor` entity with anonymous session cookie.
- On signup/login, link `StorefrontVisitor` to `CustomerUser` (merge cart, transfer analytics).
- Subscribe to `customer_accounts.user.created` to trigger visitor-to-user linking.
- **No changes to `customer_accounts` module needed**: Integration via events only.

### Extension 6: Purchase Limits & Budget Permissions (Phase 9+)

**What**: SAP Commerce's `B2BOrderThresholdPermission` sets per-order spending limits. `B2BOrderThresholdTimespanPermission` sets cumulative limits over time periods. `B2BBudget` entities track cost center budgets. When an order exceeds a buyer's limit, the approval workflow escalates up the org hierarchy.

**Why deferred**: Purchase limits are a sales/procurement concern, not an identity/auth concern. They depend on the order entity model (SPEC-029 sales module) and optionally on org hierarchy (Extension 4) for approval escalation.

**Integration path**:
- Sales module defines `PurchaseLimit` entity linked to `CustomerRole` or `CustomerUser`.
- Order placement checks purchase limits via `CustomerRbacService` integration or a dedicated `PurchaseLimitService`.
- Exceeded limits trigger workflow engine (SPEC workflows module) for approval routing.
- **No changes to `customer_accounts` RBAC needed**: Purchase limits are separate from feature-based RBAC. They operate on financial thresholds, not access permissions.

## Changelog

### 2026-03-05 (v3 — Enterprise Architecture Review)
- **Enterprise architecture review**: Evaluated against SAP Commerce Cloud (B2BCustomer/B2BUnit hierarchy, purchase-threshold RBAC, OAuth 2.0), OroCommerce (Customer/CustomerUser composition, 4-level entity ACL, `selfManaged`/`public` role flags), and Magento 2 / Adobe Commerce (company linkage model, per-company resource-permission roles, company registration approval).
- **Added `customer_assignable` flag** to `CustomerRole`: prevents customer admins from self-assigning privileged roles (e.g., `portal_admin`). Only staff can assign roles with `customer_assignable = false`. Seeded default: `portal_admin` = `false`, `buyer`/`viewer` = `true`. Inspired by OroCommerce's `selfManaged`/`public` role flags.
- **Updated portal role assignment/invitation routes**: `PUT /api/customer-portal/users/:id/roles` and `POST /api/customer-portal/users/invite` now validate `customer_assignable` on all roleIds. Returns `403` for restricted roles. Staff admin routes bypass this restriction.
- **Added Future Extensions section** with 6 documented extension points and schema migration paths:
  1. Entity-level RBAC scoping (User/Department/Corporate access levels, inspired by OroCommerce)
  2. Multi-company support (junction table migration path from direct FK)
  3. Company registration approval workflow (inspired by SAP + Magento)
  4. Organization hierarchy — teams & departments (inspired by SAP B2BUnit tree + Magento company_structure)
  5. Guest visitor tracking (OroCommerce CustomerVisitor pattern)
  6. Purchase limits & budget permissions (SAP B2BOrderThresholdPermission pattern)
- **Scope-extensible feature entries**: `features_json` in `CustomerRoleAcl` and `CustomerUserAcl` documented with forward-compatible `FeatureEntry` type (`string | { feature, scope }`). Phase 1 uses string-only; future Extension 1 adds `user`/`department`/`corporate` scope levels without schema migration. `featureMatch.ts` exports `FeatureEntry` type, `featureString()`, `featureScope()`, `extractFeatureStrings()` helpers alongside existing `matchFeature()`/`hasAllFeatures()`. Scope evaluation deferred to query-level ACL filtering (OroCommerce `AclHelper` pattern).
- **Schema migration path analysis**: Validated that the `UNIQUE (tenant_id, email_hash)` constraint, nullable `customer_entity_id`, and `features_json` string array format are all forward-compatible with future extensions — no Phase 1 schema changes needed.
- **Expanded Market Reference**: Added SAP Commerce Cloud and Magento 2 / Adobe Commerce to the research base with specific architectural findings and adopted/rejected decisions.

### 2026-03-04 (v2 — Complete Rewrite)
- **Architecture change**: Replaced flat `CustomerAccount` + `CustomerAccountPortalAccess` model with two-tier `CustomerUser` + full RBAC ecosystem.
- **New entity model**: 9 entities (up from 5): `CustomerUser`, `CustomerRole`, `CustomerRoleAcl`, `CustomerUserRole`, `CustomerUserAcl`, `CustomerUserSession`, `CustomerUserEmailVerification`, `CustomerUserPasswordReset`, `CustomerUserInvitation`.
- **Dual CRM links**: `CustomerUser` connects to both person entity (`person_entity_id`) and company entity (`customer_entity_id`), supporting B2B multi-user scenarios.
- **Full RBAC**: Mirrors staff system exactly — role-based features, per-user overrides, wildcard matching, `is_portal_admin` flag.
- **Portal access via features**: Replaced `CustomerAccountPortalAccess` entity with `portal.*` feature namespace in RBAC. More flexible, one system to manage.
- **Shared feature matching**: Extracted `matchFeature()`/`hasAllFeatures()` to `packages/shared/src/lib/auth/featureMatch.ts`, used by both staff and customer RBAC services.
- **Invitation system**: Added `CustomerUserInvitation` entity with 72h TTL token, supporting both staff-initiated and customer-admin-initiated invitations.
- **Default roles**: Three seeded roles: `portal_admin`, `buyer` (default), `viewer`.
- **Customer portal routes**: New `/api/customer-portal/*` namespace for customer-authenticated self-service (profile, sessions, company user management).
- **Two UMES widgets**: `AccountStatusCard` (person detail) and `CompanyUsersCard` (company detail).
- **6-phase implementation plan** with ~60 files.

### 2026-03-04 (v1 — Initial, Superseded)
- Initial specification with flat `CustomerAccount` model. Rejected in review: does not support multiple users per customer, lacks granular permissions for B2B.
