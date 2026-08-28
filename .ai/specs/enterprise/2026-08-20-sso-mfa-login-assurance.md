# SSO and MFA Login Assurance

**Status:** Implemented
**Date:** 2026-08-20
**Work item:** OM-SEC-003
**Package:** `@open-mercato/enterprise`

## TLDR

Enterprise login must not issue a normal staff credential before every configured authentication condition is satisfied. This point isolates pending MFA credentials, makes challenge failures fail closed, enforces active SSO-only policy, validates configured OIDC `acr` and `amr` requirements, and protects stored MFA and OIDC secrets through the platform encryption maps.

The supporting generic Core session-finalization behavior is specified separately in `.ai/specs/2026-08-21-intercepted-login-session-finalization.md`. Both specifications ship in the single `OM-SEC-003` commit.

## Overview

The Enterprise security and SSO modules already provide TOTP, passkeys, email OTP, OIDC, JIT provisioning, and SCIM Users. The remaining login path does not enforce those controls consistently:

- a pending MFA token is signed as a normal staff token;
- MFA challenge-service failures can leave the original full-access login intact;
- `ssoRequired` exists in storage but cannot be configured or enforced;
- OIDC issues a staff session without checking administrator-defined assurance claims;
- TOTP and OIDC client secrets have no correct module encryption map.

This specification closes those paths without moving SSO or MFA policy into MIT Core.

### Market Reference

Keycloak's [Server Administration Guide](https://www.keycloak.org/docs/latest/server_admin/) treats authentication flow state separately from completed sessions and recommends that relying parties verify the returned `acr` value instead of trusting the requested level. OpenID Connect Core defines an essential `acr` request as a requirement that must match or fail authentication in [section 5.5.1.1](https://openid.net/specs/openid-connect-core-1_0.html#acrSemantics). Open Mercato adopts both rules: the pending credential has a separate audience, and configured assurance is requested and checked on the verified ID token.

## Problem Statement

### MFA pending credential

The password-login interceptor creates a short-lived token with `mfa_pending: true`, but it uses the staff audience. The normal request resolver can therefore authenticate it on unrelated APIs before the second factor is verified.

The interceptor also treats an unavailable MFA service or failed challenge creation as a no-op. For an enrolled user this restores the original full-access login response.

### SSO enforcement

`SsoConfig.ssoRequired` is returned by the API but admin validators and service writes omit it. Password authentication is never checked against the active organization SSO configuration.

### OIDC assurance

OIDC validates signature, issuer, nonce, state, and PKCE, but discards `acr` and `amr`. An administrator cannot require a specific authentication context or a set of methods before a staff session is created.

### Secret storage

`UserMfaMethod.secret` and `SsoConfig.clientSecretEnc` are sensitive. The current SSO service uses mismatched ad hoc entity identifiers, and neither module declares the fields in `defaultEncryptionMaps`. Existing and new values can therefore remain plaintext depending on runtime configuration.

## Proposed Solution

### 1. Isolated MFA flow

- Sign pending credentials with audience `mfa_pending` and a ten-minute lifetime.
- Keep the existing session identifier, subject, tenant, organization, email, and role claims for later canonical validation.
- Mark only the three challenge routes as unauthenticated at the generic dispatcher level.
- In those routes, verify the `mfa_pending` audience explicitly, resolve the live session and canonical user scope, and reject every normal staff token.
- After successful challenge or recovery verification, issue the existing staff-audience token.
- Resolve whether a user has active MFA methods before creating a challenge. Users without methods keep the current password-login behavior unless a separate enrollment policy blocks navigation. Enrolled users fail closed on service or challenge errors.

### 2. SSO-only password policy

- Add an SSO after-interceptor with priority above the MFA interceptor.
- Read the verified password-login token only to identify the already authenticated subject and organization.
- Resolve super-admin status through the canonical RBAC service. Super-admin accounts remain break-glass users.
- For every other user, replace the login response with `{ ok: false, code: 'SSO_REQUIRED' }` when the organization has an active, non-deleted configuration with `ssoRequired: true`.
- Persist and expose `ssoRequired` through create, update, detail, and settings UI.
- Let exceptions propagate so the Core finalizer deletes the session and issues no cookies.

### 3. OIDC assurance

- Add `requiredAcrValues: string[]` and `requiredAmrValues: string[]` to `SsoConfig`.
- When ACR values are configured, request the ID-token `acr` claim as essential using the OIDC `claims` parameter. Do not also send `acr_values`, because combining both request forms has unspecified semantics in OpenID Connect Core.
- Extract `acr` as one string and `amr` as a normalized string array from the verified ID-token claims.
- Require the returned `acr` to match at least one configured ACR value.
- Require the returned `amr` array to contain every configured AMR value.
- Reject the callback before account linking or session creation if either rule fails.
- Include the accepted assurance facts in the issued staff JWT as additive `acr`, `amr`, and `mfa_verified` claims. A normal staff verifier does not depend on them.

