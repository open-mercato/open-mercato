---
title: "fix: SSO code review remediation"
type: fix
date: 2026-03-05
---

# SSO Code Review Remediation

## Overview

Address all findings from the SSO module code review before merging `feat/sso-support` into `main`. The review identified 1 critical, 4 high, 8 medium, and 8 low severity findings across security, type safety, testing, and conventions.

## Implementation Phases

### Phase 1: Critical + Security (Must-fix before merge)

#### P1-1. Fix `openid-client` types (C1)

- [x] Run `yarn install` and verify `openid-client` resolves in `packages/enterprise/` (already resolved)
- [x] If types are missing, check if `@types/openid-client` is needed or if Yarn workspace hoisting config needs adjustment (N/A)
- [x] Run `yarn typecheck` to confirm CI passes
- **File:** `packages/enterprise/package.json`

#### P1-2. Fix `emailVerified` strict check (H1)

- [x] Change `mergedClaims.email_verified !== false` to `mergedClaims.email_verified === true`
- **File:** `packages/enterprise/src/modules/sso/lib/oidc-provider.ts:74`

#### P1-3. Fix cookie `secure` flag default (M3)

- [x] Change `secure: process.env.NODE_ENV === 'production'` to `secure: process.env.NODE_ENV !== 'development'`
- **Files:** `api/callback/oidc/route.ts:60,68`, `api/initiate/route.ts:44`

#### P1-4. Add `organizationId` to `SsoRoleGrant` entity (M1)

- [x] Add `organizationId` column with FK constraint to `SsoRoleGrant` entity
- [x] Run `yarn db:generate` to create migration
- **File:** `packages/enterprise/src/modules/sso/data/entities.ts:216-237`

#### P1-5. Reject null `organizationId` for non-superadmin (M2)

- [x] Add guard: throw if `scope.organizationId` is null when `scope.isSuperAdmin` is false
- **File:** `services/ssoConfigService.ts:48-55`

---

### Phase 2: Type Safety + Convention Compliance

#### P2-1. Remove `as any` casts from services (~20 instances)

Strategy based on codebase patterns (see `customers/commands/activities.ts` for reference):

- [x] **`scimService.ts`** (10 casts): Replace `em.create(Entity, payload as any)` with properly typed payload objects. Use `RequiredEntityData<Entity>` or ensure field types match entity definitions exactly (use `?? null` for optional fields)
- [x] **`accountLinkingService.ts`** (8 casts): Same pattern — type payloads properly for `em.create()` and `em.find()` calls
- [x] **`ssoConfigService.ts`** (1 cast): Type the create payload
- [x] **`scimTokenService.ts`** (1 cast): Type the create payload
- [x] **`setup.ts`** (1 cast): Type the create payload
- [x] **`subscribers/user-deleted-cleanup.ts`** (1 cast): Type the `em.nativeDelete()` query clause

**Files:** All under `packages/enterprise/src/modules/sso/services/` and `setup.ts`

#### P2-2. Remove `as any` from error handlers (~8 instances)

- [x] Extract shared `handleSsoApiError(err: unknown): NextResponse` utility in `packages/enterprise/src/modules/sso/api/error-handler.ts`
- [x] Use `instanceof` checks against `SsoAdminAuthError`, `SsoConfigError`, `ScimServiceError`, `ScimTokenError` — all have `statusCode` property
- [x] If dual `instanceof` + `.name` check is needed for cross-boundary errors, use a type guard function:
  ```typescript
  function isSsoError(err: unknown): err is { message: string; statusCode: number } {
    return (
      err instanceof SsoAdminAuthError ||
      err instanceof SsoConfigError ||
      // ...etc
    )
  }
  ```
- [x] Replace duplicated `handleError()` in all 7+ route files with import from shared utility (also addresses M6)

**Files:** `api/config/route.ts`, `api/config/[id]/route.ts`, `api/config/[id]/domains/route.ts`, `api/config/[id]/activate/route.ts`, `api/config/[id]/test/route.ts`, `api/scim/tokens/route.ts`, `api/scim/tokens/[id]/route.ts`, `api/scim/v2/Users/route.ts`, `api/scim/v2/Users/[id]/route.ts`, `api/scim/logs/route.ts`

