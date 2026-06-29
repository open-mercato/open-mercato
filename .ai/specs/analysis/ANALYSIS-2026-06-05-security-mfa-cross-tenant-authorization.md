# Pre-Implementation Analysis: Enterprise Security — MFA Admin & Enforcement Cross-Tenant Authorization

> Spec: [`.ai/specs/enterprise/implemented/2026-06-05-security-mfa-cross-tenant-authorization.md`](../enterprise/implemented/2026-06-05-security-mfa-cross-tenant-authorization.md)
> Parent: [`.ai/specs/implemented/2026-06-05-tenant-ownership-and-module-acl-authorization.md`](../implemented/2026-06-05-tenant-ownership-and-module-acl-authorization.md)
> Issue: [open-mercato#2612](https://github.com/open-mercato/open-mercato/issues/2612) (comment 3)
> Analyst pass: 2026-06-05 — all facts verified against `develop` via code read + Explore agents.

## Executive Summary

The spec is **ready to implement with only minor additions.** Every vulnerability is re-confirmed: all MFA admin/enforcement routes are hand-written handlers guarded solely by `security.admin.manage` (a default-admin grant via `security.*`), none validate target-user or requested-scope ownership, and the services trust caller-supplied `tenantId`/`scope`/`scopeId`. The key enabling assumption is **confirmed**: the enterprise package already imports from `@open-mercato/core`/`@open-mercato/shared` (incl. `getAuthFromRequest`, `findWithDecryption`, the `User` entity), so reusing `enforceTenantSelection` / `resolveIsSuperAdmin` is viable. No `makeCrudRoute` factories are involved, so the fix is purely handler/service-level. The only real watch-item is one integration test (`TC-SEC-007`) that must be made same-tenant and extended with a negative case. Recommendation: **Ready to implement** (add the test-update note + two checklist sections to the spec).

## Backward Compatibility

### Violations Found
| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|-------------|
| 1 | #7 API behavior | Compliance/enforcement routes will reject `?tenantId=<foreign>`, `scope=platform`, and foreign `scopeId` for non-superadmins (previously `200`). No response *field* removed — behavior tightening only. | **Warning** (intentional security fix) | Enterprise RELEASE_NOTES entry: tenant admins lose platform-wide / cross-tenant views; those become superadmin-only. No deprecation bridge applicable (removing an unintended cross-tenant bypass). |
| 2 | #7 API behavior (per-user MFA) | `GET/POST /api/security/users/[id]/mfa/*` will `403`/`404` for foreign-tenant target users. | **Warning** (intentional) | Same RELEASE_NOTES entry. Align 403-vs-404 with parent spec decision. |
| 3 | #3 Function signatures (services) | If `MfaAdminService`/`MfaEnforcementService` methods gain an actor-context/scope param. These are enterprise-internal (not in BC frozen list). | **None** (additive) | Prefer adding an explicit actor-context param (recommended in spec OQ #2) or do ownership checks in the route handlers; either is additive. |

### BC Section Present
Spec's **§ Backward Compatibility & Migration** present. ✅ Notes the core/shared dependency and the need to coordinate release ordering (the reused `tenantAccess` helpers ship from core).

## Spec Completeness

### Missing Sections (per spec-writing checklist)
| Section | Impact | Recommendation |
|---------|--------|---------------|
| Risks & Impact Review (structured) | Risks implied, not tabulated | Add short table (lift from this report). |
| Final Compliance Report | Checklist gate | Add post-implementation placeholder. |
| Test-update note for `TC-SEC-007` | Existing integration test may break | Add to § Test Plan (see Risk below). |

### Incomplete Sections
| Section | Gap | Recommendation |
|---------|-----|---------------|
| § C Service-level scoping | Doesn't name the policy-CRUD methods (`listPolicies`/`createPolicy`/`updatePolicy`/`deletePolicy`) that trust caller scope | Enumerate them; all four lack ownership validation (`normalizePolicyInput` validates scope *shape*, not *ownership*). |
| § A Scope guards | Doesn't note that `resolveScopeFilters(PLATFORM)` returns `{}` ⇒ unfiltered `em.find(User, { deletedAt: null })` | Make explicit: `PLATFORM` ⇒ superadmin-only is the single highest-impact fix. |

## AGENTS.md Compliance

| Rule | Location | Assessment |
|------|----------|-----------|
| Reuse wildcard-aware `resolveIsSuperAdmin` / `enforceTenantSelection` | § A/§ B | ✅ Available from `@open-mercato/core/modules/auth/lib/tenantAccess`; enterprise already imports core. Don't hand-roll superadmin checks. |
| `findWithDecryption` for user reads | services | ✅ `bulkComplianceCheck` already uses `findWithDecryption`; `findUserById` uses raw `em.findOne` — when adding actor-tenant scoping, prefer `findOneWithDecryption` (lessons.md:551 — raw reads are a latent bug). |
| `requireSudo` semantics | reset route | ✅ Confirmed sudo validates **actor + actor tenant**, not target. Correct to keep sudo AND add a separate target-tenant guard — they're orthogonal (do not replace sudo). |
| Hand-written route + command pattern | all routes | ✅ All are hand-written (status/reset dispatch to `commandBus`/service). Fix inserts guards in `_shared.ts` context builders + handlers; no factory contract touched. |

## Risk Assessment

### High Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| `getComplianceReport(PLATFORM)` ⇒ `em.find(User,{deletedAt:null})` unfiltered | Platform-wide user count leak; highest-impact path | Gate `PLATFORM` to superadmin in the enforcement handler before service call; never reach the unfiltered query for non-superadmins. |
| Compliance route prefers caller `tenantId` over `auth.tenantId` | Single-request cross-tenant roster enumeration | Route through `enforceTenantSelection(ctx, query.tenantId)`; non-superadmin foreign tenant ⇒ `403`. |

### Medium Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| `TC-SEC-007` (admin MFA status/reset/compliance) | Test calls user MFA endpoints; if actor/target tenant differ it will start failing after the fix | Ensure fixtures put actor + target in the **same** tenant for the positive path; **add a negative test** (tenant-A admin → tenant-B user ⇒ 403/404). Spec must list this. |
| Service signature change ripples to unit tests | `MfaEnforcementService.test.ts` / `MfaAdminService.test.ts` use mock EM | Mocks won't enforce ownership; update only if method signatures change. Prefer route-level guards to minimize service churn. |
| `findUserById` raw `em.findOne` | Adding tenant scoping here is defense-in-depth | Switch to `findOneWithDecryption` with actor-tenant criteria for non-superadmins; keep global load for superadmin. |

### Low Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| `TC-SEC-005` (enforcement cascade/compliance) | Uses a **superadmin** token | Safe — superadmin retains platform/cross-tenant access; assertions unchanged. |
| `mfa-reset.route.test.ts` | Mocks `requireSudo` | Safe — unit-level; add target-tenant assertion if desired. |

## Gap Analysis

### Critical Gaps (Block Implementation)
- None. Architecture is confirmed feasible (core/shared import path verified; all handlers hand-written).

### Important Gaps (Should Address)
- **Enumerate policy-CRUD scope checks.** `listPolicies`/`createPolicy`/`updatePolicy`/`deletePolicy` all trust caller scope; spec § C should name them and require ownership validation (route-level `enforceTenantSelection` on the policy's `tenantId`/`organizationId`, superadmin for `PLATFORM`).
- **`TC-SEC-007` test plan note** (Medium risk above) — add explicitly to § Test Plan.
- **Decide actor-context vs filter-param** for service methods (spec OQ #2) — recommend explicit actor-context for consistency with parent spec.

### Nice-to-Have Gaps
- 403-vs-404 alignment with parent spec (OQ #1).
- Audit-event emission (actorId + target scope) on MFA reset / policy mutation for compliance trail.

## Remediation Plan

### Before Implementation (Must Do)
1. Add the `TC-SEC-007` same-tenant + negative-test note to § Test Plan.
2. Enumerate the four policy-CRUD methods in § C and require ownership validation.
3. Decide service-method shape (actor-context vs param) — OQ #2.

### During Implementation (Add to Spec)
1. Add **Risks & Impact Review** + **Final Compliance Report** sections.
2. Enterprise RELEASE_NOTES entry (cross-tenant/platform views now superadmin-only).
3. Switch `findUserById` to `findOneWithDecryption` with non-superadmin actor-tenant criteria.
4. Coordinate merge order with parent spec (reused `tenantAccess` helpers ship from core).

### Post-Implementation (Follow Up)
1. Negative regression tests for every fixed path (status/reset/compliance/enforcement/policy-CRUD) as listed in § Test Plan.
2. Confirm superadmin platform paths still green (TC-SEC-005 + an explicit superadmin compliance test).

## Recommendation
**Ready to implement** after three small spec additions (TC-SEC-007 test note, policy-CRUD enumeration in § C, OQ #2 decision). The risky assumptions — cross-package helper reuse and route shape — are verified positive, the fix is handler/service-level only, and the blast radius on existing tests is one integration spec plus additive negative tests.
