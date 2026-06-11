# Fix: login 500 — `getUserRoles` NPE on orphaned/soft-deleted role links

## Goal

Stop `POST /api/auth/login` from returning HTTP 500 after a successful password
verification when the authenticating user has a `UserRole` whose populated `role`
is `null` (orphaned link to a soft-deleted/re-seeded role). Make staff role
resolution resilient, mirroring the existing defensive pattern already used in
session-integrity validation.

## Reproduction (live demo, v0.6.5)

`POST https://demo.openmercato.com/api/auth/login` for a freshly onboarded tenant:

- wrong password → `401`
- nonexistent email → `401`
- **correct credentials → `500` (empty body)** — an uncaught throw re-raised to
  Next.js (API 500 stacks are redacted by #2950), reproducible for both
  `application/x-www-form-urlencoded` and `multipart/form-data` and with
  `remember` on/off.

The `401` on a wrong password proves the user is found and the password is
checked, so the throw is in the **post-verification** chain
(`packages/core/src/modules/auth/api/login.ts:136-219`):
`updateLastLoginAt → getUserRoles → createSession → signJwt → after-interceptors`.

## Root cause

`AuthService.getUserRoles` (`packages/core/src/modules/auth/services/authService.ts:63`)
ends with:

```ts
return links.map((l) => l.role.name)
```

The query populates `role` and filters `role: { tenantId, deletedAt: null }`, but a
populated `role` can still come back `null` when a `UserRole` references a role row
that is soft-deleted (the Role soft-delete filter suppresses hydration). This is a
known shape in this codebase: the parallel staff-session validator
`resolveCanonicalStaffAuthContext`
(`packages/core/src/modules/auth/lib/sessionIntegrity.ts:131-133`) already guards it:

```ts
const linkedRoles = links.map((link) => link.role).filter((role): role is Role => !!role)
```

`getUserRoles` has no such guard, so `l.role.name` throws `TypeError: Cannot read
properties of null (reading 'name')` → uncaught → HTTP 500.

A freshly created tenant is the trigger: recent onboarding work
(`recover interrupted provisioning`, re-seed unique-collision handling) can leave an
admin `UserRole` pointing at a role that a later re-seed soft-deleted, producing the
orphaned link.

`getUserRoles` is on the hot path for login (×2), `refreshFromSessionToken`, the
profile route, and SSO — so the NPE also breaks session refresh, not just login.

Note: PR #2883 (the user's initial suspect) is a red herring — it only gates
**authenticated** requests; `/api/auth/login` is `requireAuth: false` and never
reaches that code.

## Scope

- In scope: harden `getUserRoles` to drop links whose `role` is null and whose name
  is not a non-empty string (mirrors `sessionIntegrity`). Add unit coverage.
- Non-goals: changing the query/join semantics; the `updateLastLoginAt`
  managed-entity re-encrypt side-effect (separate, defensive path — noted for
  follow-up); cleaning up the orphaned data rows; touching `#2883`.

## Risks

- Filtering null roles can only ever remove a crash; a valid grant always has a
  non-null populated `role`, so no real role is dropped. Low risk.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Fix + tests

- [x] 1.1 Harden `AuthService.getUserRoles` to filter null roles / non-string names — ce62ade5b
- [x] 1.2 Add unit test reproducing the null-role NPE and asserting it is filtered — ce62ade5b