#### P2-3. Wrap backend page writes in `useGuardedMutation` (H4)

Reference pattern from `packages/core/src/modules/customers/backend/customers/people/[id]/page.tsx`:

- [x] Add `useGuardedMutation` to `config/[id]/page.tsx`:
  - `handleSave()` (PUT)
  - `handleToggleActivation()` (POST)
  - `handleTestConnection()` (POST)
  - `handleAddDomain()` (POST)
  - `handleRemoveDomain()` (DELETE)
  - `RoleMappingsTab.handleSave()` (PUT)
  - `ScimProvisioningTab.handleCreateToken()` (POST)
  - `ScimProvisioningTab.handleRevokeToken()` (DELETE)
- [x] Add `useGuardedMutation` to `config/new/page.tsx`:
  - Create config (POST)
- [x] Include `retryLastMutation` in injection context for both pages
- [x] Create `runMutationWithContext` wrapper following customers pattern

**Files:** `backend/sso/config/[id]/page.tsx`, `backend/sso/config/new/page.tsx`

---

### Phase 3: Validation Hardening

#### P3-1. Add zod schema for SCIM Users payload (M4)

- [x] Create zod schema for SCIM user POST/PATCH body in `data/validators.ts`
- [x] Validate `req.json()` in `scim/v2/Users/route.ts:14-15` before passing to service

#### P3-2. Add domain format validation to zod schema (M5)

- [x] Add `.refine()` to `allowedDomains` schema in `validators.ts:14` calling `validateDomain()` from `domains.ts`

#### P3-3. Validate `returnUrl` format in zod (L1)

- [x] Add `.refine()` to `returnUrl` validator in `validators.ts:37` for defense-in-depth (URL path check)

#### P3-4. Validate `upn` format before using as email (L2)

- [x] Add email format check before using UPN as email fallback in `oidc-provider.ts:69`

---

### Phase 4: Unit Tests (H3)

Reference pattern from `packages/enterprise/src/modules/record_locks/__tests__/` — use Jest with simple factories, mock external dependencies with `jest.fn()`.

#### P4-1. `oidc-provider.ts` tests

- [x] Create `packages/enterprise/src/modules/sso/lib/__tests__/oidc-provider.test.ts`
- [x] Test claim parsing (merging userinfo + id_token claims)
- [x] Test group extraction from different claim shapes
- [x] Test `emailVerified` logic (true, false, undefined, missing)
- [x] Test UPN fallback behavior
- [x] Test error paths (missing required claims)

#### P4-2. `scim-filter.ts` tests

- [x] Create `packages/enterprise/src/modules/sso/lib/__tests__/scim-filter.test.ts`
- [x] Test filter expression parsing (eq, co, sw, and, or)
- [x] Test Entra ID-specific quirks (case-insensitive ops)
- [x] Test invalid/malformed filter strings

#### P4-3. `scim-patch.ts` tests

- [x] Create `packages/enterprise/src/modules/sso/lib/__tests__/scim-patch.test.ts`
- [x] Test PATCH operations (add, replace, remove)
- [x] Test boolean string coercion
- [x] Test attribute allowlist enforcement
- [x] Test Entra ID quirks

#### P4-4. `state-cookie.ts` tests

- [x] Create `packages/enterprise/src/modules/sso/lib/__tests__/state-cookie.test.ts`
- [x] Test encrypt/decrypt round-trip
- [x] Test TTL enforcement (expired cookies rejected)
- [x] Test tamper detection (modified ciphertext rejected)
- [x] Test missing/malformed cookie handling

#### P4-5. `domains.ts` tests (optional)

- [x] Create `packages/enterprise/src/modules/sso/lib/__tests__/domains.test.ts`
- [x] Test `validateDomain()` with valid and invalid inputs

#### P4-6. `scim-mapper.ts` tests (optional)

- [x] Create `packages/enterprise/src/modules/sso/lib/__tests__/scim-mapper.test.ts`
- [x] Test `fromScimUserPayload()` mapping
- [x] Test `coerceBoolean` behavior

