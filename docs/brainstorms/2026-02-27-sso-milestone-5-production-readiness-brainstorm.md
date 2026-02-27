# SSO Milestone 5: Google Workspace + Production Readiness

**Date:** 2026-02-27
**Status:** Approved
**Branch:** `feat/sso-support`

## What We're Building

Complete the SSO module for production readiness by:
1. Validating Google Workspace as the third OIDC provider (JIT-only, no SCIM)
2. Adding i18n translations (en + pl) for all 100+ SSO UI strings
3. Running a code-level security audit (CSRF, replay, tenant isolation, token handling)
4. Writing API-level integration tests with mocked IdP responses
5. Writing admin documentation for all three IdPs (Entra ID, Zitadel, Google Workspace)

## Why This Approach

- **Google Workspace** is the most common IdP for smaller orgs. JIT-only is correct since Google doesn't support SCIM push natively.
- **i18n** is a hard requirement for production — the UI already uses `useT()` with translation keys but no locale files exist yet.
- **Security audit** is code-level only — sufficient for v1 since the architecture uses standard OIDC (PKCE, encrypted state cookies, bcrypt tokens).
- **Mocked IdP tests** are reliable in CI and cover the actual code paths (callback handling, SCIM endpoints, config CRUD). Real IdP tests are manual.
- **Docs for all 3 IdPs** — Entra guide exists, need Zitadel and Google guides.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| M4 status | Done (Zitadel + Entra validated) | Two real IdPs tested successfully |
| Google SCIM | Not supported | Google doesn't push SCIM; JIT-only |
| Test strategy | API-level with mocked IdP | Reliable in CI, covers code paths |
| Security audit | Code-level review only | Standard OIDC, no pentest needed for v1 |
| Email notifications | Deferred | Not in M5 scope |
| MFA integration | Deferred | Not in M5 scope |
| Documentation | Admin setup guides for all 3 IdPs | Include Google Workspace config instructions |

## Scope — 5 Stages

### Stage 1: Google Workspace OIDC Validation
- Test OIDC login flow with Google Workspace
- Add Google-specific setup hints in admin wizard UI
- Verify JIT provisioning works, SCIM section disabled for Google
- Write Google Workspace setup guide

### Stage 2: i18n Translations
- Create en.json and pl.json locale files with all 100+ translation keys
- Create `translations.ts` for translatable entity fields
- Run `yarn generate` to register translations
- Verify all SSO UI pages render correctly with both locales

### Stage 3: Security Audit
- CSRF protection on all write endpoints
- Replay protection (state cookie TTL, nonce validation)
- Tenant isolation (organization_id filtering, cross-tenant leaks)
- Token security (bcrypt hashing, timing-safe comparison, no plaintext storage)
- SCIM auth (bearer token validation, rate limiting considerations)
- Input validation (zod schemas on all endpoints)

### Stage 4: Integration Tests
- SSO config CRUD (create, read, update, delete, activate/deactivate)
- OIDC callback flow (mocked IdP token exchange)
- SCIM User CRUD (create, get, list, patch, delete)
- SCIM token lifecycle (create, revoke)
- HRD domain routing
- JIT/SCIM mutual exclusivity enforcement
- Error scenarios (invalid state, expired tokens, tenant mismatch)

### Stage 5: Admin Documentation
- Update existing Entra ID guide if needed
- Write Zitadel setup guide
- Write Google Workspace setup guide (GCP Console, OAuth2 credentials, callback URL)
- Write general SSO overview doc (architecture, flow diagram, troubleshooting)

## Open Questions

None — all clarified during brainstorm session.

## Next Step

Run `/workflows:plan` to create detailed implementation plan for each stage.
