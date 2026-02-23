# SSO Implementation Milestones

**Date:** 2026-02-19
**Updated:** 2026-02-22
**Status:** M1 and M2 completed. M3 (SCIM) is next.
**Spec:** `.ai/specs/enterprise/SPEC-ENT-002-2026-02-19-sso-directory-sync.md`
**Strategy:** One PR per milestone, merged to `develop` incrementally
**Dev IdP:** Zitadel (free cloud instance) for all phases; cross-validate with Entra ID + Google Workspace in final milestones

---

## What We're Building

A fully working enterprise SSO module supporting **OIDC only** (SAML deferred) and SCIM 2.0, with three identity providers: Zitadel, Microsoft Entra ID, and Google Workspace. Each milestone delivers a shippable increment.

**Protocol decision:** OIDC covers ~90% of real enterprise use cases. Entra ID, Google Workspace, Okta, and Zitadel all support OIDC natively. SAML is deferred — the pluggable provider architecture accommodates adding it later without touching OIDC code, when a specific customer demands it and their IdP has no OIDC endpoint.

---

## Prerequisites

> **Core auth event emission:** The current `auth` module declares `auth.login.success` and `auth.login.failed` events in `events.ts` but **never emits them** from the login handler (`api/login.ts`). Before M1, add event emission to the core login handler. This is needed by both the SSO module (HRD integration) and the MFA module (SPEC-ENT-001). This is a small, isolated change to `packages/core/src/modules/auth/api/login.ts`.

---

## Milestones

### ~~Milestone 1: Module Scaffold + OIDC Login with Zitadel~~ DONE

**PR:** `feat(sso): module scaffold and OIDC login flow`
**Goal:** A user can log in to Open Mercato via Zitadel OIDC. No admin UI yet — config seeded via setup/migration.

<details>
<summary>Deliverables (completed)</summary>

- [x] Module scaffold at `packages/enterprise/src/modules/sso/` (index.ts, acl.ts, setup.ts, di.ts, events.ts)
- [x] Database entities + migration: `sso_configs`, `sso_identities`
- [x] `SsoProviderRegistry` + `OidcProvider` (using `openid-client` v6)
- [x] `SsoService` — orchestrates initiate → callback → session
- [x] `AccountLinkingService` — lookup by `idp_subject`, then email match, then JIT provision
- [x] API routes: `POST /api/sso/hrd` (basic: lookup by org), `GET /api/sso/initiate`, `POST /api/sso/callback/oidc`
- [x] OIDC flow state management (encrypted cookie for `state` + `nonce`)
- [x] Session issuance after SSO callback (JWT + session cookie via existing auth primitives)
- [x] Seed a test SSO config for Zitadel in dev environment (using free cloud instance credentials via env vars)
- [x] Document Zitadel project/application setup (where to find client ID, issuer URL, redirect URIs)
- [x] Integration test: OIDC login end-to-end with Zitadel

</details>

---

### ~~Milestone 2: SSO Admin UI + Config Management~~ DONE

**PR:** `feat(sso): admin UI for IdP configuration`
**Goal:** Admins can configure SSO connections through the backend UI instead of seeded data.

<details>
<summary>Deliverables (completed)</summary>