---

### Phase 5: Performance + Cleanup (Low priority)

#### P5-1. Fix N+1 in `scimService.listUsers()` (M7)

- [x] Batch-load users with `findWithDecryption` using `$in` filter instead of per-identity queries
- [x] Batch-load deactivation status similarly
- **File:** `services/scimService.ts:184-197`

#### P5-2. Run `yarn template:sync --fix` (M8)

- [x] Run `yarn template:sync --fix` to sync missing `umes-query-extensions/` files to template
- [x] Verify with `yarn template:sync` (no `--fix`) that drift is resolved

#### P5-3. Extract duplicate `coerceBoolean` (L4)

- [x] Move `coerceBoolean` from `scim-mapper.ts:89-93` and `scim-patch.ts:81-85` to a shared location (e.g., `lib/scim-utils.ts`)

#### P5-4. Add error logging to event emissions (L3)

- [x] Change `.catch(() => undefined)` to `.catch((e) => console.error('[SSO Event]', e))` across services

#### P5-5. Fix async params pattern in SCIM routes (L6)

- [x] Align `scim/v2/Users/[id]/route.ts` and `scim/tokens/[id]/route.ts` to use `Promise<{ id: string }>` pattern for Next.js 15+ compatibility

#### P5-6. Document raw `fetch` exception (L5)

- [x] Add inline comment in `config/new/page.tsx:139` explaining why raw `fetch` is used for pre-save OIDC discovery verification

#### P5-7. Mock external OIDC discovery in test (L7)

- [x] Replace `https://accounts.google.com` call in `TC-SSO-001:74` with a local mock or skip in air-gapped environments

#### P5-8. Track Activity tab stub (L8)

- [x] Ensure `SsoActivityTab` stub is tracked as M3 deliverable (comment or issue)

---

## Acceptance Criteria

### Functional Requirements

- [x] `yarn typecheck` passes with no errors (C1)
- [x] `emailVerified` is only `true` when IdP explicitly returns `email_verified: true` (H1)
- [x] Zero `as any` casts in the SSO module (H2)
- [x] All backend page writes wrapped in `useGuardedMutation` (H4)
- [x] `SsoRoleGrant` has `organizationId` column (M1)
- [x] Non-superadmin queries reject null `organizationId` (M2)
- [x] Cookies default to `secure: true` except in development (M3)
- [x] SCIM user payloads validated with zod (M4)
- [x] Domain format validated in zod schema (M5)
- [x] Single shared error handler for all SSO API routes (M6)
- [x] No N+1 queries in SCIM user listing (M7)
- [x] `yarn template:sync` passes (M8)

### Quality Gates

- [x] Unit tests for `oidc-provider.ts`, `scim-filter.ts`, `scim-patch.ts`, `state-cookie.ts`
- [x] `yarn build` succeeds
- [x] `yarn lint` passes
- [x] Existing integration tests (TC-SSO-001 through TC-SSO-006) still pass

## Dependencies

- No external dependencies. All changes are within `packages/enterprise/src/modules/sso/`
- Phase 1 (P1-4) requires running `yarn db:generate` after entity change

## Risk Analysis

| Risk | Mitigation |
|------|------------|
| `as any` removal causes new type errors | Fix types incrementally per file; run `yarn typecheck` after each |
| `useGuardedMutation` refactor breaks page UX | Test all write operations manually in the admin UI |
| `SsoRoleGrant` migration conflicts with other branches | Coordinate migration timestamp with team |
| Unit test mocking of `openid-client` is complex | Focus on pure functions (claim parsing, filter parsing) that don't need client mocking |

## References

- Review document: `review.md` (root)
- `useGuardedMutation` reference: `packages/core/src/modules/customers/backend/customers/people/[id]/page.tsx:170-200`
- Unit test reference: `packages/enterprise/src/modules/record_locks/__tests__/`
- `em.create()` typing reference: `packages/core/src/modules/customers/commands/activities.ts:166`
- Error handling reference: `packages/core/src/modules/auth/api/profile/route.ts:129`
- Template sync script: `scripts/template-sync.ts`