Local MFA step-up after an OIDC callback is outside this point. Deployments that require MFA on SSO must configure IdP assurance requirements until that follow-up is implemented.

### 4. Encryption maps

- Add `security:user_mfa_method.secret` with deterministic `secret_hash` for the short-lived setup lookup.
- Add `sso:sso_config.client_secret_enc` without a lookup hash.
- Route secret-bearing reads through `findWithDecryption` or `findOneWithDecryption`.
- Use the canonical entity IDs in explicit encryption helper calls.
- Keep recovery codes hashed with bcrypt; they are not encrypted or made reversible.

## Architecture

```text
Password login
  Core credentials + bounded session
       |
       v
  SSO interceptor (priority 100)
       | active ssoRequired + not break-glass
       +--------------------------------------> deny, Core deletes session
       |
       v
  MFA interceptor (priority 50)
       | no active methods
       +--------------------------------------> normal staff session
       | active methods
       v
  aud=mfa_pending token
       |
       v
  prepare / verify / recovery routes
       | explicit audience + live session + canonical scope
       v
  normal staff token
```

```text
OIDC initiate
  configured ACR -> essential ID-token claim request
       |
       v
  IdP authentication
       |
       v
  verified ID token -> validate ACR and AMR
       | mismatch / missing
       +--------------------------------------> callback failure, no session
       |
       v
  account link / JIT -> normal staff session with assurance facts
```

Enterprise owns both interceptors and all direct imports from Core authentication services. Core has no dependency on Enterprise. The SSO interceptor runs before MFA and returns a non-success body, so the MFA interceptor naturally no-ops on an SSO-only denial.

## Data Models

### `SsoConfig`

Additive fields:

- `required_acr_values jsonb NOT NULL DEFAULT '[]'`
- `required_amr_values jsonb NOT NULL DEFAULT '[]'`

Existing `sso_required boolean NOT NULL DEFAULT false` becomes writable through the admin API.

### `UserMfaMethod`

Additive field:

- `secret_hash text NULL`, indexed for pending setup lookup

Encryption map:

```ts
{
  entityId: 'security:user_mfa_method',
  fields: [{ field: 'secret', hashField: 'secret_hash' }],
}
```

### `SsoConfig` encryption map

```ts
{
  entityId: 'sso:sso_config',
  fields: [{ field: 'client_secret_enc' }],
}
```

## API Contracts

### `POST /api/auth/login`

Existing route, extended by Enterprise interceptors.

SSO-only denial body:

```json
{
  "ok": false,
  "code": "SSO_REQUIRED",
  "error": "Single sign-on is required for this organization."
}
```

The Core finalizer returns no authentication cookies and removes the new session.

MFA challenge response remains additive and keeps the current fields. Its `token` now uses audience `mfa_pending`.

### `POST /api/security/mfa/prepare`

### `POST /api/security/mfa/verify`

### `POST /api/security/mfa/recovery`

The route metadata changes to `requireAuth: false` because the generic staff verifier must reject a pending audience. Each handler performs its own explicit pending-token authentication and canonical session validation before reading the request body.

Errors remain 401 for missing or invalid pending credentials and 403 when a non-pending credential reaches the flow.

### `POST /api/sso/config`

Add optional request fields:

```json
{
  "ssoRequired": false,
  "requiredAcrValues": ["2"],
  "requiredAmrValues": ["pwd", "otp"]
}
```

### `PUT /api/sso/config/:id`

Add the same optional fields. Arrays are limited to 20 unique, trimmed values of at most 255 characters.

### SSO config responses

Add `requiredAcrValues` and `requiredAmrValues`. `ssoRequired` already exists and remains stable.

### `GET|POST /api/sso/callback/oidc`

No request or successful response change. An unmet configured assurance requirement redirects to the existing SSO failure path and creates no account session.

## Internationalization

Add keys in every shipped SSO locale for:

- SSO-required login denial;
- SSO-only setting label and description;
- required ACR and AMR labels and descriptions;
- assurance-validation callback error;
- review values in the create wizard.

## UI/UX

The existing client-side SSO create and detail pages remain local client islands. No new provider, global state, route, or bundle-heavy dependency is introduced.

- Use `CheckboxField` for settings saved by the existing Save/Create action.
- Use `FormField` and `Input` for comma-separated ACR and AMR values.
- Explain that all configured AMR values are required.
- Display the configured values in the create review step.
- Keep the configuration inactive after creation.
- Replace the touched hardcoded success color with `text-status-success-text`.