- [x] SSO config CRUD API: `GET/POST/PUT/DELETE /api/sso/config`
- [x] Config activate/deactivate endpoints
- [x] Connection test endpoint: `POST /api/sso/config/:id/test`
- [x] Domain management API: CRUD `/api/sso/config/:id/domains`
- [x] `HrdService` — full email domain lookup via `allowed_domains` GIN index (extends M1's basic org-level HRD with multi-domain routing)
- [x] Backend pages: SSO dashboard, IdP config list, OIDC setup wizard (protocol → credentials → domains → test → activate)
- [x] IdP detail page with tabs (general, domains, activity)
- [x] RBAC features: `sso.config.view`, `sso.config.manage`
- [x] Default role features in `setup.ts`
- [x] Validators (zod schemas for config CRUD)

</details>

---

### Milestone 3: SCIM 2.0 Provisioning with Zitadel

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
- Admin generates SCIM token in UI, configures Zitadel to push to Open Mercato SCIM endpoint
- Zitadel creates user → user appears in Open Mercato with SSO identity
- Zitadel updates user name → reflected in Open Mercato
- Zitadel deactivates user → user soft-deleted, active sessions revoked
- Zitadel group membership change → user roles updated in Open Mercato
- All SCIM operations logged in provisioning log
- Invalid/expired SCIM tokens rejected with 401

---

### Milestone 4: Microsoft Entra ID Validation

**PR:** `feat(sso): entra id validation and compatibility`
**Goal:** SSO (OIDC) and SCIM fully working with Microsoft Entra ID.

**Deliverables:**
- [ ] Entra ID OIDC testing (App Registration → OIDC flow → callback)
- [ ] PKCE hardcoded verification (Entra doesn't advertise in metadata but supports it)
- [ ] Entra ID SCIM testing (Enterprise App → provisioning → SCIM endpoint)
- [ ] Lenient SCIM parser for Entra deviations (non-standard PATCH paths, mixed-case filter operators)
- [ ] SCIM filter extensions if needed for Entra compatibility
- [ ] Admin UI: Entra-specific setup hints in the wizard (where to find tenant ID, client ID, etc.)
- [ ] Documentation: Entra ID setup guide (step-by-step with screenshots/instructions)
- [ ] Integration tests with Entra ID (may require test tenant)

**Acceptance criteria:**
- OIDC login with Entra ID works end-to-end
- SCIM provisioning from Entra ID creates/updates/deactivates users
- SCIM group sync from Entra ID maps to Open Mercato roles
- Setup wizard provides clear guidance for Entra configuration

---

### Milestone 5: Google Workspace Validation + Final Polish

**PR:** `feat(sso): google workspace support and production readiness`
**Goal:** SSO with Google Workspace working. Module is production-ready.

**Deliverables:**
- [ ] Google Workspace OIDC testing (GCP Console → OAuth 2.0 credentials → callback)
- [ ] Google-specific handling (no SCIM push — JIT only)
- [ ] Admin UI: Google-specific setup hints in the wizard
- [ ] Documentation: Google Workspace setup guide
- [ ] Email notifications: account linked to SSO, SCIM user provisioned
- [ ] i18n: English + Polish translations for all SSO UI strings
- [ ] MFA integration: configurable `skipMfaForSso` flag (when security module installed)
- [ ] Security audit: CSRF, replay protection, tenant isolation
- [ ] Final integration test suite across all three IdPs
- [ ] Admin documentation: complete setup guides for all three IdPs

**Acceptance criteria:**
- Google Workspace OIDC login works end-to-end
- All three IdPs (Zitadel, Entra ID, Google) verified working
- Notifications sent for key SSO events
- All UI strings translated (en + pl)
- Security audit passed — no CSRF or replay vulnerabilities
- Module ready for production deployment

---

---

## Deferred to v1.1+

### SSO Enforcement + Break-Glass (was Milestone 3)

**Deferred reason:** M1 + M2 deliver a fully working, admin-configurable SSO module. Enforcement (mandatory SSO, password blocking) is a policy layer that can be added cleanly on top without reworking existing code. Deferring reduces v1 scope and lets us gather real customer feedback first. Prioritize when an enterprise customer requires mandatory SSO for compliance.

**Scope when implemented:**
- `SsoEnforcementService` — `sso_required` flag, break-glass eligibility
- Enforcement API: `GET/PUT /api/sso/enforcement`
- Login page HRD integration — redirect instead of password form when SSO required
- Password login blocking + super-admin bypass
- Break-glass event: `sso.enforcement.bypassed`
- Enforcement admin page, SSO identity management API
- Widget injection: SSO identity info on user detail page, SSO status on org settings page
- RBAC features: `sso.enforcement.view`, `sso.enforcement.manage`, `sso.identities.view`, `sso.identities.manage`
- Email notification: SSO enforcement activated

---

## Key Decisions

1. **OIDC-only for v1** — covers all targeted IdPs; SAML deferred until a specific customer demands it on a legacy IdP with no OIDC endpoint
2. **Spec phases as milestone axis** — follow SPEC-ENT-002 phases, one PR per milestone
3. **Zitadel first** — all protocol work developed and tested against the free Zitadel cloud instance
4. **Cross-IdP validation last** — Entra ID and Google Workspace are validation milestones, not development milestones
5. **SCIM paths** — use `/api/sso/scim/v2/...` (module-prefixed) to comply with auto-discovery; IdP clients configured with this base URL
6. **OIDC state in encrypted cookie** — no Redis/DB needed for flow state
7. **PR per milestone** — incremental merges to `develop`, module behind enterprise overlay
8. **Enforcement deferred to v1.1** — v1 ships with optional SSO (M1-M2 done) + SCIM + IdP validation. Enforcement (mandatory SSO, password blocking, break-glass) deferred until customer demand justifies it

## Resolved Questions

1. **SAML support:** Deferred. All three target IdPs (Entra ID, Google Workspace, Zitadel) support OIDC. The pluggable `SsoProtocolProvider` interface means SAML can be added as a second implementation without touching OIDC code. Revisit when a customer demands it.
2. **Google Directory Sync:** JIT-only is acceptable for v1. Google Workspace users are created on first SSO login. No pull-based Directory API sync in scope — can be added as a future milestone if needed.
3. **Entra ID test tenant:** Need to create a free Azure account + Entra ID tenant before Milestone 5. Document the setup steps in the Entra ID setup guide.
4. **Zitadel SCIM:** Zitadel supports SCIM 2.0 natively (no extension needed). Use the free cloud instance for SCIM development and testing. Document how to enable and configure SCIM in the Zitadel console.
