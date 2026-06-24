# Execution Plan — Integration test for `auth.users.create` tenant-scope guard

## Overview

Add the API-level integration test requested in the follow-up comment on PR #3555
(<https://github.com/open-mercato/open-mercato/pull/3555#issuecomment-4790712986>).

PR #3555 (merged) added a one-line authorization guard to `createUserCommand`
(`assertTargetTenantInScope(resolveActorTenantScope(ctx), tenantId, 'Organization not found')`)
so a tenant-scoped admin can no longer create a user inside another tenant. The PR shipped
a unit test but no integration test. This run locks the cross-tenant boundary in via an
API integration spec that exercises `POST /api/auth/users`.

### External References

- None. The driving artifact is a GitHub PR comment, not an external skill URL.

## Goal

Add `packages/core/src/modules/auth/__integration__/TC-AUTH-052-users-create-tenant-scope.spec.ts`
that verifies the create-user tenant-scope guard end-to-end via the public API.

## Scope

- One new integration spec file. No production code changes.

## Non-goals

- No change to `createUserCommand` or any production code — the guard already exists and is merged.
- No change to the existing unit test.
- No new fixtures/helpers unless strictly necessary (reuse existing integration helpers).

## Scenario (from the comment, derived from the manual run)

1. **Setup** (API fixtures):
   - `superadmin@acme.com` token (cross-tenant) + `admin@acme.com` token (non-superadmin, tenant A).
   - Org A = the admin token's own `orgId` (an org in the actor's tenant A — deterministic).
   - As superadmin: create tenant **B**; create **orgB** in tenant B.
2. **Act / Assert**:
   - admin `POST /api/auth/users` with **orgA** → **201** (same-tenant allowed).
   - admin `POST /api/auth/users` with **orgB** → **404** `{"error":"Organization not found"}`;
     assert **no** user row exists in tenant B for that email (superadmin list scoped to tenant B,
     filtered by `organizationId=orgB`).
   - superadmin `POST /api/auth/users` with **orgB** → **201** (cross-tenant allowed for superadmin).
3. **Teardown**: delete users created in T1/T3, orgB, and tenant B via `deleteGeneralEntityIfExists`.
   Self-contained, independent of seeded data.

## Risks

- Email-by-search is unreliable in the integration runner (search_tokens not synchronously
  populated). Mitigation: assert non-existence by listing users filtered by `organizationId=orgB`
  (decrypted `email` is returned in list items) rather than by `?search=<email>`.
- `admin@acme.com` must carry `auth.users.create` — confirmed (`auth` setup grants `admin: ['auth.*']`).

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Author the integration spec

- [ ] 1.1 Write TC-AUTH-052 spec covering the 3 act/assert cases + teardown

### Phase 2: Validate

- [ ] 2.1 Typecheck core package and lint the new spec
