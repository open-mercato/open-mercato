# Tenant-Ownership & Per-Module ACL Authorization Hardening

> **Status:** Implemented 2026-06-06 (branch `fix/2612-tenant-ownership-module-acl`) — all 5 phases landed; see Final Compliance Report + Changelog
> **Issue:** [open-mercato#2612](https://github.com/open-mercato/open-mercato/issues/2612)
> **Scope:** OSS — `entities`, `directory`, `auth` modules (`packages/core`) + shared guard helpers (`packages/shared`, `packages/core/modules/auth/lib`)
> **Linked enterprise spec:** [`.ai/specs/enterprise/2026-06-05-security-mfa-cross-tenant-authorization.md`](enterprise/2026-06-05-security-mfa-cross-tenant-authorization.md)
> **Related:** [`2026-05-29-org-scope-fail-open-authorization-hardening.md`](2026-05-29-org-scope-fail-open-authorization-hardening.md), [`2026-05-19-superadmin-users-list-context-scope.md`](2026-05-19-superadmin-users-list-context-scope.md), [`2026-05-09-auth-user-display-name-exposure.md`](2026-05-09-auth-user-display-name-exposure.md)

## TLDR

**Key Points:**
- Close a class of **Broken Access Control** (OWASP A01) defects where the platform checks *"do you hold a permission"* at the route/role-grant level but never *"do you own this target object / this target module's data"* before reading or mutating it.
- One root cause, three confirmed OSS instances + a broader-audit mandate: (1) the generic entity-records API authorizes with `entities.records.*` and never derives the **target module's** ACL from a caller-controlled `entityId`; (2) the public org-slug lookup leaks internal `tenantId` (and the tenant lookup leaks tenant metadata) to unauthenticated callers; (3) auth user **and** role update/delete/ACL paths load targets under global encryption context (`{ tenantId: null, organizationId: null }`) and mutate by id with no actor-vs-target tenant comparison → cross-tenant IDOR.
- Fix once via shared, fail-closed guards every call site consumes: a **target-module ACL resolver** for generic entity access and a **target-record ownership guard** for auth user/role operations. Public lookups stop returning raw internal identifiers.

**Scope:**
- `packages/core/src/modules/entities/api/records.ts` — resolve required view/manage feature from `entityId` (module + system-entity registry, wildcard-aware) and `403` before `qe.query(...)`; applies to GET/POST/PUT/DELETE and export.
- `packages/core/src/modules/directory/api/get/organizations/lookup.ts` — drop `tenantId` from the public response (return `{ id, name, slug }`); resolve tenant server-side from the org slug/`organizationId` in the portal login/signup flow (`resolveTenantContext`) so no public consumer needs it. `.../tenants/lookup.ts` — audited, lower-risk (returns only `{ id, name }` for a caller-held id); left functionally intact, see § Public lookups.
- `packages/core/src/modules/auth` — shared `assertActorCanAccessUserTarget` + `assertActorCanAccessRoleTarget` guards wired into user create/update/delete/ACL/consents/resend-invite and role create/update/delete; commands stop loading/mutating targets under unconditional global context for non-platform actors.
- Shared helper `resolveEntityAclRequirement(entityId)` (or registry) + reuse of `enforceTenantSelection` / `hasFeature` / `hasAllFeatures`.
- Unit + integration regression tests for every fixed path and one broader-audit representative path.

**Concerns:**
- Tightens authorization for tenant admins acting on foreign-tenant ids — a deliberate, breaking-for-attackers behavior change. Must preserve superadmin selected-tenant behavior from `2026-05-19-superadmin-users-list-context-scope.md` (explicitly tested).
- The generic-records ACL resolver must not over-block legitimate custom-entity access (EAV records the caller already owns through `entities.records.*` + tenant scope). Default convention + explicit override map, fail-closed for unmapped system/global entities.
- Public-lookup contract change: the org lookup drops `tenantId`. Consumer audit (below) shows the only real consumer is the platform-domain portal login/signup flow, which currently sends client-supplied `tenantId` to `resolveTenantContext`. Fix is **server-side slug→tenant resolution** (Option C), not an opaque token — this also removes a client-trust weakness rather than obfuscating it.

---

## Overview

Open Mercato authorizes most surfaces with declarative `requireFeatures` guards in route metadata and, for grants, with role-grant privilege checks. These verify the **actor holds a capability**. They do **not** verify that the **specific target object** (a user, a role, an entity record) belongs to the actor's tenant/organization, nor that a generic entity accessor holds the **target module's** concrete permission. Where a route accepts a client-controlled identifier (`entityId`, `userId`, role id, `tenantId`) and the backing load runs under global context, the capability check becomes a skeleton key into other tenants' data.

This is the same family as `2026-05-29-org-scope-fail-open-authorization-hardening.md` (which fixed *within-tenant cross-org* fail-open guards), escalated to **cross-tenant** because these paths either bypass module ACL entirely or load targets with `{ tenantId: null, organizationId: null }`.

> **Market Reference**: This is the canonical IDOR / "function-level vs object-level authorization" split (OWASP API Security Top 10 — API1 BOLA + API5 BFLA). Mature multi-tenant frameworks resolve it with mandatory object-level checks (Rails Pundit `authorize record`, Django Guardian object permissions): the *presence of a capability* never substitutes for *ownership of the target*. We adopt that — capability stays the first gate, ownership/target-module ACL becomes a required second gate.

## Problem Statement

All line references verified against `develop` at issue-filing time.

### 1. Generic entity-records API bypasses per-module ACL (confirmed)
`packages/core/src/modules/entities/api/records.ts`:
- Metadata (lines 42–47) guards GET with `entities.records.view`, writes with `entities.records.manage` — and nothing else.
- GET reads a caller-controlled `entityId` (line 79) and passes it straight to `qe.query(entityId, qopts)` (line 208). No target-module ACL is derived from `entityId`.
- `entities/setup.ts` grants default tenant admins `entities.*`; `directory/setup.ts` keeps `directory.tenants.*` superadmin-only. The generic route therefore lets an ordinary tenant admin read `entityId=directory:tenant`.
- Tenant scoping (lines 193–195) only applies when the backing table exposes `organization_id` (`filtersObj.organization_id = { $in: organizationIds }`); the query engine likewise scopes only when `tenant_id`/`organization_id` columns exist. **Global/system tables (e.g. tenants) have neither**, so they are listed unfiltered.

**Impact:** cross-tenant enumeration of `directory:tenant` (concrete instance) and of any entity whose owning module ACL is stricter than `entities.records.view`, or any global-table entity.

### 2. Public lookups leak internal identifiers (confirmed)
- `directory/api/get/organizations/lookup.ts` — `requireAuth: false` (line 11), returns `{ id, name, slug, tenantId }` (lines 42–49) to unauthenticated callers.
- `directory/api/get/tenants/lookup.ts` — `requireAuth: false`, returns `{ id, name }` for any raw `tenantId`.

**Impact:** information disclosure that supplies the foreign `tenantId` an attacker needs to escalate #1 and #3. This is the enabling primitive, not a cosmetic leak.

### 3. Auth user + role mutation lack target-tenant ownership (confirmed)
User (`auth/api/users/route.ts` + `auth/commands/users.ts`):
- `makeCrudRoute` configured `orgField: null, tenantField: null` (route.ts 109–117) — the factory does no tenant scoping.
- update `mapInput` (route.ts 139–147) runs only `assertCanModifySuperAdminTarget` (target-is-superadmin) and `assertCanAssignRoles`. The latter validates the *roles'* tenant, runs **only when `roles` is supplied**, and never compares the *target user's* tenant to the actor's.
- `updateUserCommand.prepare` (commands/users.ts 484) loads via `findOneWithDecryption(..., { tenantId: null, organizationId: null })`, 404s only on non-existence.
- `execute` (commands/users.ts 547) updates `de.updateOrmEntity({ where: { id, deletedAt: null } })` — no tenant/org criteria. Delete follows the same route pattern.

**Repro:** Tenant A admin → `PUT /api/auth/users { id: <TenantB userId>, name|email|password }` **without `roles`** → zero tenant checks → foreign user mutated (incl. password reset / session invalidation).

Related user surfaces with the same gap: `auth/api/users/acl/route.ts` (accepts arbitrary `userId`, creates/updates ACL rows in caller tenant context), `auth/api/users/consents/route.ts` (scopes returned rows but accepts arbitrary `userId`), `auth/api/users/resend-invite/route.ts` (scopes to `auth.tenantId` but **not** `auth.orgId`).

Role CRUD (`auth/api/roles/route.ts` + `auth/commands/roles.ts`): `orgField: null, tenantField: null`; create accepts optional `tenantId` falling back to actor tenant **without** `enforceTenantSelection`; update/delete load roles globally and mutate/delete by id with no actor-vs-target tenant check. `auth.*` is a default admin grant. `auth/api/roles/acl/route.ts` is the **already-correct** comparison point (non-superadmin filtered by actor tenant) — reuse its pattern.

### Root cause (single)
Authorization is asserted at the **function/capability** level (route `requireFeatures`, role-grant privilege) but **object-level / target-module** authorization is missing before the data access. Loads run under global encryption context for non-platform actors.

## Proposed Solution

Two shared, fail-closed guards plus public-lookup minimization. Capability checks stay as the first gate; these add the mandatory second gate.

### A. Target-module ACL resolver (generic entity access)
Add `resolveEntityAclRequirement(entityId): EntityAclRequirement | null` where
```ts
type EntityAclRequirement = { view: string[]; manage: string[]; platformOnly?: boolean }
```
Location: `packages/core/src/modules/entities/lib/entityAcl.ts` (needs the module registry — `shared` stays domain-free; `entities/lib/` already exists, confirmed no `entityAcl.ts` today).

**Mapping mechanism — explicit registry, NOT a `<module>.view` convention.** The naive `<module>.view` default is wrong: several modules declare **entity-scoped** features, not a single module-level view (e.g. `customers` → `customers.people.view` / `customers.companies.view`; `sales`, `catalog` similar — verified in their `acl.ts`). The resolver therefore uses an explicit `Record<entityId, EntityAclRequirement>` seeded from each owning module's `acl.ts`, plus a fail-closed fallback:

- **Confirmed feature ids to seed** (exact strings verified): `directory:tenant → { view:['directory.tenants.view'], manage:['directory.tenants.manage'], platformOnly:true }`, `directory:organization → { view:['directory.organizations.view'], manage:['directory.organizations.manage'] }`. Auth/customers/sales/catalog entities map to their declared entity-scoped features.
- **Custom / EAV entities** (detected exactly as `records.ts` does today — a `CustomEntity` row for the id, or a `custom_entities_storage` row with that `entity_type`) are **exempt from the map**: they keep requiring `entities.records.view`/`entities.records.manage` **plus** tenant/org scope — that is their genuine owning ACL. This is the path that preserves all legitimate generic-records UI usage.
- **Fail-closed default for unmapped non-custom entities:** `resolveEntityAclRequirement` returns a `platformOnly` requirement (superadmin-only) rather than falling back to `<module>.view`. Rationale: an unmapped ORM-backed entity is, by definition, one nobody declared safe for generic access; defaulting to superadmin prevents both under-blocking (wrong/nonexistent feature gating nothing) and silent exposure. New entities that should be reachable generically must be added to the map deliberately.
- **No silent cap:** the map is the contract; adding an ORM entity to generic access requires a map entry + a test. Document the map as the source of truth in `entities/AGENTS.md`.

**Enforcement — four insertion points in `records.ts`** (each re-reads `entityId` independently; there is no single chokepoint):

| Method | Site | Required features |
|--------|------|-------------------|
| GET (list) | before `qe.query(entityId, …)` | `view` |
| GET (export branch) | same handler, export path before serialization | `view` |
| POST | before `de.createCustomEntityRecord(…)` | `manage` |
| PUT | before `de.updateCustomEntityRecord(…)` | `manage` |
| DELETE | before `de.deleteCustomEntityRecord(…)` | `manage` |

At each site: resolve the requirement; if the entity is custom/EAV, apply the existing `entities.records.*` + tenant-scope path; otherwise load the caller ACL via `rbacService.loadAcl(auth.sub, { tenantId, organizationId })` and require the resolved features with the wildcard-aware `hasAllFeatures` (`@open-mercato/shared/security/features` — never `includes`/`Set.has`, per `.ai/lessons.md:197`). `platformOnly` requires `acl.isSuperAdmin`. Missing → `403` **before** touching target data. To keep the five sites consistent, extract a single `assertEntityAclForRequest(req|auth, entityId, 'view'|'manage', { rbac, em })` helper in `entityAcl.ts` and call it from each.

- Keep tenant/org scoping as the **second** guard, never a substitute (per the related org-scope spec's principle).
- **Pre-flight inventory (impl prerequisite):** before enabling enforcement, inventory which `entityId`s the backend UI actually requests through `/api/entities/records`, so every non-custom id in real use has a map entry. Ship the inventory result in the PR description; a missing entry must surface as a failing test, not a runtime `403` for a legitimate page.

### B. Target-record ownership guard (auth users + roles)
Add to `packages/core/src/modules/auth/lib/grantChecks.ts` (co-located with existing target/grant guards, which already take `{ em, rbacService, actorUserId, tenantId, organizationId }` and use `resolveActorIsSuperAdmin` + `findOneWithDecryption`):
- `assertActorCanAccessUserTarget({ em, rbacService, actorUserId, tenantId, organizationId, targetUserId })` — superadmin bypass via `resolveActorIsSuperAdmin`; otherwise load the target user under **global** context via `findOneWithDecryption(em, User, { id: targetUserId, deletedAt: null }, {}, { tenantId: null, organizationId: null })` only to read its `tenantId`/`organizationId`, then require `targetUser.tenantId === actor tenantId` (and, when the actor is org-restricted, membership in the actor's allowed org set). 
- `assertActorCanAccessRoleTarget({ ..., targetRoleId })` — same shape for roles; mirrors the defensive filter already in `roles/acl/route.ts`.

**Platform (`tenantId = null`) targets — explicit rule.** Roles and users can have `tenantId = null` (platform/global rows; `roles/acl/route.ts` lets non-superadmins *read* null-tenant roles via `$or:[{tenantId:auth},{tenantId:null}]`). For **mutations**, a `null`-tenant target MUST require `isSuperAdmin`: a non-superadmin acting on a null-tenant user/role → deny. So the comparison is: superadmin ⇒ allow; else `target.tenantId != null && target.tenantId === actor tenantId` ⇒ allow; else deny. This is stricter than the read-path `$or` on purpose (reads may surface global roles; writes to global rows are platform-only).

**Guard-context shape (Gap #4 decision).** The new guards do **not** call `enforceTenantSelection` (which takes `{ auth, container }` and returns a tenant id for *request scoping*, a different job). They compare ownership inline using the existing `grantChecks.ts` primitives (`resolveActorIsSuperAdmin`, `findOneWithDecryption`) so signatures stay consistent with the neighbouring `assertActorCanModify*` guards. `enforceTenantSelection` continues to be used only where a request-supplied tenant must be *resolved* (roles create `tenantId`, directory routes, enterprise scope checks).

**Failure code (Open Question #1 decision):** cross-tenant *existing* target → **`404`** (avoids existence disclosure); in-tenant but out-of-allowed-org → **`403`**. A target that the guard cannot find (genuinely absent **or** soft-deleted, which MikroORM's soft-delete filter hides) is **delegated** to the caller rather than thrown — every wired call site is itself tenant-scoped (ACL/consents reads filter by `auth.tenantId`; the user/role commands re-load by id within tenant), so a missing target yields a safe empty result or the caller's own `404` there. This keeps legitimate admin flows on soft-deleted rows working (e.g. reading the cascaded-empty ACL of a just-deleted user). Surface via the existing `forbidden()` helper (403) and `CrudHttpError(404, …)` for the cross-tenant existing case. Superadmin behavior remains explicit and tested.

Wire-in:
- `users/route.ts` update + delete `mapInput`/handler: call `assertActorCanAccessUserTarget` for the target id (independent of whether `roles` is supplied).
- `users/acl/route.ts`: add the ownership guard. Note: this route already calls `assertActorCanModifySuperAdminUserTarget` and scopes the `UserAcl` write to `auth.tenantId`, so its residual risk is creating an ACL row *in the actor's tenant* for a foreign `userId` — lower impact than raw IDOR, but still close it for consistency.
- `users/consents/route.ts`: already filters returned rows by `tenantId`/`organizationId` (foreign users yield nothing) — add the same guard for a clean target-ownership 404/403 and consistency.
- `users/resend-invite/route.ts`: currently scopes by `auth.tenantId` but **not** `auth.orgId` — add the guard and enforce `auth.orgId` scope.
- `roles/route.ts` create/update/delete: route create `tenantId` through `enforceTenantSelection`; call `assertActorCanAccessRoleTarget` on update/delete (null-tenant role mutation ⇒ superadmin-only per the platform-target rule). Note current commands load roles under global context and call `assertCanModifySuperAdminRole` but **never** `enforceTenantSelection` — both must be added.
- Commands (`commands/users.ts`, `commands/roles.ts`): for non-platform actors, scope the load/update by the actor's tenant (pass tenant into `findOneWithDecryption` context and add tenant criteria to the update `where`) so the command is defense-in-depth even if a future route forgets the guard. Keep superadmin selected-tenant behavior intact and explicit (superadmin keeps the global load; only non-superadmin gets tenant-scoped criteria).

### C. Public lookup minimization (server-side slug→tenant resolution)

**Consumer audit (completed).** The org-slug lookup's `tenantId` has exactly one real consumer chain: the platform-domain customer-portal login/signup flow.

| Consumer | File | Use of `tenantId` |
|----------|------|-------------------|
| `useTenantContext` | `packages/ui/src/portal/hooks/useTenantContext.ts:52,65` | fetches lookup, stores `tenantId` in `PortalContext` |
| Portal login | `…/portal/login/page.tsx` (via `usePortalContext`) | sends `tenantId` to `POST /api/customer_accounts/login` |
| Portal signup | `…/portal/signup/page.tsx` | sends `tenantId` (+ `organizationId`) to `POST /api/customer_accounts/signup` |
| TC-DIR-007 | `directory/__integration__/TC-DIR-007.spec.ts:50-60` | asserts `tenantId` present (must be updated) |
| AI runner test | `ai-assistant/.../ai-api-operation-runner.test.ts:363,376` | mocks the endpoint shape |

Both auth routes pass the body `tenantId` to `resolveTenantContext(req, bodyTenantId)` (`customer_accounts/lib/resolveTenantContext.ts`). That helper already resolves tenant **server-side from the hostname** for custom-domain hosts (`resolveByHostname`, treating any body `tenantId` only as a fail-closed cross-check). It requires the client-supplied `tenantId` **only** on the shared platform domain (`:56-60`), where the URL `[orgSlug]` (and the org's own public `id`) is the real distinguisher.

**Decision — Option C (server-side resolution), not an opaque token.** Eliminate the *need* to expose any tenant-scoping value publicly instead of obfuscating it:

1. `resolveTenantContext` platform-domain branch: accept an `organizationId` (or `orgSlug`) and resolve the canonical `tenantId` server-side (org → tenant). Keep the existing mismatch-fail-closed behavior if a legacy `tenantId` is still supplied, so the change is backward-compatible during rollout. This mirrors the custom-domain branch and **removes the current client-trust of `tenantId`** on platform domains (today the server accepts whatever `tenantId` the client sends).
2. `useTenantContext` + portal login/signup pages: send `organizationId` (already available as `organization.id` / `tenant.organizationId`); stop reading/sending `tenantId`. `organizationId` and `slug` are inherently public — they name the org the user is explicitly signing in to — so they are not a leak.
3. `organizations/lookup.ts`: return `{ id, name, slug }` only. Update `TC-DIR-007.spec.ts` to assert `tenantId` is **absent**, and update the AI-runner test mock shape.
4. `tenants/lookup.ts`: lower-risk and left functionally intact — its callers (global login `auth/frontend/login.tsx:203`, onboarding `PreparingPageClient.tsx:30`) already **hold** the `tenantId` (cookie/query) and only read `name` for display. Documented as accepted residual; optional follow-up is to fold the name into SSR page data to remove the public id→name mapping entirely.

**Why C over an opaque token:** a token still leaves the slug→tenant binding publicly enumerable, adds signing/TTL infrastructure, and changes the same surfaces — for strictly less architectural gain. Option C is the smaller, more correct change. Note this is **defense-in-depth, not the load-bearing fix**: once A (entity-records ACL) and B (user/role ownership) land, a known `tenantId` grants no access — that is the actual security boundary. C reduces attack surface and removes a client-trust weakness.

### D. Broader audit (mandate, not just named paths)
Grep and triage every server path that accepts/derives `tenantId`/`organizationId`/`userId`/role id from client input and loads/mutates under global context. Seed list: `auth/commands/users.ts` + `roles.ts` global `findOneWithDecryption(..., { tenantId: null, organizationId: null })`; `directory/api/organizations/route.ts` caller-supplied `tenantId`; command families persisting `parsed.tenantId`/`parsed.organizationId`. Enterprise security variants are tracked in the linked enterprise spec.

#### Broader audit findings (Phase 5)

Audit method: grepped `packages/core/src` (and `packages/shared/src` helpers) for `{ tenantId: null, organizationId: null }` global-context loads, `searchParams.get('tenantId'|'organizationId'|'userId')`, body/param schemas persisting `parsed.tenantId`/`parsed.organizationId`, and the `enforceTenantSelection`/`enforceTenantScope`/`ensureTenantScope` positive baseline. **Conclusion: after Phases 1–4, no additional unfixed core path is vulnerable to cross-tenant access via client-supplied scope.** Every client-controlled tenant/org/user input is either pinned to the authenticated scope, routed through a fail-closed guard, or (for superadmin) explicitly gated on `isSuperAdmin`.

Triage table:

| File:line | Accepts | Source | Loads/mutates under | Verdict |
|-----------|---------|--------|---------------------|---------|
| `auth/commands/users.ts:501` (update prepare) | `id` | body | global load **then** `assertTargetTenantInScope(resolveActorTenantScope(ctx), existing.tenantId)` | **safe** — Phase 3 defense-in-depth; superadmin keeps global, non-superadmin 404s on tenant mismatch (DONE) |
| `auth/commands/users.ts:747/768` (delete) | `id` | body | tenant-scoped via `resolveActorTenantScope` | **safe** — Phase 3 (DONE) |
| `auth/commands/roles.ts:284/451/469` (update/delete) | `id`/`tenantId` | body | `assertRoleTenantInScope(resolveActorTenantScope(ctx), …)` | **safe** — Phase 3 (DONE) |
| `auth/api/roles/route.ts:93` (create) | `tenantId` | body | `enforceTenantSelection({ auth, container }, requestedTenantId)` before persist | **safe** — Phase 3 (DONE) |
| `directory/api/organizations/route.ts:137,152` (GET) | `tenantId` | query | `enforceTenantScope(authTenantId, requested, isSuperAdmin)` → foreign request returns `null` → "Tenant scope required" (no listing); superadmin gated explicitly | **safe** — spec-named representative is already correct; **pinned by new regression test** |
| `directory/api/organization-switcher/route.ts:105` | `tenantId` | query | non-superadmin forced to `tenantId = actorTenantId` (line 127); requested value honored only for superadmin | **safe** |
| `directory/api/get/tenants/lookup.ts:21` | `tenantId` | query | returns only `{ id, name }` for a caller-held id | **safe (accepted residual)** — documented in § Public lookups (Phase 4) |
| `dashboards/api/users/widgets/route.ts:46-47,114` (GET/PUT) | `tenantId`/`organizationId`/`userId` | query/body | non-superadmin scope pinned via `resolveWidgetAssignmentReadScope` (GET) / `auth.tenantId` (PUT); target user verified to belong to scope tenant (404 otherwise) | **safe** |
| `dashboards/api/roles/widgets/route.ts:63-64` | `tenantId`/`organizationId` | query | same scope-resolution pattern as user widgets | **safe** |
| `audit_logs/api/audit-logs/{actions,access,actions/export}/route.ts` | `organizationId` | query | tenant always pinned to `auth.tenantId`; `queryOrgId` accepted only if in `scope.allowedIds` | **safe** |
| `customer_accounts/api/admin/domain-mappings.ts:72,135` (GET/POST) | `organizationId` | query/body | tenant pinned to `auth.tenantId`; persists `tenantId: auth.tenantId` (never from body) | **safe** (within-tenant org filter only; cross-tenant impossible) |
| `workflows/api/events/route.ts:74` | `userId` | query | `tenantId = auth.tenantId`; `userId` is a filter inside the tenant-scoped `where` | **safe** |
| `customers/api/labels/route.ts:58`, `customers/api/dictionaries/{kind-settings,[kind]}/route.ts` | `organizationId` | query | tenant pinned to `auth.tenantId`; org resolved via `resolveOrganizationScopeForRequest` (membership-checked) | **safe** |
| `catalog/commands/{offers,categories,prices,…}.ts` | `tenantId`/`organizationId` | body | `ensureTenantScope(ctx, …)` + `ensureOrganizationScope(ctx, …)` (fail-closed `403` on mismatch) before persist | **safe** |
| `auth/api/admin/nav.ts:107` | `tenantId` | query | routed through `resolveFeatureCheckContext` → `resolveOrganizationScopeForRequest` (scope-enforced) | **safe** |
| `staff`/`resources`/`planner` commands global `findOneWithDecryption(..., { tenantId: null, organizationId: null })` | id | body | guarded by their own `ensureTenantScope`/`ensureOrganizationScope` (Pattern C) before mutation | **safe** for this OSS spec (these are enterprise-adjacent modules; deeper review tracked in the enterprise spec, see below) |

Representative fix: none required in core — the spec-named representative (`directory/api/organizations/route.ts`) was already fail-closed. Per the Phase-5 directive, the existing-correct behavior is **pinned** with a regression test (`directory/api/organizations/__tests__/tenant-scope-guard.test.ts`): foreign `tenantId` → denied (`400`, no `em.find`); own `tenantId` → listed; superadmin foreign `tenantId` → listed.

Out-of-scope follow-ups (documented, no GitHub issues filed):
- **Enterprise security paths** — the cross-tenant MFA / authorization variants live in `.ai/specs/enterprise/2026-06-05-security-mfa-cross-tenant-authorization.md` (linked enterprise spec). Not fixed here; OSS spec stays OSS-only.
- **`tenants/lookup.ts` public id→name mapping** — accepted residual (Phase 4); optional follow-up is folding the tenant name into SSR page data so no public id→name endpoint is needed. Rationale: callers already hold the `tenantId`; once Phases 2/3 made `tenantId` non-load-bearing this is information-minimization, not an access boundary.
- **Magic-link / password-reset UI legacy `tenantId` path** — per Phase 4 notes, `resolveTenantContext` keeps the legacy body `tenantId` as a fail-closed cross-check during rollout; the portal client migration to `organizationId` is additive. Rationale: backward-compatible rollout, not a new vulnerability.
- **`staff`/`resources`/`planner` command global loads** — these modules load by id under global context then apply `ensureTenantScope`/`ensureOrganizationScope`; safe for the cross-tenant boundary this spec targets, but their broader object-level coverage belongs with the enterprise security review rather than this OSS pass.

## Affected Surfaces

| # | Path | Change |
|---|------|--------|
| 1 | `entities/api/records.ts` (GET/POST/PUT/DELETE/export) | target-module ACL gate before query/mutate |
| 2 | `directory/api/get/organizations/lookup.ts` | return `{ id, name, slug }` (drop `tenantId`) |
| 2b | `customer_accounts/lib/resolveTenantContext.ts` | platform branch resolves tenant from `organizationId`/slug server-side |
| 2c | `ui/src/portal/hooks/useTenantContext.ts` + portal login/signup pages | send `organizationId`, stop reading/sending `tenantId` |
| 3 | `directory/api/get/tenants/lookup.ts` | audited; left intact (accepted residual) |
| 4 | `auth/api/users/route.ts` (PUT/DELETE) | target-user ownership guard |
| 5 | `auth/api/users/acl/route.ts` | target-user ownership guard |
| 6 | `auth/api/users/consents/route.ts` | target-user ownership guard |
| 7 | `auth/api/users/resend-invite/route.ts` | target-user guard + `auth.orgId` scope |
| 8 | `auth/api/roles/route.ts` (POST/PUT/DELETE) | `enforceTenantSelection` + target-role guard |
| 9 | `auth/commands/users.ts`, `auth/commands/roles.ts` | tenant-scoped load/update for non-platform actors |
| 10 | new `entities/lib/entityAcl.ts`, `auth/lib/grantChecks.ts` additions | shared guards |

## Phasing

1. **Shared guards** — `resolveEntityAclRequirement`, `assertActorCanAccessUserTarget`, `assertActorCanAccessRoleTarget`, with unit tests (tenant match/mismatch, superadmin bypass, wildcard ACL, platform-only, unmapped entity fail-closed).
2. **Generic entity records** — wire #1; regression tests for `directory:tenant` denial + one stricter-than-`entities.records.view` entity + a legitimate custom-entity allow.
3. **Auth users + roles** — wire #4–#9; regression matrix below.
4. **Public lookups** — server-side slug→tenant resolution in `resolveTenantContext` (backward-compatible), switch portal pages to send `organizationId`, drop `tenantId` from the org lookup, update `TC-DIR-007` + AI-runner mock. Land after Phase 2/3 so `tenantId` is already non-load-bearing.
5. **Broader audit** — execute #D, document findings inline, fix or file follow-ups; add ≥1 representative regression.

## Test Plan

Integration coverage is required per `.ai/qa/AGENTS.md`; tests must be self-contained (API fixtures, teardown cleanup, no seeded-data reliance).

- **Entities:** tenant admin (no `directory.tenants.view`, non-superadmin) → `403` for `entityId=directory:tenant` (read/write/delete/export — all five sites). User with `entities.records.view` but lacking the mapped target feature (e.g. `customers.people.view` for `customers:person`) → `403`. Unmapped non-custom entity → `403` for non-superadmin (fail-closed default). Legitimate custom-entity owner still `200`. Wildcard-granted caller (`directory.*`) → `200` for `directory:tenant` only if also superadmin (platformOnly) — otherwise the wildcard satisfies non-platform mapped entities. Superadmin → allowed everywhere.
- **Directory:** public org-slug lookup returns `{ id, name, slug }` **without** `tenantId`. Platform-domain portal login **and** signup succeed end-to-end sending `organizationId` (no `tenantId`); `resolveTenantContext` resolves the canonical tenant server-side and rejects a mismatched legacy `tenantId`. Custom-domain login/signup unaffected.
- **Auth users:** Tenant A admin cannot `PUT`/`DELETE`/change roles/change password/edit ACL/edit consents/resend-invite for a Tenant B `userId` (each → `403`/`404`). Same-tenant action still works. Superadmin selected-tenant path (`2026-05-19`) still works — explicit test.
- **Auth roles:** Tenant A admin cannot create-in / move-to / update / delete a Tenant B role by id.
- **Broader audit:** ≥1 representative path (e.g. `directory/api/organizations/route.ts` caller-supplied `tenantId`) proven fail-closed.

## Backward Compatibility & Migration

- **Contract surfaces touched:** the org-lookup response shape (removing `tenantId`) and tightened authorization on entity-records + auth user/role routes. Per `BACKWARD_COMPATIBILITY.md`, the org-lookup response change is the only externally-observable shape change; treated as a **security-justified breaking change** documented in `UPGRADE_NOTES.md` (`0.6.4 → 0.6.5`). The `resolveTenantContext` change keeps the legacy body `tenantId` as a fail-closed cross-check during rollout, so platform-domain portal clients are not broken mid-migration; the only client-side migration is sending `organizationId` instead of `tenantId`.
- Authorization tightening is not a deprecation-protocol case (removing an unintended bypass), but is called out in `UPGRADE_NOTES.md` because integrators relying on the bypass (e.g. tenant admins reading `directory:tenant`) will now receive `403`.
- No DB schema change. ACL feature additions (if the entity override map references new features) follow the `acl.ts` → `setup.ts defaultRoleFeatures` → `yarn mercato auth sync-role-acls` flow.

## Risks & Impact Review

| Risk | Failure scenario | Severity | Affected area | Mitigation | Residual |
|------|------------------|----------|---------------|------------|----------|
| Entity→feature map omits an in-use entity | A backend page that lists an unmapped non-custom entity through `/api/entities/records` starts returning `403` | Medium | `entities/api/records.ts` + admin UI | Pre-flight inventory of `entityId`s the UI requests; missing entry fails a test, not production; custom/EAV path is map-exempt and covers the bulk of usage | Low — a newly added ORM entity needs a deliberate map entry (by design) |
| Over-tightening user/role guards regresses superadmin selected-tenant flow (`2026-05-19`) | Superadmin can no longer act across tenants | Medium | `commands/users.ts`, `commands/roles.ts` | Superadmin keeps global load; only non-superadmin gets tenant criteria; explicit regression test | Low |
| Platform (`tenantId = null`) handling wrong | Either non-superadmin mutates a global role/user, or superadmin is blocked | High (if wrong) | § B guards | Explicit rule: null-tenant mutation ⇒ superadmin-only; covered by tests | Low |
| Org-lookup shape change breaks a portal client mid-rollout | Platform-domain login/signup fails | Medium | `resolveTenantContext`, portal pages | Keep legacy body `tenantId` as fail-closed cross-check during rollout; client migration is additive (`organizationId`) | Low |
| Wildcard ACL mis-evaluated by hand-rolled matching | A user with `directory.*` is wrongly denied `directory:tenant` | Medium | resolver enforcement | MUST use `hasAllFeatures` (`.ai/lessons.md:197`); test a wildcard-granted caller | Low |
| Cross-tenant 404 hides legitimate not-found vs forbidden | Harder debugging for in-tenant cases | Low | guard error mapping | 404 only for cross-tenant; 403 for in-tenant-out-of-org | Low |

## Open Questions

1. ~~**403 vs 404** for foreign-tenant target ids.~~ **Resolved (2026-06-05):** `404` for cross-tenant/unknown (no existence disclosure); `403` for in-tenant-out-of-allowed-org. Encoded in § B.
2. ~~**Org-slug lookup** — omit `tenantId` entirely, or introduce a signed opaque portal-bootstrap token?~~ **Resolved (2026-06-05):** consumer audit complete — Option C (server-side slug→tenant resolution in `resolveTenantContext`, drop `tenantId` from the lookup, portal sends `organizationId`). See § Public lookup minimization. Sub-decision resolved: `resolveTenantContext` accepts `organizationId` (already in hand, avoids a second slug lookup).
3. ~~**Default write feature** for the entity ACL resolver.~~ **Resolved (2026-06-05):** no naive `<module>.manage` default — each entity's `manage` feature is named explicitly in the `resolveEntityAclRequirement` map; unmapped non-custom entities are `platformOnly` (superadmin). See § A.

_No open questions remain blocking; all three are resolved._

## Final Compliance Report

Implemented 2026-06-06 on branch `fix/2612-tenant-ownership-module-acl`. Gate status:
- [x] `resolveEntityAclRequirement` map (`entities/lib/entityAcl.ts`) covers the directory/customers/catalog/sales/auth ORM entities reachable through `/api/entities/records`; custom/EAV entities are map-exempt and unmapped ORM entities are fail-closed (super-admin only). _Note: `auth` uses `.list`/`.edit`/`.manage` (no `.view`) — mapped to the real ids._
- [x] All five `records.ts` sites enforce via the shared `assertEntityAclForRequest` helper using wildcard-aware `hasAllFeatures` (no `includes`/`Set.has`); the four write/catch blocks now surface `CrudHttpError` (previously collapsed to 500).
- [x] `assertActorCanAccessUserTarget` / `assertActorCanAccessRoleTarget` wired into `users/route.ts` (update+delete), `users/acl`, `users/consents`, `users/resend-invite`, and `roles/route.ts` (update+delete; create via `enforceTenantSelection`); null-tenant mutation is superadmin-only.
- [x] Commands (`commands/users.ts`, `commands/roles.ts`) fail-closed for non-superadmin even without the route guard (defense-in-depth test `tenant-ownership-defense.test.ts`); superadmin/`systemActor` keep global access.
- [x] Org lookup returns `{ id, name, slug }`; `TC-DIR-007` updated; AI-runner mock already matched; platform-domain login **and** signup send `organizationId` (legacy `tenantId` still accepted with fail-closed cross-check).
- [x] Superadmin selected-tenant flow (`2026-05-19`) preserved and covered (full auth suite green, 371 tests).
- [x] Breaking-change entry added to `UPGRADE_NOTES.md` (`0.6.4 → 0.6.5` section) — org-lookup shape + entity-records ACL + auth ownership. (Repo uses `UPGRADE_NOTES.md` + `CHANGELOG.md`, not `RELEASE_NOTES.md`; CHANGELOG entry left to `om-auto-update-changelog` at PR time.)
- [x] `yarn typecheck` (only 3 pre-existing, unrelated `staff_time_project` errors; zero new), `yarn build` (core + ui green), `yarn test` (68 new tests + full auth/customer_accounts/directory suites green). `yarn lint` not run directly due to a pre-existing `eslint-plugin-react` version-detection issue when eslint is invoked outside the workspace build; the workspace TS build is the authoritative compile gate and is green.

## Changelog

- 2026-06-05 — Initial draft from issue #2612 (core paths verified in code). Enterprise security variants split to the linked enterprise spec.
- 2026-06-05 — Resolved Open Question #2 after a portal-consumer audit: chose Option C (server-side slug→tenant resolution in `resolveTenantContext`, drop `tenantId` from the org lookup, portal sends `organizationId`) over an opaque token. Updated TLDR, § Public lookup minimization, affected surfaces, phasing, and backward-compat accordingly.
- 2026-06-06 — Implemented Phase 1 (shared guards): added `entities/lib/entityAcl.ts` (`resolveEntityAclRequirement` explicit map + `assertEntityAclForRequest`, wildcard-aware) and `assertActorCanAccessUserTarget` / `assertActorCanAccessRoleTarget` in `auth/lib/grantChecks.ts`, with 24 unit tests. Map keyed on canonical entity ids (`customers:customer_person_profile`, `auth:user`, …); `auth` mapped to its real `.list`/`.edit`/`.manage` features (no `.view`).
- 2026-06-06 — Implemented Phase 2 (generic entity records): wired `assertEntityAclForRequest` into all five `records.ts` sites (GET list, GET export, POST, PUT, DELETE) with per-handler custom-entity detection; fixed all four catch blocks to surface `CrudHttpError` instead of 500. 9 regression tests (`records.acl.test.ts`).
- 2026-06-06 — Implemented Phase 4 (public lookups): `resolveTenantContext` platform branch now resolves the canonical tenant server-side from `organizationId` (legacy `tenantId` accepted with fail-closed cross-check); `loginSchema` gained optional `organizationId`; login/signup forward it; org lookup + its zod schema dropped `tenantId`; portal login/signup pages and `useTenantContext` send/expose `organizationId`; `TC-DIR-007` asserts `tenantId` absent. 11 `resolveTenantContext` tests + customer_accounts/directory suites green. magic-link/password-reset left on the backward-compatible legacy `tenantId` path.
- 2026-06-06 — Implemented Phase 3 (auth users + roles ownership wire-in): wired `assertActorCanAccessUserTarget` into `users/route.ts` (update + delete), `users/acl/route.ts` (GET + PUT), `users/consents/route.ts` (GET), and `users/resend-invite/route.ts` (POST); wired `assertActorCanAccessRoleTarget` into `roles/route.ts` (update + delete) and routed role create `tenantId` through `enforceTenantSelection`. Added command defense-in-depth: non-superadmin actors now get tenant-scoped target loads (post-load 404 comparison) and tenant-scoped update/delete `where` criteria in `commands/users.ts` and `commands/roles.ts`, preserving superadmin selected-tenant and `systemActor` global access. Added route regression matrix (`api/__tests__/tenant-ownership-guards.route.test.ts`) and command defense tests (`commands/__tests__/tenant-ownership-defense.test.ts`); updated `resend-invite` + `users.route` tests for the new guard read. All 371 auth tests green; core build green; zero new typecheck errors.
- 2026-06-06 — Completed Phase 5 (broader audit). Grepped every core server path that accepts/derives `tenantId`/`organizationId`/`userId`/role id from client input and triaged it against the global-context-load / missing-ownership criteria (table added to § D "Broader audit findings"). Result: after Phases 1–4 no additional core path is cross-tenant-vulnerable — the spec-named representative `directory/api/organizations/route.ts` was already fail-closed via `enforceTenantScope` (foreign `tenantId` → "Tenant scope required", superadmin gated explicitly). Pinned that guarantee with a new regression test `directory/api/organizations/__tests__/tenant-scope-guard.test.ts` (foreign tenant denied + never queries; own tenant listed; superadmin foreign tenant listed). Documented out-of-scope follow-ups (enterprise security spec, `tenants/lookup.ts` residual, magic-link/reset legacy `tenantId`, staff/resources/planner global loads). No code fix needed; core build green, zero new typecheck errors, directory tests (66) + new test (3) green.
- 2026-06-05 — Applied pre-implementation analysis remediations (`.ai/specs/analysis/ANALYSIS-2026-06-05-tenant-ownership-and-module-acl-authorization.md`): replaced the naive `<module>.view` resolver default with an explicit fail-closed entity→feature map + custom-entity exemption (Gap #1); added the platform (`tenantId = null`) superadmin-only mutation rule and the inline guard-context decision (Gap #2/#4); enumerated the five `records.ts` enforcement sites (Gap #3); resolved Open Questions #1 (404 cross-tenant / 403 out-of-org) and #3; added Risks & Impact Review and Final Compliance Report sections.
