# ADR: SSO & Directory Sync Module for @open-mercato/enterprise

**Status:** Draft
**Date:** 2026-02-19
**Package:** `packages/enterprise/src/modules/sso/`
**Framework:** Next.js 16, React 19, MikroORM 6, PostgreSQL
**Estimated effort:** 2-4 weeks (single senior developer)

---

## TLDR

Enterprise SSO module enabling federated authentication (OIDC + SAML 2.0) with any corporate identity provider, plus SCIM 2.0 directory synchronization for automated user lifecycle management. Per-organization IdP configuration, email-domain-based Home Realm Discovery, JIT provisioning, group-to-role mapping, and SSO enforcement policies. Zero modifications to the core auth module.

---

## 1. Context & Problem Statement

Open Mercato's auth module provides password-based authentication with JWT sessions, RBAC, and multi-tenant scoping. The `User` entity already has a nullable `passwordHash` field, anticipating password-less flows. The enterprise security module (SPEC-ENT-001) provides MFA but does not address federated identity or directory sync.

Enterprise customers need:

- **SSO:** Authenticate via corporate IdP (Entra ID, Okta, Google Workspace, etc.) instead of separate passwords
- **Directory Sync:** Automated user provisioning/deprovisioning from corporate directory
- **Centralized Policies:** SSO-required enforcement, allowed domains, break-glass access
- **Audit:** Full trail for SSO events, account linking, and provisioning actions

### Gap Analysis

| Capability | Current | Required |
|---|---|---|
| Authentication | Password-only | Password + SSO (OIDC/SAML) |
| User provisioning | Manual | SCIM 2.0 + JIT |
| User deprovisioning | Manual | Automated via SCIM |
| IdP configuration | None | Per-organization |
| Home Realm Discovery | None | Email-domain routing |
| Account linking | N/A | SSO identity → existing user |
| Group/role sync | N/A | IdP groups → roles in Open Mercato |

---

## 2. Decision

Build an SSO & Directory Sync module delivering nine capabilities:

1. **Multi-protocol SSO** — OIDC (Authorization Code + PKCE) and SAML 2.0 via pluggable provider registry
2. **Per-organization IdP configuration** — Independent SSO connection per organization
3. **Home Realm Discovery (HRD)** — Email-domain routing to correct IdP
4. **JIT provisioning** — Account creation on first SSO login
5. **SCIM 2.0 endpoint** — Inbound SCIM server for user lifecycle + group sync
6. **Account linking** — Email-verified linking of SSO identities to existing accounts
7. **SSO enforcement** — Per-organization toggle to require SSO, disable password login
8. **SP metadata & certificates** — SAML SP metadata generation, certificate rotation
9. **Admin dashboard** — IdP setup wizard, connection testing, provisioning logs

### V1 Supported Identity Providers

The first version targets three identity providers covering the most common enterprise scenarios:

| IdP | Protocol | SCIM Support | Notes |
|---|---|---|---|
| **Microsoft Entra ID** (Azure AD) | OIDC (primary) + SAML 2.0 | Yes — native SCIM 2.0 client | Most common enterprise IdP. PKCE hardcoded (Entra supports but doesn't advertise in metadata). Known SCIM deviations handled with lenient parser. |
| **Google Workspace** | OIDC only | No — uses proprietary Directory API | OIDC via Google's `.well-known/openid-configuration`. No SAML SP-initiated needed. Directory sync deferred (Google does not support SCIM push). JIT provisioning only. |
| **Keycloak** | OIDC + SAML 2.0 | Yes — SCIM via extension | Open-source, self-hosted. Primary development/testing IdP (`docker run quay.io/keycloak/keycloak start-dev`). Full protocol coverage for local testing. |

**Future IdPs** (post-v1, no code changes needed — pluggable architecture): Okta, OneLogin, Ping Identity, ADFS.

### Design Principles

| Principle | Application |
|---|---|
| Zero auth module changes | Integrate via event subscribers, extensions, and widget injection |
| Protocol agnostic core | Provider registry delegates to OIDC/SAML implementations |
| Tenant isolation | All SSO configs, identities, and SCIM tokens scoped to organization |
| Gradual migration | Coexistence of password + SSO; phased enforcement (opt-in → required) |
| Fail-safe | Super-admin break-glass bypass when SSO is enforced |

---

## 3. Architecture

### 3.1 SSO Authentication Flow

```
┌──────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────┐
│  Browser  │    │  Login Page  │    │  SSO Module  │    │   IdP    │
└─────┬─────┘    └──────┬───────┘    └──────┬───────┘    └────┬─────┘
      │                 │                   │                  │
      │  1. Enter email │                   │                  │
      │────────────────>│                   │                  │
      │                 │  2. HRD lookup    │                  │
      │                 │──────────────────>│                  │
      │                 │  3. SSO config    │                  │
      │                 │<──────────────────│                  │
      │  4. Redirect    │                   │                  │
      │<────────────────│                   │                  │
      │                                                        │
      │  5. Redirect to IdP (OIDC auth URL / SAML AuthnRequest)│
      │───────────────────────────────────────────────────────>│
      │                                                        │
      │  6. User authenticates at IdP                          │
      │<───────────────────────────────────────────────────────│
      │                                                        │
      │  7. Callback (auth code / SAML Response)               │
      │────────────────────────────────────>│                  │
      │                                     │                  │
      │                  8. Validate token/assertion            │
      │                  9. Account linking / JIT provision     │
      │                  10. Issue JWT + session                │
      │                                     │                  │
      │  11. Set cookies, redirect to app   │                  │
      │<────────────────────────────────────│                  │
```

### 3.2 SCIM Provisioning Flow

```
┌────────────────┐         ┌────────────────┐          ┌──────────────┐
│  Entra ID /    │         │  SCIM Endpoint │          │ Open Mercato │
│  Okta / IdP    │         │  /api/scim/v2/ │          │ Database     │
└───────┬────────┘         └───────┬────────┘          └──────┬───────┘
        │  POST /Users             │                          │
        │  (Bearer token auth)     │                          │
        │─────────────────────────>│  Create user + identity  │
        │                          │─────────────────────────>│
        │  201 Created             │                          │
        │<─────────────────────────│                          │
        │                          │                          │
        │  PATCH /Users/{id}       │                          │
        │  { active: false }       │  Deactivate + revoke     │
        │─────────────────────────>│  active sessions         │
        │                          │─────────────────────────>│
        │  200 OK                  │                          │
        │<─────────────────────────│                          │
```

### 3.3 Provider Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    SsoService                            │
│  (orchestrates login, callback, account linking)         │
└────────────────────────┬─────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│                 SsoProviderRegistry                      │
│  register(provider)  │  resolve(protocol)                │
└────────┬─────────────────────────────┬───────────────────┘
         │                             │
         ▼                             ▼
┌─────────────────────┐    ┌─────────────────────┐
│   OidcProvider      │    │   SamlProvider      │
│ • buildAuthUrl()    │    │ • buildAuthUrl()    │
│ • handleCallback()  │    │ • handleCallback()  │
│ • handleLogout()    │    │ • handleLogout()    │
│ • validateConfig()  │    │ • validateConfig()  │
│                     │    │ • generateMetadata()│
│ Uses: openid-client │    │ Uses: @node-saml/   │
│       v6            │    │       node-saml v5  │
└─────────────────────┘    └─────────────────────┘
```

### 3.4 Integration Points

| Integration | Mechanism | Direction |
|---|---|---|
| Auth login flow | Event subscriber on `auth.login.attempt` | SSO → Auth |
| Auth user entity | Entity extension via `data/extensions.ts` | SSO → Auth |
| Auth session issuance | Calls `authService.issueTokens()` after callback | SSO → Auth |
| Security module (MFA) | SSO login triggers MFA check if enrolled | SSO → Security |
| RBAC | SCIM group sync maps to existing roles | SSO → Auth |
| UI | Widget injection on user detail + org settings pages | SSO → UI |
| Audit | SSO events emitted for all auth/provisioning actions | SSO → Events |

---

## 4. Data Model

### 4.1 Tables Overview

| Table | Purpose | Key Fields |
|---|---|---|
| `sso_configs` | Per-org IdP configuration (1:1 with org) | `organization_id`, `protocol` (oidc/saml), OIDC fields (issuer, client_id, client_secret_enc), SAML fields (entity_id, sso_url, certificate), `allowed_domains` (JSONB), `jit_enabled`, `sso_required` |
| `sso_identities` | User ↔ IdP identity link | `user_id`, `sso_config_id`, `idp_subject` (stable IdP user ID), `idp_email`, `idp_groups`, `provisioning_method` (jit/scim/manual) |
| `scim_tokens` | Bearer tokens for SCIM endpoint auth | `sso_config_id`, `token_hash` (bcrypt), `token_prefix`, `is_active`, `expires_at` |
| `scim_provisioning_log` | Append-only audit trail | `sso_config_id`, `operation`, `resource_type`, `user_id`, `response_status`, `error_message` |
| `sso_group_role_mappings` | IdP group → Open Mercato role | `sso_config_id`, `idp_group_id`, `role_id` |
| `sso_sp_certificates` | SAML SP signing keys | `sso_config_id`, `certificate_pem`, `private_key_enc`, `fingerprint`, `is_active`, `not_after` |

### 4.2 Entity Relationships

```
organizations ──1:1──> sso_configs ──1:N──> sso_identities ──N:1──> users
                             │
                             ├──1:N──> scim_tokens
                             ├──1:N──> sso_group_role_mappings ──N:1──> roles
                             ├──1:N──> scim_provisioning_log
                             └──1:N──> sso_sp_certificates
```

### 4.3 Key Constraints

- One SSO config per organization/tenant (`UNIQUE(organization_id)`)
- One identity link per user per SSO config (`UNIQUE(sso_config_id, user_id)`)
- Unique IdP subject per config (`UNIQUE(sso_config_id, idp_subject)`)
- OIDC client secret and SP private keys encrypted at rest via tenant DEK
- SCIM tokens stored as bcrypt hashes only (raw shown once on creation)

---

## 5. API Surface

### 5.1 SSO Authentication (Public)

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/sso/hrd` | Home Realm Discovery — resolve config from email |
| GET | `/api/sso/initiate` | Redirect user to IdP |
| POST | `/api/sso/callback/oidc` | OIDC authorization code callback |
| POST | `/api/sso/callback/saml` | SAML Response callback (ACS) |
| GET | `/api/sso/metadata/:configId` | SAML SP metadata XML |
| POST | `/api/sso/logout` | Initiate single logout |

### 5.2 SSO Admin (Auth Required)

| Method | Endpoint | Feature |
|---|---|---|
| CRUD | `/api/sso/config` | `sso.config.view` / `sso.config.manage` |
| POST | `/api/sso/config/:id/test` | `sso.config.manage` |
| POST | `/api/sso/config/:id/activate` | `sso.config.manage` |
| CRUD | `/api/sso/config/:id/domains` | `sso.config.manage` |
| CRUD | `/api/sso/config/:id/group-mappings` | `sso.config.manage` |
| GET | `/api/sso/identities` | `sso.identities.view` |
| DELETE | `/api/sso/identities/:id` | `sso.identities.manage` |
| GET/PUT | `/api/sso/enforcement` | `sso.enforcement.view` / `sso.enforcement.manage` |
| GET | `/api/sso/provisioning-log` | `sso.provisioning.view` |

### 5.3 SCIM 2.0 (Bearer Token Auth)

| Method | Endpoint | Description |
|---|---|---|
| CRUD | `/api/scim/v2/Users` | User lifecycle (create, update, deactivate, delete) |
| CRUD | `/api/scim/v2/Groups` | Group/membership sync |
| GET | `/api/scim/v2/ServiceProviderConfig` | SCIM capabilities |
| GET | `/api/scim/v2/Schemas` | SCIM schemas |
| POST | `/api/scim/v2/Bulk` | Bulk operations |

### 5.4 SCIM Token Management (Auth Required)

| Method | Endpoint | Feature |
|---|---|---|
| CRUD | `/api/scim/tokens` | `sso.scim.manage` |

---

## 6. Service Layer

| Service | Responsibility |
|---|---|
| **SsoProviderRegistry** | Register/resolve protocol providers (same pattern as `MfaProviderRegistry` in SPEC-ENT-001) |
| **SsoService** | Orchestrate SSO login: HRD → provider → account linking → session issuance |
| **OidcProvider** | OIDC Authorization Code + PKCE flow via `openid-client` v6 |
| **SamlProvider** | SAML 2.0 SP flow via `@node-saml/node-saml` v5 |
| **AccountLinkingService** | Resolve user from IdP identity: lookup by `idp_subject` → email match → JIT provision |
| **HrdService** | Email domain → SSO config lookup via `allowed_domains` GIN index |
| **ScimService** | SCIM 2.0 server: user CRUD, group sync, filter parsing, attribute mapping |
| **SsoEnforcementService** | Check if SSO is required for an org; block password login if so (except super-admin) |
| **SsoAdminService** | Connection testing, provisioning stats, identity management |

### Provider Interface

Each SSO protocol provider implements:
- `buildAuthUrl()` — construct redirect URL to IdP
- `handleCallback()` — validate response, return normalized identity payload (subject, email, name, groups)
- `validateConfig()` — test IdP connection
- `handleLogout()` — initiate logout at IdP (optional)

---

## 7. Key Behaviors

### 7.1 Auth Flow Integration

- **Login page extension:** HRD lookup on email entry; if SSO config found, redirect to IdP instead of showing password field
- **Session issuance:** After SSO callback, call existing `authService.issueTokens()` — no JWT schema changes needed
- **Enforcement:** Subscriber intercepts password login when `sso_required = true`; rejects with SSO redirect (super-admin bypass)
- **MFA integration:** SSO login triggers MFA check if security module installed; configurable `skipMfaForSso` flag

### 7.2 Account Linking

Resolution order on SSO callback:
1. Existing link: lookup `sso_identities` by `idp_subject`
2. Email match: if `autoLinkByEmail = true`, find user by verified email
3. JIT provision: if `jitEnabled = true`, create new user (no password) with default role

Use `idp_subject` (not email) as the stable cross-system identifier — emails can change.

### 7.3 SCIM Provisioning

- **Authentication:** Bearer token matched against `scim_tokens` (bcrypt), resolves org scope
- **User mapping:** `userName` → `email`, `displayName` → `name`, `active: false` → soft-deactivate + revoke sessions
- **Group sync:** IdP group membership changes → update `user_roles` via `sso_group_role_mappings`, invalidate RBAC cache
- **Filters:** Support `eq` operator and `and` combinator (minimum for Entra ID compatibility)
- **Rate limiting:** 25 req/s per token
- **Entra ID quirks:** Lenient SCIM parser for non-standard PATCH paths and mixed-case filter operators

### 7.4 Break-Glass

Super-admin accounts (`isSuperAdmin` flag) bypass SSO enforcement. Break-glass logins emit `sso.enforcement.bypassed` event.

---

## 8. Frontend

| Page | Purpose |
|---|---|
| SSO Dashboard (`backend/page.tsx`) | Connection status, user count, SCIM sync status, quick actions |
| IdP Setup Wizard (`backend/config/new/`) | Step-by-step: protocol → IdP config → domains → provisioning → test → activate |
| IdP Detail (`backend/config/[id]/`) | Tabs: general, domains, group mappings, provisioning, certificates, activity |
| SCIM Dashboard (`backend/scim/`) | Token management, provisioning stats |
| Provisioning Log (`backend/provisioning-log/`) | Filterable audit trail |

**Widget injections:** SSO identity info on user detail page; SSO status on org settings page.

---

## 9. Security Considerations

### Token/Assertion Validation

| Check | OIDC | SAML |
|---|---|---|
| Signature | JWT via IdP JWKS | XML Signature against stored IdP cert |
| Issuer | `iss` = stored issuer URL | `Issuer` = stored entity ID |
| Audience | `aud` = our client_id | `Audience` = our SP entity ID |
| Expiry | `exp` with 30s skew tolerance | `NotOnOrAfter` with 30s skew |
| Replay | `nonce` in server session | `InResponseTo` matched |
| CSRF | `state` parameter | `RelayState` |
| PKCE | Always enabled (hardcoded) | N/A |

### Critical Security Points

- **SAML XSW protection:** Pin `xml-crypto` >= 6.0.1 (CVE-2025-29774/29775); validate against stored cert, not response cert
- **IdP-initiated SSO:** Disabled by default; if enabled, enforce <5 min assertion lifetime
- **Secrets:** OIDC client secret + SP private key encrypted via tenant DEK; SCIM tokens bcrypt-hashed
- **Session revocation:** SCIM deactivation immediately revokes all active sessions
- **Tenant isolation:** Token validation bound to specific org's stored config; cross-tenant token reuse impossible

---

## 10. Dependencies

| Package | Purpose |
|---|---|
| `openid-client` ^6.x | OIDC Relying Party (Authorization Code + PKCE) |
| `@node-saml/node-saml` ^5.x | SAML 2.0 Service Provider |
| `xml-crypto` ^6.0.1 | Pin transitive dependency for XSW patches |

SCIM server implemented directly — no SCIM library needed (straightforward REST + zod validators).

---


---

## 11. Risk Assessment

| # | Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|---|
| 1 | SAML signature bypass (XSW) | Critical | Low | Pin xml-crypto, validate stored cert, security audit |
| 2 | IdP outage locks org users | High | Medium | Super-admin break-glass, clear error messaging |
| 3 | SCIM deprovisioning race | Medium | Medium | Immediate session revocation, event-driven cache invalidation |
| 4 | Entra SCIM spec deviations | Medium | High | Lenient parser, Entra-specific test suite |
| 5 | Domain squatting | High | Low | Admin-only config, future DNS TXT verification |
| 6 | Large SCIM initial sync | Medium | Medium | Rate limiting, batch processing, async via worker queue |

---

## 12. Consequences

**Positive:** Federated auth without separate passwords; automated lifecycle management; zero core auth changes; pluggable provider architecture; gradual enforcement migration.

**Negative:** HRD query on every login page load; SCIM maintenance burden (Entra quirks); SP certificate management complexity; two new npm dependencies.

**Neutral:** IdP availability outside our control; SCIM sync interval set by IdP (~40 min for Entra); IdP-initiated SSO disabled by default.

---

## Changelog

| Date | Changes |
|---|---|
| 2026-02-19 | Initial draft — high-level SSO & Directory Sync specification |
| 2026-02-19 | Added V1 targeted IdPs: Microsoft Entra ID, Google Workspace, Keycloak |
