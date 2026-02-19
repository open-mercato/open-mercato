# SSO Implementation Milestones

**Date:** 2026-02-19
**Spec:** `.ai/specs/enterprise/SPEC-ENT-002-2026-02-19-sso-directory-sync.md`
**Strategy:** One PR per milestone, merged to `develop` incrementally
**Dev IdP:** Keycloak (local Docker) for all phases; cross-validate with Entra ID + Google Workspace in final milestones

---

## What We're Building

A fully working enterprise SSO module supporting OIDC, SAML 2.0, and SCIM 2.0 with three identity providers: Keycloak, Microsoft Entra ID, and Google Workspace. Each milestone delivers a shippable increment.

---

## Prerequisites

> **Core auth event emission:** The current `auth` module declares `auth.login.success` and `auth.login.failed` events in `events.ts` but **never emits them** from the login handler (`api/login.ts`). Before M1, add event emission to the core login handler. This is needed by both the SSO module (HRD integration) and the MFA module (SPEC-ENT-001). This is a small, isolated change to `packages/core/src/modules/auth/api/login.ts`.

---

## Milestones

### Milestone 1: Module Scaffold + OIDC Login with Keycloak

**PR:** `feat(sso): module scaffold and OIDC login flow`
**Goal:** A user can log in to Open Mercato via Keycloak OIDC. No admin UI yet — config seeded via setup/migration.

**Deliverables:**
- [ ] Module scaffold at `packages/enterprise/src/modules/sso/` (index.ts, acl.ts, setup.ts, di.ts, events.ts)
- [ ] Database entities + migration: `sso_configs`, `sso_identities`
- [ ] `SsoProviderRegistry` + `OidcProvider` (using `openid-client` v6)
- [ ] `SsoService` — orchestrates initiate → callback → session
- [ ] `AccountLinkingService` — lookup by `idp_subject`, then email match, then JIT provision
- [ ] API routes: `POST /api/sso/hrd` (basic: lookup by org), `GET /api/sso/initiate`, `POST /api/sso/callback/oidc`
- [ ] OIDC flow state management (encrypted cookie for `state` + `nonce`)
- [ ] Session issuance after SSO callback (JWT + session cookie via existing auth primitives)
- [ ] Seed a test SSO config for Keycloak in dev environment
- [ ] Docker Compose service for Keycloak (or documented `docker run` command)
- [ ] Integration test: OIDC login end-to-end with Keycloak

**Acceptance criteria:**
- User enters email → HRD detects SSO → redirected to Keycloak → authenticates → redirected back → JWT issued → logged in
- Existing password login still works for orgs without SSO
- New user JIT-provisioned on first SSO login (no password, assigned default role)
- Existing user linked by email on first SSO login

---

### Milestone 2: SSO Admin UI + Config Management

**PR:** `feat(sso): admin UI for IdP configuration`
**Goal:** Admins can configure SSO connections through the backend UI instead of seeded data.