### Frontend Architecture Contract

| File | Boundary | Reason |
|---|---|---|
| `backend/sso/config/new/page.tsx` | Existing client island | Wizard state, validation, and navigation are interactive. |
| `backend/sso/config/[id]/page.tsx` | Existing client island | Tabs and inline settings edits are interactive. |

- No new `"use client"` file.
- No new global provider or bootstrap work.
- No new dependency or large client library.
- Existing `LoadingMessage` and error states remain.
- Required UI regression coverage: create fields persist; update fields reload; activation behavior remains intact.

## Migration & Compatibility

- Additive nullable/defaulted columns only.
- Do not apply migrations to a developer database as part of this work.
- Generate and review the SSO and Security migrations plus module snapshots.
- Existing configurations default to no ACR/AMR requirement and `ssoRequired: false`, preserving login behavior until explicitly configured.
- Existing MFA setup rows may have `secret_hash = NULL`. After deployment, run the existing idempotent encryption-map seed and encryption rotation/backfill commands for each tenant and organization:

```bash
yarn mercato entities seed-encryption --tenant <tenantId> --organization <organizationId>
yarn mercato entities rotate-encryption-key --tenant <tenantId> --organization <organizationId> --dry-run
yarn mercato entities rotate-encryption-key --tenant <tenantId> --organization <organizationId>
```

- New pending MFA tokens are intentionally incompatible with the staff audience. Existing ten-minute pending tokens expire naturally during a rolling deployment.
- Normal staff token format is additive only. Existing verifiers ignore the new optional assurance claims.

## Implementation Plan

### Phase 1: Core finalization dependency

1. Implement and test `.ai/specs/2026-08-21-intercepted-login-session-finalization.md`.

### Phase 2: MFA isolation and encryption

1. Add Security encryption map and `secret_hash` migration.
2. Convert secret-bearing MFA reads to decryption helpers.
3. Add pending-audience resolver with canonical session validation.
4. Make the three challenge routes use that resolver.
5. Make enrolled-user challenge failure fail closed.
6. Add unit and API regression tests.

### Phase 3: SSO enforcement and assurance

1. Add SSO encryption map and fix canonical entity identifiers.
2. Add config fields, migration, validation, service persistence, and UI.
3. Add the SSO-required password-login interceptor with break-glass resolution.
4. Request and validate OIDC assurance claims.
5. Add unit and integration coverage.

### Phase 4: Verification

1. Run `yarn generate`.
2. Run focused Core, Security, SSO, module-decoupling, typecheck, lint, and build gates.
3. Run the selected isolated integration-test mode.
4. Review the final diff for licensing, customer-neutral wording, and generated-file scope.

## Testing Strategy

### Unit tests

- Pending token verifies only with audience `mfa_pending`.
- A staff token cannot call the pending MFA routes.
- Missing MFA service and challenge errors deny enrolled users.
- A user without active MFA methods retains the existing login flow.
- Active SSO-required config blocks password login for normal users.
- Super-admin break-glass bypass remains available.
- OIDC ACR requires one configured match.
- OIDC AMR requires every configured method.
- Missing required claims fail before session creation.
- Encryption-map entity IDs and fields match entity metadata.

### Integration tests

- Admin creates and updates SSO policy fields and reads them back.
- Password login receives `SSO_REQUIRED` and no auth cookie when policy is active.
- Pending MFA token cannot access a normal authenticated API.
- Pending token can prepare and verify its own challenge and becomes a staff token only after success.

Every integration test creates its own data and removes it in `finally` or teardown. Enterprise module metadata gates the files.

## Risks & Impact Review

#### Pending token accepted as staff through legacy verification
- **Scenario**: Audience isolation is bypassed by the raw-secret legacy JWT fallback.
- **Severity**: Critical
- **Affected area**: Every authenticated staff API
- **Mitigation**: Sign and verify pending tokens only through `signAudienceJwt` and `verifyAudienceJwt`, which use explicit audience options and do not enter the default legacy fallback.
- **Residual risk**: An operator who exposes the pending audience secret outside the application can forge pending tokens; normal secret-management controls still apply.

#### MFA service outage blocks enrolled users
- **Scenario**: Challenge storage, provider resolution, or the database is unavailable.
- **Severity**: High
- **Affected area**: Password login for MFA-enrolled users
- **Mitigation**: Fail closed, delete the Core session, emit structured diagnostics without token or PII values, and retain the explicit emergency bypass configuration for operator-controlled recovery.
- **Residual risk**: Availability is reduced during an outage by design.

