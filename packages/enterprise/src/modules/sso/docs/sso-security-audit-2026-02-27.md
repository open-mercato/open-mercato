# SSO Module Security Audit Report

**Module:** `packages/enterprise/src/modules/sso/`
**Date:** 2026-02-27
**Branch:** `feat/sso-support`

---

## Executive Summary

The SSO module demonstrates strong security fundamentals: AES-256-GCM encrypted state cookies, PKCE enforcement, timing-safe state comparison, bcrypt-hashed SCIM tokens, and encrypted OIDC client secrets. The audit uncovered **2 High**, **3 Medium**, and **4 Low** severity findings. Both HIGH findings have been remediated in this milestone.

---

## Findings Summary

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| F1 | SCIM debug `console.log` statements dump PII to logs | **HIGH** | **FIXED** |
| F2 | Missing org ownership check in SCIM token generation | **HIGH** | **FIXED** |
| F3 | SCIM payloads lack string length constraints | MEDIUM | Open |
| F4 | SCIM logs `ssoConfigId` query param not UUID-validated | MEDIUM | Open |
| F5 | `emailVerified` defaults to `true` when claim absent | MEDIUM | Documented |
| F6 | Domain DELETE query param not format-validated | LOW | Open |
| F7 | SCIM v2 `startIndex`/`count` not zod-validated | LOW | Open |
| F8 | State cookie not enforced as single-use | LOW | Accepted |
| F9 | Host header fallback in `toAbsoluteUrl` if `APP_URL` unset | LOW | Accepted |

---

## 1. CSRF Protection -- PASS

All admin write endpoints are protected by:
- Cookie-based auth via `resolveSsoAdminContext()` with `requireAuth: true` and `requireFeatures` guards
- `SameSite: lax` on auth cookies (appropriate for SSO flows that require cross-site IdP redirects)

SCIM v2 endpoints use Bearer token authentication (inherently CSRF-safe).

**Files verified:** All routes under `api/config/`, `api/scim/tokens/`, and `api/scim/v2/`.

## 2. Replay Protection -- PASS

- **State cookie:** AES-256-GCM encrypted with HKDF-SHA256 key derivation, 12-byte random IV, 16-byte auth tag
- **TTL:** 5 minutes (checked at decryption time + cookie maxAge)
- **PKCE:** S256 with 32-byte random code verifier stored in encrypted state cookie
- **Nonce:** 16-byte random nonce validated by `openid-client` library against ID token
- **State comparison:** Timing-safe (`crypto.timingSafeEqual`) with length pre-check
- **Cleanup:** State cookie cleared after successful callback (maxAge: 0)

**F8 (LOW, Accepted):** No server-side single-use enforcement on state cookie. Mitigated by IdP's single-use authorization code policy (OAuth 2.0 spec requirement).

## 3. Tenant Isolation -- PASS (with F2 fixed)

- **Admin endpoints:** All queries scoped by `organizationId` for non-superadmins via `resolveSsoAdminContext()`
- **SCIM endpoints:** `organizationId` derived from verified bearer token, not from request parameters
- **HRD:** Intentional cross-org lookup (by design) -- only exposes `hasSso`, `configId`, `protocol`
- **F2 (FIXED):** `ScimTokenService.generateToken()` now verifies SSO config ownership before minting tokens

## 4. Token Security -- PASS (with F1 fixed)

- **OIDC client secrets:** Encrypted at rest via `TenantDataEncryptionService`; never exposed in API responses
- **SCIM tokens:** bcrypt-hashed (cost 10), prefix-indexed, timing-attack resistant (dummy hash on miss), raw value returned only once at creation
- **State cookies:** AES-256-GCM encrypted
- **F1 (FIXED):** Removed 5 `[SCIM DEBUG]` console.log statements that serialized full SCIM payloads (PII) to logs

## 5. Input Validation -- PASS (with notes)

- **Admin APIs:** All write endpoints validated with zod schemas from `data/validators.ts`
- **SCIM filter:** Strict regex parser with attribute allowlist, parameterized ORM queries
- **Domain validation:** DNS hostname regex, max 253 chars, must contain dot, max 20 per config
- **Return URL:** `sanitizeReturnUrl()` prevents open redirects (requires `/` prefix, rejects `//`, validates origin)

### Open Validation Items

- **F3 (MEDIUM):** SCIM payloads parsed via manual extraction without max-length constraints. Database column constraints provide backstop.
- **F4 (MEDIUM):** SCIM logs `ssoConfigId` param not UUID-validated (DB rejects non-UUID values).
- **F5 (MEDIUM, Documented):** `emailVerified` defaults to `true` when IdP omits the claim. Acceptable for enterprise IdPs (Entra, Google, Zitadel) which reliably send this claim. Domain allowlist provides mitigating control.

---

## Remediation Status

### Completed (This Milestone)

1. **F1** -- Removed all `[SCIM DEBUG]` console.log from `api/scim/v2/Users/route.ts` and `api/scim/v2/Users/[id]/route.ts`
2. **F2** -- Added `organizationId` filter to `ScimTokenService.generateToken()` in `services/scimTokenService.ts`
3. Removed 3 console.log statements from `lib/oidc-provider.ts` (raw ID token logging)

### Future Hardening (Priority 2)

4. **F3** -- Add `.slice(0, 255)` length constraints to SCIM mapper fields
5. **F4** -- Add `z.string().uuid()` validation to SCIM logs endpoint
6. **F5** -- Document `emailVerified` default behavior in admin guide

### Accepted Risks (Priority 3)

7. **F6-F9** -- Input validation consistency improvements and defense-in-depth

---

## Security Controls Summary

| Control | Status |
|---------|--------|
| Admin inputs validated (zod) | PASS |
| No hardcoded secrets | PASS |
| Auth on all admin endpoints | PASS |
| SCIM Bearer token auth | PASS |
| Parameterized ORM queries | PASS |
| HTTPS enforced (production) | PASS |
| CSRF protection (SameSite + encrypted state) | PASS |
| Error messages don't leak info | PASS |
| Client secrets encrypted at rest | PASS |
| SCIM tokens bcrypt-hashed | PASS |
| PKCE enforced | PASS |
| Open redirect protection | PASS |
| No PII in server logs | PASS (after F1 fix) |
| Org ownership on token generation | PASS (after F2 fix) |