**Deliverables:**
- [ ] SSO config CRUD API: `GET/POST/PUT/DELETE /api/sso/config`
- [ ] Config activate/deactivate endpoints
- [ ] Connection test endpoint: `POST /api/sso/config/:id/test`
- [ ] Domain management API: CRUD `/api/sso/config/:id/domains`
- [ ] `HrdService` — full email domain lookup via `allowed_domains` GIN index (extends M1's basic org-level HRD with multi-domain routing)
- [ ] Backend pages: SSO dashboard, IdP config list, OIDC setup wizard (protocol → credentials → domains → test → activate)
- [ ] IdP detail page with tabs (general, domains, activity)
- [ ] RBAC features: `sso.config.view`, `sso.config.manage`
- [ ] Default role features in `setup.ts`
- [ ] Validators (zod schemas for config CRUD)

**Acceptance criteria:**
- Admin creates an OIDC config for Keycloak via the setup wizard
- Admin tests the connection (initiates a test login)
- Admin activates the config → HRD starts routing users to Keycloak
- Admin adds/removes allowed email domains
- Non-admin users cannot access SSO config pages

---

### Milestone 3: SAML 2.0 Support + Keycloak SAML

**PR:** `feat(sso): SAML 2.0 provider and SP metadata`
**Goal:** SSO works via SAML 2.0 in addition to OIDC. Tested with Keycloak SAML.

**Deliverables:**
- [ ] `SamlProvider` implementation (using `@node-saml/node-saml` v5)
- [ ] SAML callback route: `POST /api/sso/callback/saml`
- [ ] SP metadata endpoint: `GET /api/sso/metadata/:configId`
- [ ] Database entity + migration: `sso_sp_certificates`
- [ ] SP certificate generation (self-signed X.509) and storage (private key encrypted via tenant DEK)
- [ ] SAML setup wizard in admin UI (metadata upload OR manual config)
- [ ] IdP detail page: certificates tab (view fingerprint, expiry, rotate)
- [ ] Single Logout (SP-initiated) for both OIDC and SAML: `POST /api/sso/logout`
- [ ] Pin `xml-crypto` >= 6.0.1 in package.json
- [ ] Integration test: SAML login end-to-end with Keycloak

**Acceptance criteria:**
- Admin creates a SAML config via wizard (upload Keycloak IdP metadata XML)
- SP metadata XML downloadable for configuring Keycloak
- User logs in via SAML → assertion validated → session issued
- SP-initiated logout clears local session + sends LogoutRequest to Keycloak
- OIDC configs continue to work alongside SAML configs

---

### Milestone 4: SSO Enforcement + Break-Glass

**PR:** `feat(sso): enforcement policies and break-glass access`
**Goal:** Admins can require SSO for their organization, blocking password login. Super-admins retain break-glass access.

**Deliverables:**
- [ ] `SsoEnforcementService` — check `sso_required` flag, evaluate break-glass eligibility
- [ ] Enforcement API: `GET/PUT /api/sso/enforcement`
- [ ] Login page HRD integration — UI-level check (HRD call on email blur before showing password field; if SSO required, redirect instead of showing password form)
- [ ] Password login blocked when `sso_required = true` (returns `{ error: 'sso_required', sso_initiate_url }`)
- [ ] Super-admin bypass (`isSuperAdmin` flag) — password login still works
- [ ] Break-glass event: `sso.enforcement.bypassed`
- [ ] Enforcement admin page in backend UI
- [ ] SSO identity management API: `GET /api/sso/identities`, `DELETE /api/sso/identities/:id`
- [ ] Widget injection: SSO identity info on user detail page
- [ ] Widget injection: SSO status on org settings page
- [ ] RBAC features: `sso.enforcement.view`, `sso.enforcement.manage`, `sso.identities.view`, `sso.identities.manage`
- [ ] Integration test: enforcement blocks password login, super-admin bypass works

**Acceptance criteria:**
- Admin enables `sso_required` → password login blocked for org users
- Super-admin can still log in with password (break-glass)
- Non-SSO user sees clear error with SSO redirect link
- Admin can view/unlink SSO identities from user profiles
- Enforcement can be toggled off to restore password login

---

### Milestone 5: SCIM 2.0 Provisioning with Keycloak

**PR:** `feat(sso): SCIM 2.0 provisioning endpoint`
**Goal:** IdP can push user lifecycle changes (create, update, deactivate) and group membership via SCIM.

**Deliverables:**
- [ ] Database entities + migration: `scim_tokens`, `scim_provisioning_log`, `sso_group_role_mappings`
- [ ] `ScimService` — SCIM 2.0 server: user CRUD, group sync, filter parsing, attribute mapping
- [ ] SCIM bearer token management: generate (show once), store bcrypt hash, revoke
- [ ] SCIM routes: `CRUD /api/sso/scim/v2/Users`, `CRUD /api/sso/scim/v2/Groups`
- [ ] SCIM discovery routes: `ServiceProviderConfig`, `Schemas`, `ResourceTypes`
- [ ] SCIM filter parser (support `eq` and `and` operators minimum)
- [ ] SCIM PATCH operation handler (RFC 7644 Section 3.5.2)
- [ ] User attribute mapping: `userName` → `email`, `displayName` → `name`, `active: false` → soft-deactivate
- [ ] Group-to-role mapping via `sso_group_role_mappings`
- [ ] Session revocation on SCIM deactivation (`active: false`)
- [ ] RBAC cache invalidation on group membership change
- [ ] Provisioning audit log (append-only `scim_provisioning_log`)
- [ ] SCIM token management API: `CRUD /api/sso/scim/tokens`
- [ ] SCIM admin dashboard (token management, provisioning stats)
- [ ] Provisioning log viewer page
- [ ] Rate limiting: 25 req/s per token
- [ ] RBAC features: `sso.scim.manage`, `sso.provisioning.view`
- [ ] Integration test: SCIM create/update/deactivate user, group sync

**Acceptance criteria:**
- Admin generates SCIM token in UI, configures Keycloak SCIM extension to push to Open Mercato
- Keycloak creates user → user appears in Open Mercato with SSO identity
- Keycloak updates user name → reflected in Open Mercato
- Keycloak deactivates user → user soft-deleted, active sessions revoked
- Keycloak group membership change → user roles updated in Open Mercato
- All SCIM operations logged in provisioning log
- Invalid/expired SCIM tokens rejected with 401

---

### Milestone 6: Microsoft Entra ID Validation

**PR:** `feat(sso): entra id validation and compatibility`
**Goal:** SSO (OIDC + SAML) and SCIM fully working with Microsoft Entra ID.

**Deliverables:**
- [ ] Entra ID OIDC testing (App Registration → OIDC flow → callback)
- [ ] PKCE hardcoded verification (Entra doesn't advertise in metadata but supports it)
- [ ] Entra ID SAML testing (Enterprise App → SAML config → ACS callback)
- [ ] Entra ID SCIM testing (Enterprise App → provisioning → SCIM endpoint)
- [ ] Lenient SCIM parser for Entra deviations (non-standard PATCH paths, mixed-case filter operators)
- [ ] SCIM filter extensions if needed for Entra compatibility
- [ ] Admin UI: Entra-specific setup hints in the wizard (where to find tenant ID, client ID, etc.)
- [ ] Documentation: Entra ID setup guide (step-by-step with screenshots/instructions)
- [ ] Integration tests with Entra ID (may require test tenant)

**Acceptance criteria:**
- OIDC login with Entra ID works end-to-end
- SAML login with Entra ID works end-to-end
- SCIM provisioning from Entra ID creates/updates/deactivates users
- SCIM group sync from Entra ID maps to Open Mercato roles
- Setup wizard provides clear guidance for Entra configuration

---

### Milestone 7: Google Workspace Validation + Final Polish

**PR:** `feat(sso): google workspace support and production readiness`
**Goal:** SSO with Google Workspace working. Module is production-ready.

**Deliverables:**
- [ ] Google Workspace OIDC testing (GCP Console → OAuth 2.0 credentials → callback)
- [ ] Google-specific handling (no SAML needed, no SCIM push — JIT only)
- [ ] Admin UI: Google-specific setup hints in the wizard
- [ ] Documentation: Google Workspace setup guide
- [ ] Email notifications: account linked to SSO, SSO enforcement activated, SCIM user provisioned
- [ ] i18n: English + Polish translations for all SSO UI strings
- [ ] MFA integration: configurable `skipMfaForSso` flag (when security module installed)
- [ ] Security audit: SAML signature validation, CSRF, replay protection, tenant isolation
- [ ] Final integration test suite across all three IdPs
- [ ] Admin documentation: complete setup guides for all three IdPs

**Acceptance criteria:**
- Google Workspace OIDC login works end-to-end
- All three IdPs (Keycloak, Entra ID, Google) verified working
- Notifications sent for key SSO events
- All UI strings translated (en + pl)
- Security audit passed — no XSW, CSRF, or replay vulnerabilities
- Module ready for production deployment

---

## Key Decisions

1. **Spec phases as milestone axis** — follow SPEC-ENT-002 phases, one PR per milestone
2. **Keycloak first** — all protocol work developed and tested locally against Keycloak Docker
3. **Cross-IdP validation last** — Entra ID and Google Workspace are validation milestones, not development milestones
4. **SCIM paths** — use `/api/sso/scim/v2/...` (module-prefixed) to comply with auto-discovery; IdP clients configured with this base URL
5. **OIDC state in encrypted cookie** — no Redis/DB needed for flow state
6. **PR per milestone** — incremental merges to `develop`, module behind enterprise overlay

## Resolved Questions

1. **Google Directory Sync:** JIT-only is acceptable for v1. Google Workspace users are created on first SSO login. No pull-based Directory API sync in scope — can be added as a future milestone if needed.
2. **Entra ID test tenant:** Need to create a free Azure account + Entra ID tenant before Milestone 6. Document the setup steps in the Entra ID setup guide.
3. **Keycloak SCIM:** Use the `keycloak-scim` extension in the Docker setup for SCIM development and testing. Document the extension installation as a prerequisite for the dev environment.
