# Pre-Implementation Analysis: Tenant-Ownership & Per-Module ACL Authorization Hardening

> Spec: [`.ai/specs/2026-06-05-tenant-ownership-and-module-acl-authorization.md`](../2026-06-05-tenant-ownership-and-module-acl-authorization.md)
> Issue: [open-mercato#2612](https://github.com/open-mercato/open-mercato/issues/2612)
> Analyst pass: 2026-06-05 — all facts verified against `develop` via code read + Explore agents.

## Executive Summary

The spec is **technically sound and largely ready**, with every cited vulnerability re-confirmed in code. **Two gaps must be closed in the spec before implementation:** (1) the generic-records ACL resolver's default `<module>.view` convention is wrong for modules that use *entity-scoped* features (`customers.people.view`, not `customers.view`) — it needs an explicit entity→feature map; (2) the user/role ownership guards must handle `tenantId = null` (platform/global) targets as superadmin-only. One **intentional, documented breaking change** exists (removing `tenantId` from the public org-lookup response) and is already justified in the spec; the Option C validator change is confirmed additive. Recommendation: **Needs spec updates first (minor) → then ready.**

## Backward Compatibility

### Violations Found
| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|-------------|
| 1 | #7 API route URLs (response fields) | `GET /api/directory/organizations/lookup` removes `tenantId` from the success response — category 7 says "MUST NOT remove fields from existing response schemas". | **Warning** (intentional security fix) | Already handled: spec treats it as a security-justified breaking change with RELEASE_NOTES entry. Keep `resolveTenantContext` accepting legacy body `tenantId` as a fail-closed cross-check during rollout so portal clients don't break mid-migration. Add `deprecated`-style note in `openApi`. |
| 2 | #7 API behavior (entities records + auth user/role) | Routes begin returning `403`/`404` where they previously returned `200`. Not a *shape* change (no field removed), but an externally-observable behavior tightening. | **Warning** (intentional) | RELEASE_NOTES entry calling out that `entities.records.*`-only callers lose access to stricter/system entities, and tenant admins lose access to foreign-tenant ids. No deprecation bridge applicable (removing an unintended bypass). |
| 3 | #3 Function signatures (`resolveTenantContext`) | Adds an `organizationId`/`orgSlug` input to an internal helper. Not in the BC frozen-function list (module-internal). | **None** (additive) | Add as optional param; keep platform-domain `tenantId` path working as fallback. |
| 4 | #10 ACL feature IDs | No feature IDs renamed/removed. The resolver *references* existing features only. | **None** | n/a — but see Gap #1 (resolver references features that may not exist for some modules). |
| 5 | #2 Type defs / `data/validators.ts` | `loginSchema` gains optional `organizationId`; `signupSchema` unchanged (already has it). Category states validators "MUST NOT remove or narrow existing schemas". | **None** (additive) | Confirmed: `loginSchema` = `{ email, password, tenantId? }` today; adding optional `organizationId` is additive. `signupSchema` already `{…, tenantId?, organizationId? }` — no change. |

### BC Section Present
Both the spec's **§ Backward Compatibility & Migration** satisfies the protocol's "Migration & Backward Compatibility" requirement. ✅ No missing BC section.

## Spec Completeness

### Missing Sections (per spec-writing checklist)
| Section | Impact | Recommendation |
|---------|--------|---------------|
| Risks & Impact Review (named, structured) | Risks are scattered in Concerns/Open Questions; checklist wants explicit failure-scenario/severity/mitigation/residual table | Add a short **Risks & Impact Review** section (can lift the risk table from this report). |
| Final Compliance Report | Spec-writing checklist gate | Add at end after implementation (placeholder now). |
| Architecture (resolver design detail) | The entity→feature mapping mechanism is under-specified (see Gap #1) | Expand § A with the explicit-map design. |

### Incomplete Sections
| Section | Gap | Recommendation |
|---------|-----|---------------|
| § A Target-module ACL resolver | `<module>.view` default is wrong for entity-scoped-feature modules | Replace with explicit map + fail-closed default (Gap #1). |
| § B Ownership guards | Silent on `tenantId = null` (platform) targets | Specify platform-target handling (Gap #2). |
| § A custom-entity detection | Says "detected as records.ts already does" — accurate, but the write handlers (POST/PUT/DELETE) each re-resolve `entityId` separately | Note that the guard must be inserted at **4 sites** (GET before `qe.query`, POST/PUT/DELETE before `de.*CustomEntityRecord`, plus the export branch in GET), not one shared chokepoint. |

## AGENTS.md Compliance

### Violations / Notes
| Rule | Location | Assessment |
|------|----------|-----------|
| Wildcard-aware matching (`hasFeature`/`hasAllFeatures`) for raw feature arrays — `.ai/lessons.md:197` | § A resolver | ✅ Spec already mandates `hasAllFeatures`. Must NOT use `includes`/`Set.has`. Reinforce in impl. |
| `findWithDecryption`/`findOneWithDecryption` for user/role reads — shared AGENTS | § B guards | ✅ Existing `grantChecks.ts` uses these; new guard must too (read target tenant via `findOneWithDecryption(..., { tenantId: null, organizationId: null })` then compare — load stays global, *decision* becomes ownership-gated). |
| `enforceTenantSelection` signature | § B, § C | ⚠️ Helper takes `ctx: { auth, container }`, not `rbacService` directly. The new guards in `grantChecks.ts` currently take `{ em, rbacService, auth, ... }`. Either build a `ctx` for `enforceTenantSelection` or compare `target.tenantId === auth.tenantId` inline using the existing `resolveActorIsSuperAdmin`. Pick one and state it. |
| i18n for any new user-facing error | § B/§ C 403/404 | New denials should reuse existing `forbidden()` / `404` bodies (internal, no new user-facing strings). Confirm no hardcoded UI strings added in portal page edits. |
| Place new lib in correct module | new `entities/lib/entityAcl.ts` | ✅ `entities/lib/` exists; new file is correct. Must stay in `core` (needs module registry), not `shared` (domain-free). |

## Risk Assessment

### High Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| Entity→feature map is naive (`<module>.view`) | Over-block (legit admin pages 403) or under-block (wrong feature gates nothing) for `customers`/`sales`/`catalog` which use entity-scoped features | **Gap #1**: explicit `entityId → { view, manage, platformOnly }` map seeded from each module's `acl.ts`; fail-closed (superadmin-only) for unmapped non-custom entities; custom/EAV entities keep `entities.records.*` + tenant scope. |
| Over-blocking legitimate generic-records UI callers | Backend pages that list non-custom entities via `/api/entities/records` could break | Inventory which `entityId`s the UI actually requests through this route before enforcing; add allow path for custom entities; ship behind tests covering a real admin flow. |

### Medium Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| `tenantId = null` platform roles/users | Guard that only checks `target.tenantId === auth.tenantId` would *deny* legit superadmin and *allow nothing* — but a non-superadmin must never mutate a null-tenant role | **Gap #2**: null-tenant target ⇒ require `isSuperAdmin`. Mirror the `roles/acl/route.ts` `$or:[{tenantId:auth},{tenantId:null}]` read pattern but gate *writes* to superadmin for null-tenant. |
| Command-layer defense-in-depth changes load context | Adding tenant criteria to `users.ts`/`roles.ts` global loads could regress superadmin selected-tenant flow (`2026-05-19`) | Keep superadmin path loading global; only non-superadmin gets tenant-scoped criteria. Explicit regression test (already in spec test plan). |
| Portal login page edit | Switching login to send `organizationId` while signup already does | Low surface; covered by Phase 4 integration test (platform-domain login+signup). |

### Low Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| AI-runner test mock shape | `ai-api-operation-runner.test.ts:363/376` mocks the org-lookup shape | Update mock when dropping `tenantId`. |
| `users/acl` blast radius already limited | It calls `assertActorCanModifySuperAdminUserTarget` AND scopes the `UserAcl` write to `auth.tenantId` | Real residual: can create an ACL row *in actor's tenant* for a foreign `userId`. Still add the ownership guard, but note impact is lower than raw IDOR. |

## Gap Analysis

### Critical Gaps (Block Implementation)
- **Gap #1 — Entity→feature mapping.** `<module>.view` is wrong for `customers` (`customers.people.view`), `sales`, `catalog`. Define an explicit `entityId → { view[], manage[], platformOnly? }` registry (seed from modules' `acl.ts`; e.g. `directory:tenant → { view:['directory.tenants.view'], platformOnly:true }`, `directory:organization → { view:['directory.organizations.view'] }`). Fail-closed (superadmin-only) for unmapped non-custom entities; custom/EAV entities keep `entities.records.*` + tenant scope. Without this the resolver either breaks legit pages or fails to gate the right feature.

### Important Gaps (Should Address)
- **Gap #2 — Platform (`tenantId = null`) targets.** Specify: non-superadmin mutating a null-tenant user/role ⇒ deny; superadmin ⇒ allow. Applies to `assertActorCanAccessUserTarget` and `assertActorCanAccessRoleTarget`.
- **Gap #3 — Four insertion points in `records.ts`.** GET (`qe.query`), POST/PUT/DELETE (`de.*CustomEntityRecord`), and the export branch each re-read `entityId`; the spec implies a single chokepoint. Enumerate all four (and decide read vs manage feature per method: GET/export → `view`; POST/PUT/DELETE → `manage`).
- **Gap #4 — Guard helper context shape.** Decide whether the new guards reuse `enforceTenantSelection({ auth, container })` or compare inline via `resolveActorIsSuperAdmin`. State it so `grantChecks.ts` stays consistent.

### Nice-to-Have Gaps
- Inventory of `entityId`s actually requested through `/api/entities/records` by the backend UI (de-risks over-blocking).
- Decide 403-vs-404 (Open Question #1) — recommend 404 cross-tenant / 403 in-tenant-out-of-org.
- Decide write feature naming (Open Question #3) — fold into the Gap #1 map (each entry names its own `manage` feature).

## Remediation Plan

### Before Implementation (Must Do)
1. Resolve **Gap #1** — add the explicit entity→feature map design to spec § A (this subsumes Open Question #3).
2. Resolve **Gap #2** — add null-tenant platform-target rule to spec § B.
3. Resolve **Gap #3 / #4** — enumerate the four `records.ts` insertion points + guard context shape.
4. Decide **403 vs 404** (Open Question #1).

### During Implementation (Add to Spec)
1. Add **Risks & Impact Review** + **Final Compliance Report** sections.
2. Add RELEASE_NOTES.md entries for the org-lookup shape change and the authorization tightening.
3. Add `loginSchema` optional `organizationId` (additive); leave `signupSchema` as-is.
4. Inventory generic-records UI callers; add a passing test for one real admin custom-entity flow alongside the `directory:tenant` denial test.

### Post-Implementation (Follow Up)
1. Execute the broader-audit mandate (§ D) and file follow-ups for any new fail-open paths.
2. Optional: fold `/tenants/lookup` name into SSR page data to remove the public id→name mapping.

## Recommendation
**Needs spec updates first (minor).** Close Gaps #1–#4 (all are spec-text refinements, not architecture changes) and add the two checklist sections. After that the spec is ready to implement; the design, helper reuse, and BC story are sound, and the Option C validator change is confirmed additive.