#### SSO misconfiguration locks out an organization
- **Scenario**: An administrator enables `ssoRequired` and the IdP later becomes unavailable.
- **Severity**: High
- **Affected area**: Organization login
- **Mitigation**: Enforce only active configurations, require successful discovery before activation, retain super-admin break-glass, and allow deactivation through an authenticated break-glass session.
- **Residual risk**: Non-super-admin users cannot use password fallback while the policy remains active.

#### Weak or provider-specific assurance values
- **Scenario**: An administrator configures values that the IdP does not emit or interprets an AMR value incorrectly.
- **Severity**: Medium
- **Affected area**: OIDC login availability and assurance
- **Mitigation**: Treat values as exact, case-sensitive protocol data; request essential ACR; show plain configuration guidance; reject missing or mismatched claims before session creation.
- **Residual risk**: Meaning and strength of a particular ACR/AMR value remain an IdP and operator responsibility.

#### Encryption map seeded after code deployment
- **Scenario**: New code deploys before default maps are seeded for existing tenants.
- **Severity**: High
- **Affected area**: TOTP and OIDC client-secret storage
- **Mitigation**: Production encryption-required mode fails closed; deployment instructions seed maps before traffic and run the backfill command. Tests assert exact entity IDs.
- **Residual risk**: Non-production environments that intentionally disable encryption may still store plaintext.

#### Rolling deployment sees old pending tokens
- **Scenario**: One instance issues a staff-audience pending token while another expects the new pending audience.
- **Severity**: Low
- **Affected area**: MFA login during the ten-minute rollout window
- **Mitigation**: Fail closed and ask the user to restart login. Do not add a compatibility fallback that would reopen normal staff access.
- **Residual risk**: A small number of in-progress logins may need to restart.

## Final Compliance Report — 2026-08-21

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `packages/enterprise/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/auth/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`
- `packages/cli/AGENTS.md`
- `packages/core/src/modules/customers/AGENTS.md`
- `.ai/specs/AGENTS.md`
- `.ai/qa/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root `AGENTS.md` | Keep tenant and organization isolation | Compliant | Pending tokens are canonicalized against their live subject/session and stored scope. SSO queries filter organization and tenant. |
| enterprise `AGENTS.md` | Keep commercial behavior in Enterprise | Compliant | SSO, MFA policy, UI, and provider claims stay in `@open-mercato/enterprise`. |
| auth `AGENTS.md` | Obtain approval before token changes | Compliant | User approved the dedicated pending audience and additive assurance claims. |
| core `AGENTS.md` | Additive database migrations and snapshots | Compliant | Only defaulted JSONB columns and nullable hash column are added. |
| core/shared encryption rules | Use module encryption maps and decryption helpers | Compliant | Both secret fields use canonical maps; secret-bearing reads use helpers. |
| UI `AGENTS.md` | Use DS controls, i18n, and guarded mutations | Compliant | Existing guarded mutation host remains; touched settings use `CheckboxField`, `FormField`, and `Input`. |
| UI `AGENTS.md` | No hardcoded status colors on touched lines | Compliant | Touched success copy uses `text-status-success-text`. |
| `BACKWARD_COMPATIBILITY.md` | API and DB changes are additive | Compliant | Optional request/response fields and additive columns only. |
| QA `AGENTS.md` | Integration tests are isolated and module-local | Compliant | Tests live in Enterprise module `__integration__` directories with module metadata. |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | New arrays and writable policy field are represented in entity, validators, service, UI, and response. |
| API contracts match UI/UX section | Pass | Create and detail pages use the same fields. |
| Risks cover all write operations | Pass | Session, policy, secret, and migration risks are covered. |
| Commands defined for all mutations | N/A | Existing custom SSO settings route remains guarded through the current UI mutation host; this point does not introduce a new route. |
| Cache strategy covers all read APIs | N/A | No new cache is introduced; login policy requires current database state. |

### Non-Compliant Items

None.

### Verdict

**Fully compliant: Implemented with automated coverage; runtime integration execution remains environment-selected.**

## Changelog

### 2026-08-21

- Resolved all architectural questions after user approval.
- Split generic MIT Core session finalization into its own OSS specification.
- Added pending-audience, SSO enforcement, OIDC assurance, secret encryption, migration, UI, testing, and risk details.
- **Review**: Security passed; performance passed; cache N/A; commands N/A; risks passed; verdict approved.
- Implemented the Core/Enterprise split, `mfa_pending` audience, fail-closed MFA login, required SSO policy, OIDC `acr`/`amr` assurance, secret encryption maps, migrations, configuration UI, and isolated integration scenarios.
- **Verification**: 414 Enterprise and 26 Core tests passed; package builds, focused lint, generator, integration discovery, i18n advisory check, and `git diff --check` passed. The package typecheck reaches an unrelated existing error in `packages/shared/src/lib/ratelimit/service.ts`.
