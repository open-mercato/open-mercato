# Enterprise Security — MFA Admin & Enforcement Cross-Tenant Authorization

> **Status:** Implemented 2026-06-06 (branch `fix/2612-enterprise-security-mfa`, stacked on the OSS branch) — all phases landed; see Final Compliance Report + Changelog
> **Issue:** [open-mercato#2612](https://github.com/open-mercato/open-mercato/issues/2612) (comment 3 — enterprise variants)
> **Scope:** Enterprise — `security` module (`packages/enterprise/src/modules/security`)
> **Parent OSS spec:** [`.ai/specs/implemented/2026-06-05-tenant-ownership-and-module-acl-authorization.md`](../2026-06-05-tenant-ownership-and-module-acl-authorization.md)
> **Severity:** Critical — single-request cross-tenant enumeration reachable with the default-admin `security.*` grant.

## TLDR

**Key Points:**
- The enterprise `security` module contains the **easiest-to-exploit** instances of issue #2612's root cause (capability checked, target ownership/scope not). All MFA admin + enforcement routes require only `security.admin.manage` — a default-admin grant (`security/setup.ts` seeds `security.*`) — and never verify that the target user / requested scope belongs to the actor's tenant.
- Two single-request cross-tenant reads confirmed: `GET /api/security/users/mfa/compliance?tenantId=<foreign>` enumerates another tenant's users (email + MFA enrollment), and `GET /api/security/enforcement/compliance?scope=platform` counts users **across all tenants**. Plus IDOR on per-user MFA status/reset by raw `userId`.

**Scope:**
- Add target-user ownership enforcement to `MfaAdminService` user resolution (`getUserMfaStatus`, `resetUserMfa`) and the per-user routes.
- Reject/ignore caller-supplied `tenantId` (compliance) and `scope`/`scopeId` (enforcement) unless the actor is platform/superadmin or provably owns that scope — wire through `resolveSecurityUsersContext` / `resolveEnforcementContext`.
- Apply the same to enforcement policy list/create/update paths that trust caller-supplied tenant/org ids.
- Regression tests proving tenant-A security admin cannot inspect/reset tenant-B MFA, cannot request tenant-B compliance, and cannot use `scope=platform` without platform authorization.

**Concerns:**
- `security.admin.manage` is currently treated as "can administer security for **my** tenant"; this spec enforces that boundary. Platform-wide views (`scope=platform`, arbitrary `tenantId`) become superadmin-only — a deliberate behavior change for any tooling that relied on the gap.
- Coordinate release ordering with the parent OSS spec; the shared *pattern* mirrors the OSS guards but the code lives in `packages/enterprise` and ships on the enterprise cadence.

---

## Overview

The `security` module's admin surfaces (MFA status/reset/compliance, enforcement policies/compliance) authorize with `requireFeatures: ['security.admin.manage']` and build request context from `auth` — but neither the shared context builders nor the services verify that the **target user** or **requested scope** belongs to the actor. Because `security/setup.ts` grants default admins `security.*`, every ordinary tenant admin holds `security.admin.manage`. The result is the BOLA/BFLA pattern of issue #2612, here with the lowest exploitation cost in the codebase.

> **Market Reference**: Same OWASP API1 (BOLA) / API5 (BFLA) split as the parent spec. Admin security tooling is exactly where object/scope-level authorization matters most, since the operations are high-impact (MFA reset = lockout/takeover-adjacent) and the data is sensitive (user rosters, compliance posture).

## Problem Statement

All references verified against `develop` at issue-filing time.

### Shared context builders enforce nothing (confirmed)
- `api/users/_shared.ts` `resolveSecurityUsersContext` and `api/enforcement/_shared.ts` `resolveEnforcementContext` read `auth`, build `commandContext` from `auth.orgId`/`auth.tenantId`, resolve the service — and never compare those to the targets the handlers touch.

### MFA status / reset — per-user IDOR (confirmed)
- `services/MfaAdminService.ts` `findUserById` (line ~190): `em.findOne(User, { id, deletedAt: null })` — no tenant filter.
- `getUserMfaStatus(userId)` (~98) and `resetUserMfa(adminId, userId, reason)` (~46) resolve via that global lookup.
- `api/users/[id]/mfa/status/route.ts` checks only `security.admin.manage`, then `getUserMfaStatus(rawId)`.
- `api/users/[id]/mfa/reset/route.ts` calls `requireSudo(...)` — sudo re-authenticates the **actor**, not the **target's** tenancy — then resets MFA for the raw id. → read MFA state of, and lock out MFA for, any tenant's user by id.

### MFA compliance — cross-tenant enumeration (confirmed, worst)
- `api/users/mfa/compliance/route.ts`: `const tenantId = parsedQuery.data.tenantId ?? context.auth.tenantId ?? null` — caller-supplied `?tenantId=` is **preferred over** the authenticated tenant, with **no superadmin check**. `bulkComplianceCheck(tenantId)` then `findWithDecryption(User, { tenantId, deletedAt: null }, ...)` returns every user's email + enrollment + compliance for the requested tenant.

### Enforcement compliance — platform-wide leak (confirmed)
- `api/enforcement/compliance/route.ts`: accepts `scope` (default `PLATFORM`) + arbitrary `scopeId`, passes straight to `getComplianceReport`.
- `services/MfaEnforcementService.ts` `getComplianceReport` (line ~85): `resolveScopeFilters(PLATFORM)` returns `{}`, so `em.find(User, { deletedAt: null })` counts **all users in all tenants**; `scope=TENANT` + any `scopeId` counts an arbitrary tenant. Policy list/create/update (`resolveScopeFilters`/`normalizePolicyScope`) likewise trust caller-supplied tenant/org ids.

### Root cause
Identical to the parent spec: capability (`security.admin.manage`) is checked; **target-user ownership and requested-scope ownership are not**, and services resolve by raw id / caller-supplied scope under global context.

## Proposed Solution

Reuse the parent spec's two-gate principle inside the enterprise module (mirroring, not importing — enterprise may depend on core/shared but keep the guard local where it needs `MfaAdminService`/auth context).

### A. Scope-ownership guard in the shared context builders
- Add a helper (e.g. `assertActorOwnsTenantScope(ctx, requestedTenantId)` and `assertActorOwnsEnforcementScope(ctx, scope, scopeId)`) reusing `enforceTenantSelection` / `resolveIsSuperAdmin` from `@open-mercato/core/modules/auth/lib/tenantAccess`.
- Compliance route: resolve the effective tenant through `enforceTenantSelection(ctx, query.tenantId)` — non-platform actors may only pass their own tenant (or omit it); foreign `tenantId` → `403`.
- Enforcement route: `scope=PLATFORM` requires `isSuperAdmin`; `scope=TENANT`/`ORGANIZATION` validate `scopeId` ownership against the actor before calling the service. Apply the same to policy list/create/update.

### B. Target-user ownership guard
- Add a target-user check (mirror the OSS `assertActorCanAccessUserTarget`) invoked by the per-user MFA routes (status, reset) before service calls; non-platform actors may only target users in their own tenant (and allowed org scope where applicable).
- Defense-in-depth: `MfaAdminService.findUserById` should accept an actor-tenant constraint (or the service methods should take an actor context) so a foreign-tenant id resolves to "not found" even if a route forgets the guard. Keep superadmin behavior explicit.

### C. Service-level scoping
- `bulkComplianceCheck` and `getComplianceReport` should require an explicit, ownership-validated scope. The highest-impact single fix: `getComplianceReport(PLATFORM)` calls `resolveScopeFilters(PLATFORM)` which returns `{}`, so the service runs `em.find(User, { deletedAt: null })` **unfiltered across all tenants**. `PLATFORM` MUST be unreachable for non-superadmins — gate it at the route handler **before** the service call so the unfiltered query is never issued for a non-superadmin.
- **Policy CRUD scope ownership (enumerated).** All four policy methods trust caller-supplied scope today — `normalizePolicyInput` validates scope *shape* (e.g. TENANT requires `tenantId`) but never *ownership*:
  - `listPolicies(filters?)` — filters by `scope` only; returns policies for any tenant/org. Gate: non-superadmin list is constrained to the actor's own tenant/org.
  - `createPolicy(data, adminId)` — accepts any `data.tenantId`/`organizationId`. Gate: validate the target scope is owned by `adminId`'s actor (route-level `enforceTenantSelection` on `data.tenantId`; superadmin for `PLATFORM`).
  - `updatePolicy(id, data, adminId)` — re-normalizes + checks scope-conflict, no ownership. Gate: load the policy, assert the actor owns its current scope **and** the requested new scope.
  - `deletePolicy(id)` — soft-deletes by id, no scope check at all. Gate: load the policy, assert actor owns its scope before delete.
- **Ownership-check placement (Open Question #2 decision):** add an **explicit actor-context object** to the affected service methods (e.g. `{ actorTenantId, isSuperAdmin }`) rather than a bare filter param, so the service can fail closed independently of the route. This is the larger but cleaner diff and matches the parent spec's defense-in-depth posture (route guard + service guard). Route handlers still do the primary `enforceTenantSelection`/superadmin gate; the service param is the backstop. No more `em.find(User, { deletedAt: null })` driven by unvalidated input.

## Affected Surfaces

| Path | Change |
|------|--------|
| `api/users/_shared.ts` | scope/target ownership helpers in context |
| `api/users/[id]/mfa/status/route.ts` | target-user guard before status |
| `api/users/[id]/mfa/reset/route.ts` | target-user guard (in addition to sudo) |
| `api/users/mfa/compliance/route.ts` | `enforceTenantSelection` on `tenantId` |
| `api/enforcement/_shared.ts` | scope-ownership helper |
| `api/enforcement/compliance/route.ts` | platform→superadmin, scope ownership |
| `api/enforcement/[id]/...`, policy list/create/update/**delete** | scope ownership on all four CRUD methods |
| `services/MfaAdminService.ts` | actor-scoped user resolution (`findUserById` → `findOneWithDecryption` + actor-context); actor-context backstop |
| `services/MfaEnforcementService.ts` | actor-context backstop; ownership-validated scope; no unfiltered `PLATFORM` query |

## Phasing

1. **Scope/target guards** in `_shared.ts` builders + service signatures, with unit tests.
2. **Per-user MFA routes** (status/reset) + service resolution — IDOR closed.
3. **Compliance + enforcement scope** — `tenantId`/`scope`/`scopeId` ownership; platform→superadmin.
4. **Policy CRUD** scope ownership.
5. Regression suite + RELEASE_NOTES entry.

## Test Plan

Self-contained integration tests (API fixtures, teardown), per `.ai/qa/AGENTS.md`. Failure-code convention aligned with the parent spec: **`404` for cross-tenant / unknown target** (no existence disclosure), **`403` for in-tenant-out-of-allowed-org** and for unauthorized scope (`scope=platform` as non-superadmin).

- Tenant-A security admin: `GET /users/[tenantB-id]/mfa/status` → `404`; `POST /users/[tenantB-id]/mfa/reset` → `404` (even with valid sudo — sudo validates the actor, not the target).
- Tenant-A admin: `GET /users/mfa/compliance?tenantId=<tenantB>` → `403`; own-tenant compliance → `200`.
- Tenant-A admin: `GET /enforcement/compliance?scope=platform` → `403`; `scope=tenant&scopeId=<tenantB>` → `403`; own scope → `200`.
- Superadmin: platform + cross-tenant views still `200` (explicit).
- Policy `list`/`create`/`update`/`delete` for a foreign tenant/org scope → `403` (all four methods).

**Existing-test impact (verified):**
- `TC-SEC-007` (admin MFA status/reset/compliance) — the positive-path fixtures MUST place the acting admin and the target user in the **same tenant**; otherwise the new guard turns its current `200` assertions into `404`. Update the fixtures accordingly **and add the cross-tenant negative case** above to this spec rather than a new file.
- `TC-SEC-005` (enforcement cascade/compliance) — uses a **superadmin** token; safe, assertions unchanged. Keep as the explicit superadmin-still-works regression.
- `mfa-reset.route.test.ts`, `MfaEnforcementService.test.ts`, `MfaAdminService.test.ts` — unit/mocked; unaffected unless a service signature changes (it will, per § C — add an actor-context arg and update these mocks’ call sites).

## Backward Compatibility & Migration

- Authorization tightening removes an unintended cross-tenant bypass — not a deprecation case, but MUST be in the enterprise RELEASE_NOTES. Any internal tooling using `scope=platform` or arbitrary `tenantId` as a tenant admin will now require superadmin.
- No DB schema change. Coordinate merge/release ordering with the parent OSS spec (shared `tenantAccess` helpers live in core/shared and must be available to the enterprise build).

## Risks & Impact Review

| Risk | Failure scenario | Severity | Affected area | Mitigation | Residual |
|------|------------------|----------|---------------|------------|----------|
| `getComplianceReport(PLATFORM)` unfiltered query reachable | Non-superadmin enumerates all users platform-wide | High | `enforcement/compliance` + `MfaEnforcementService` | Gate `PLATFORM` to superadmin at the handler before the service call; service actor-context backstop | Low |
| Compliance prefers caller `tenantId` | Cross-tenant roster enumeration | High | `users/mfa/compliance` | `enforceTenantSelection(ctx, query.tenantId)`; foreign → 403 | Low |
| `TC-SEC-007` positive path breaks | CI red after fix if actor/target tenants differ | Medium | enterprise integration tests | Make fixtures same-tenant; add negative case in this spec | Low |
| Service signature change ripples to mocked unit tests | Compile/call-site failures | Low | `*Service.test.ts`, `mfa-reset.route.test.ts` | Update mock call sites when adding actor-context arg | Low |
| `findUserById` raw `em.findOne` | Latent bug if User fields become encrypted | Low | `MfaAdminService` | Switch to `findOneWithDecryption` with non-superadmin actor-tenant criteria (`.ai/lessons.md:551`) | Low |
| Release-order skew with parent OSS spec | Enterprise build can't resolve reused `tenantAccess` helpers | Medium | build/release | Land/publish core changes first; enterprise bumps after (note in RELEASE_NOTES) | Low |

## Open Questions

1. ~~`403` vs `404` for foreign-tenant target user ids.~~ **Resolved (2026-06-05):** align with parent spec — `404` cross-tenant/unknown target, `403` out-of-org and for unauthorized scope. Encoded in § Test Plan.
2. ~~Actor-context object vs actor-tenant filter param for the services.~~ **Resolved (2026-06-05):** explicit **actor-context object** (cleaner, fail-closed at the service layer); route handlers still do the primary gate. See § C.

_No open questions remain blocking._

## Final Compliance Report

Implemented 2026-06-06 on branch `fix/2612-enterprise-security-mfa` (stacked on the OSS branch). Gate status:
- [x] `scope=PLATFORM` and arbitrary `tenantId`/`scopeId` rejected for non-superadmins at the route handler via `assertActorOwnsEnforcementScope`; the service backstop (`assertActorOwnsScopeFilters`) guards before `em.find(User, …)`, so the unfiltered PLATFORM query is unreachable for non-superadmins.
- [x] Target-user guard `assertActorCanAccessSecurityUserTarget` on `mfa/status` + `mfa/reset`; `404` cross-tenant even with valid sudo (guard runs independently of sudo).
- [x] All four policy-CRUD methods enforce scope ownership: route-level (`create` pre-dispatch, `update`/`delete` load-then-assert via new `getPolicyById`) + `MfaEnforcementService` actor-context backstop; `listPolicies` constrains non-superadmins to their own tenant.
- [x] Services take an optional, backward-compatible actor-context backstop (`{ tenantId, isSuperAdmin }`); `MfaAdminService.findUserById` uses `findOneWithDecryption` (global load) with the actor-context tenant comparison enforcing ownership.
- [x] `TC-SEC-007` positive path is same-tenant (documented); cross-tenant negatives covered by route/service unit tests (harness provisions no 2nd tenant). `TC-SEC-005` unchanged — superadmin token, stays green.
- [x] Reused `enforceTenantSelection`/`resolveIsSuperAdmin` from `@open-mercato/core/modules/auth/lib/tenantAccess` (no hand-rolled superadmin checks).
- [x] Breaking-change entry added to `UPGRADE_NOTES.md` (`0.6.4 → 0.6.5`). Stacked on the OSS branch; merge after the parent OSS PR (#2636) or rebase onto `develop` once it lands.
- [x] `yarn workspace @open-mercato/enterprise build` + `typecheck` green (zero errors); full security suite **171 tests** green. (No `lint` script in the enterprise workspace; the TS build is the authoritative gate.)

> **Note on enum spelling:** the module uses British `EnforcementScope.ORGANISATION` (`'organisation'`) — reflected in the guards and tests.

## Changelog

- 2026-06-05 — Initial draft from issue #2612 comment 3 (all enterprise variants verified in code). Split from the parent OSS spec per spec-separation rules and the issue's own follow-up suggestion.
- 2026-06-05 — Applied pre-implementation analysis remediations (`.ai/specs/analysis/ANALYSIS-2026-06-05-security-mfa-cross-tenant-authorization.md`): enumerated the four policy-CRUD methods + the unfiltered `PLATFORM` query in § C; resolved Open Questions #1 (404/403 convention) and #2 (explicit actor-context); added the `TC-SEC-007` same-tenant + negative-test note and existing-test impact to § Test Plan; added Risks & Impact Review and Final Compliance Report sections.
- 2026-06-06 — Implemented (branch `fix/2612-enterprise-security-mfa`, stacked on the OSS branch). **Users-MFA vertical:** added `assertActorCanAccessSecurityUserTarget` + `assertActorOwnsTenantScope` to `api/users/_shared.ts`; wired target-user guards into `mfa/status` + `mfa/reset` (404 cross-tenant even with sudo) and `enforceTenantSelection` into `mfa/compliance`; `MfaAdminService.findUserById` → `findOneWithDecryption` + optional `{ tenantId, isSuperAdmin }` actor-context backstop on status/reset/compliance; actor-context threaded through the reset command. **Enforcement vertical:** added `assertActorOwnsEnforcementScope` (PLATFORM→superadmin, TENANT/ORGANISATION ownership) to `api/enforcement/_shared.ts`; wired it into compliance + list/create/update/delete (the latter two load the policy via new `getPolicyById` then assert current+new scope ownership); `MfaEnforcementService` gained an actor-context backstop on `getComplianceReport`/`listPolicies`/`createPolicy`/`updatePolicy`/`deletePolicy` with the unfiltered PLATFORM `em.find` guarded behind it; actor-context threaded through the create/update/delete commands. Added route + service unit tests; full `security` suite green (171). Enterprise build + typecheck green (zero errors). `UPGRADE_NOTES.md` updated.
