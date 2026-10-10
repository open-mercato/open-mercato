# Per-Tenant Module Availability in the Feature Policy

Status: Implemented (feature-guard enforcement); follow-ups listed under "Not covered"

## TLDR

A multi-tenant deployment enables modules once, in `modules.ts`, for every tenant. SaaS apps often need to vary that per tenant: a module belongs to some subscription plans but not others, or it only applies to some kinds of tenant. This spec adds an optional, DI-registered **tenant module availability provider**. When an app registers one, the features of a module the provider marks unavailable for a tenant are denied in that tenant, including to super admins and to `*` / `module.*` grants, across pages, API routes and pages owned by the module, navigation, the feature-check endpoints and the realm RBAC services, audit-log undo and redo.

This is **feature-guard enforcement, not data isolation and not an entitlement boundary**. The module's subscribers, workers, schedules and webhooks keep running, its data stays readable through the consumers listed under "Not covered", and routes that declare no `requireFeatures` stay reachable. Without a provider nothing changes.

Delivered as a stack: (1) kernel, realm services, route and page guards, navigation; (2) audit-log replay; (3) AI tool and agent gating.

## Problem Statement

- There is no way to make a module available to one tenant and not another.
- Rewriting role grants per tenant does not achieve it: ACL commands are not undoable, a per-user ACL replaces role grants, `*` and `module.*` grants match every feature, and super admins bypass grants.
- Disabling the module in `modules.ts` removes it for every tenant.

## Proposed Solution

### Contract (`@open-mercato/shared/security/tenantModuleAvailability`)

```ts
export const TENANT_MODULE_AVAILABILITY_PROVIDER_DI_KEY = 'tenantModuleAvailabilityProvider'
export const TENANT_MODULE_AVAILABILITY_DI_KEY = 'tenantModuleAvailability'

export type TenantModuleAvailabilityProvider = {
  readonly governedModuleIds: readonly string[]
  getUnavailableModuleIds(context: { tenantId: string }): Promise<readonly string[]> | readonly string[]
  readonly cacheTtlMs?: number   // default 60 s, at most 10 min
  readonly timeoutMs?: number    // default 2 s, at most 30 s
}

export type TenantModuleAvailability = {
  getUnavailableModuleIds(context: { tenantId: string }): Promise<ReadonlySet<string>>
  isModuleAvailable(moduleId: string, context: { tenantId: string }): Promise<boolean>
  invalidate(tenantId: string): Promise<void>
}

export function createTenantModuleAvailability(options): TenantModuleAvailability
export function resolveTenantModuleAvailability(container): TenantModuleAvailability | null
export function buildTenantModuleAvailabilityCacheTag(tenantId: string): string
export function getTenantModuleAvailabilityGeneration(tenantId: string): string
```

An app registers only the provider (`tenantModuleAvailabilityProvider`). `auth` registers `tenantModuleAvailability` (null without a provider); `rbacService` and `customerRbacService` receive it from DI (`customerRbacService` falls back to null when the key is not registered).

### Policy kernel (additive)

- `FeaturePolicySubject.unavailableModuleIds?` — `authorizeFeatures` denies a required feature whose owning module (`getOwningModuleId`) is in the set, next to the disabled-module check and before the super-admin/portal-admin shortcut and wildcard matching.
- `resolveEffectiveFeatures(grants, { unavailableModuleIds })` drops those modules' concrete features.
- `filterGrantsByModuleAvailability(grants, unavailable)` narrows raw grants for consumers that only receive grants. Explicit grants of an unavailable module are dropped; only wildcards that intersect an unavailable module are expanded to the concrete features they still cover, against a plan built once per (feature catalog, unavailable set): the catalog split into available and unavailable features, indexed by first id segment. Plans live in an LRU of 16, evicted one at a time — a deployment rotates through about as many unavailable sets as it has plan tiers or tenant kinds, so 16 leaves headroom without a wholesale clear.
- Feature ownership is deterministic: an ACL declaration (`acl.ts`) is authoritative; otherwise a module whose id is the feature's prefix wins; otherwise the first declaring module in `modules.ts` order (`setup.defaultCustomerRoleFeatures`, frontend `requireCustomerFeatures`).

### Realm services

Tenant in scope = `scope.tenantId`, or the principal's own tenant (user, API key) when the check carries none. A tenantless principal evaluated without a tenant is not restricted.

| Service | Honours the provider in |
|---|---|
| `RbacService` | `userHasAllFeatures`, `getEffectiveFeatures`, `getGrantedFeatures`, `tenantHasFeature`, `resolveFeatureOrganizationAccess` (incl. the global super-admin shortcut), `userHasAllFeaturesWithEntityManager`, `getGrantedFeaturesWithEntityManager`; new `getUnavailableModuleIds(tenantId, userId?)` |
| `CustomerRbacService` | `userHasAllFeatures`, `getEffectiveFeatures`; new `getUnavailableModuleIds(tenantId)` |

`RbacService` memoizes a tenant's set per instance for at most one second and re-reads it as soon as the tenant's availability generation changes, so a request-scoped instance reads availability about once while a long-lived instance converges as soon as the tenant is invalidated in the same process, and within a second otherwise. `loadAcl` stays raw.

### Enforcement points

1. API route guards for CRUD and custom routes (`checkAuthorization`) and backend, staff frontend and portal page guards: `userHasAllFeatures` / `customerRbacService.userHasAllFeatures`, and, when the guard declares features, a denial when the route's or page's own module (`moduleId` in the manifest) is unavailable — so a module's route guarded by another module's feature is still refused.
2. `POST /api/auth/feature-check` and `POST /api/customer_accounts/portal/feature-check`.
3. Backend chrome and navigation (`getEffectiveFeatures`); `GET /api/auth/admin/nav` keys its 30-minute cache by the tenant RBAC evaluates and its unavailable set.
4. CRUD interceptors, enrichers and mutation guards, and command interceptors (`getGrantedFeatures`).
5. Organization narrowing (`resolveFeatureOrganizationAccess`) and tenant runtimes (`tenantHasFeature`).
6. Portal auth payloads, profile and portal navigation (`CustomerRbacService`).
7. Every module call of `rbacService.userHasAllFeatures` with a tenant scope.
8. Audit-log undo and redo: the routes and the in-transaction replay guard refuse a replay whose command id belongs to an unavailable module.

### Not covered (follow-up)

- AI assistant tool execution, tool and agent lists, agent policy and MCP servers (stacked follow-up PR).
- Read-side ACL-snapshot consumers that call `authorizeFeatures` themselves: search (`search` routes, `shared/lib/search/entityAccess.ts`), dashboards widget lists, entities, communication channels, notification recipients, documents, staff readers, workflows portal tasks, the organization switcher, enterprise security and agent orchestrator, the backend upgrade-actions banner.
- Audit-log snapshot reads and attachments fetched by id.
- Enrichers and interceptors that declare no `features`.
- `catalog/api/categories/route.ts` and `integrations/api/umes-read.ts` build interceptor contexts from JWT `features`; staff JWTs carry none, so feature-gated interceptors there never run today, and switching to `getGrantedFeatures` would change behaviour beyond this change.
- Routes and pages that declare no `requireFeatures` (`requireCustomerFeatures` for portal pages): the owning-module check runs only where a feature guard already resolves the RBAC service, so feature-less routes pay nothing extra.
- Subscribers, workers, schedules, webhooks and the CLI.

Migration recipe for a snapshot consumer: pass `unavailableModuleIds: await rbacService.getUnavailableModuleIds(tenantId, userId)` to `authorizeFeatures`, or call `rbacService.userHasAllFeatures`.

## Architecture

```text
modules.ts (deployment) ──┐
                          ├─> featurePolicy.authorizeFeatures / resolveEffectiveFeatures
provider (per tenant) ────┘          ▲  unavailableModuleIds
     │                               │
tenantModuleAvailability ──> RbacService / CustomerRbacService (memo ≤ 1 s, generation-checked)
  (DI cache + TTL, bounded module-level single-flight, back-off and generations)
```

### Caching, invalidation and fail mode

- One cache entry per tenant and governed-module set in the DI `cache` (key `tenant_module_availability:v2:<governed>:<tenant>`, tag `tenant_module_availability:tenant:<id>`, written under `runWithCacheTenant`), TTL at most 10 minutes.
- In-flight calls, failure back-off and invalidation generations live in bounded (10 000 entries, LRU) module-level stores keyed by tenant and the provider's governed-module set, so provider objects re-created per request share them. Evicting a tenant's generation bumps a global epoch, so no in-flight answer is ever cached after an eviction.
- `invalidate(tenantId)` bumps the tenant's in-process generation, writes a fresh per-tenant invalidation stamp (key prefix `tenant_module_availability_stamp:v1:`, distinct from entry keys) to the shared cache, deletes the tag, then bumps the generation again so a realm-service memo taken while the delete was running is discarded. A provider call records the stamp when it starts and caches its answer only if the stamp is unchanged, re-checking after the write and deleting the entry if an invalidation landed in between (or if the re-check itself fails), so an answer that was in flight in any process during an invalidation is returned to its caller but never cached. Realm-service memos re-read on the next check.
- Bounds after an invalidation: in the same process, the next check (a joined provider call that was already in flight is not cancelled and can still return the old answer to its waiters, at most `timeoutMs` later). With a shared cache (Redis), other processes apply the change within about one second plus `timeoutMs`; with a per-process cache, within `cacheTtlMs` plus one second plus `timeoutMs`.
- **Fail closed for governed modules only.** A throw, rejection, timeout or non-array answer makes every governed module unavailable for that tenant until the provider answers again (retried after 5 s); other modules never wait on the provider. Failing open would grant modules a tenant is not entitled to during an outage. Provider failures and cache read/write failures are reported (`tenant_module_availability.provider_failed`, `.cache_read_failed`, `.cache_write_failed`). An invalid or unresolvable registration is reported once per process (`.provider_invalid`, `.provider_unresolved`) and ignored, because it has no bounded set to deny.

## Data Models

None. Stored grants are never modified.

## API Contracts

No existing route, request or response schema changes. With a provider registered, guarded routes of an unavailable module answer the existing 403 (undo/redo the existing 400), pages render the existing access-denied view, and capability payloads omit the module.

The reference app and the create-app template gain the test-only module `module_availability_probe` (like `ratelimit_probe`): `GET /api/module_availability_probe/ping` and `PUT /api/module_availability_probe/availability`, plus `POST /api/module_availability_probe/markers`, which runs the undoable command `module_availability_probe.markers.record` (it persists nothing but its action-log entry), all answering 404 outside `OM_TEST_MODE`. It has no `acl.ts`, page, setup or locale: the ping and marker routes require `module_availability_probe.ping`, a feature the probe owns through its module-id prefix without declaring it, which TC-MAP-001 grants to a role explicitly. The switch checks `auth.acl.manage` in its handler instead of declaring `requireFeatures`, because the owning-module check would otherwise lock the switch once the probe module is unavailable (found by TC-MAP-001).

## Migration & Backward Compatibility

Additive only; `BACKWARD_COMPATIBILITY.md` and `UPGRADE_NOTES.md` list the surfaces.

## Risks & Impact Review

| Risk | Severity | Scenario | Mitigation | Residual |
|---|---|---|---|---|
| Provider outage | High | Governed modules disappear for affected tenants | Fail closed for governed modules only; shared back-off; reporting | Governed modules unavailable during the outage |
| Snapshot consumers | Medium | Search, dashboards, entities and other readers list items of an unavailable module | "Not covered" list and recipe | Open until migrated |
| Stale availability | Medium | Plan change not reflected | `invalidate`; generation-checked one-second memo; TTL ≤ 10 min; nav cache keyed by the set | Other instances converge within the TTL without Redis |
| Over-broad provider | Medium | Provider governs `auth` and locks a tenant out | Provider chooses `governedModuleIds`; docs warn | Misconfiguration possible |
| Hot-path cost | Low | Extra work per check | One null check without a provider; about one cached read per request with a provider; memoized grant narrowing | Network round trip with Redis, about once per request |

## Verification

### Guarantee → proving test (fails on `develop` enforcement)

| Guarantee | Test |
|---|---|
| Inert without a provider | `rbacService.tenantModuleAvailability` and `customerRbacService.tenantModuleAvailability` "is inert"; `admin-nav` legacy key |
| Per tenant, super admin and wildcards denied | shared `tenantModuleAvailability.test.ts`; `rbacService.tenantModuleAvailability`; `feature-check.tenant-module-availability`; `apps/mercato/src/__tests__/api-tenant-module-availability.test.ts`; `backend-require-features` |
| A module's route or page guarded by another module's feature | `api-tenant-module-availability.test.ts`, `backend-require-features`, `portal-org-binding` |
| Navigation and effective features | shared and `rbacService` effective-feature cases; `admin-nav` cache-key cases |
| Portal | `customerRbacService.tenantModuleAvailability`, `portal-org-binding` |
| Long-lived services converge | `rbacService.tenantModuleAvailability` "lets a long-lived service follow an invalidation…" |
| Undo and redo | `undo.route.test.ts`, `redo.route.test.ts`, replay-guard case |
| Cache, invalidation, fail closed | shared service cases |
| End to end | `apps/mercato/src/modules/module_availability_probe/__integration__/TC-MAP-001-tenant-module-availability.spec.ts` (route guard and feature-check for a tenant user, the super admin and an API key; flip back proves invalidation) |
| End to end, audit-log replay | `packages/core/src/modules/audit_logs/__integration__/TC-AUD-009-replay-unavailable-module.spec.ts` (undo and redo of a probe-owned command refused with 400 while the probe is unavailable, then accepted) |

### Performance

Jest micro-benchmarks, in-band, Windows 11 / Node 24, shared machine (noisy); catalog of 120 modules × 25 features.

| Path | Result |
|---|---|
| `filterGrantsByModuleAvailability`, 41 `module.*` grants, 2 unavailable | 193 ms / call without a plan; 26 µs warm with the segment-indexed plan; 1.1–1.7 ms when a new unavailable set builds its plan |
| `authorizeFeatures`, super admin, no provider | 1.3–2.0 µs (develop 2.0–2.2 µs on a quiet machine) |
| `authorizeFeatures`, super admin, 2 unavailable | 1.8–3.0 µs |
| `RbacService.userHasAllFeatures`, warm ACL cache | +1.5–4 µs per check with a provider |

## Final Compliance Report

- Backward compatibility: additive; unchanged without a provider.
- Tenant isolation: availability keyed and cache-namespaced per tenant.
- Security: unavailable-module denial precedes super-admin, portal-admin and wildcard decisions; scope limited to feature guards as stated.
- Observability: every new fallback `catch` reports with a stable code.

## Changelog

### 2026-10-08

- Gate preparation: rebased onto `develop` `7187041c2`; the probe's feature is described precisely (no `acl.ts`; owned through its module-id prefix). TC-AUD-009 proves audit-log undo and redo refusal through the app, against a test-only undoable probe command.
- Delta review: the post-write stamp re-check is tested and drops the entry when the re-check fails; invalidation bumps the generation again after deleting the entry; the realm-service memos are true LRUs; the stamp key has its own prefix; the documented convergence bounds include `timeoutMs`.
- Third review: a per-tenant invalidation stamp in the shared cache keeps an answer in flight in another process from being cached after an invalidation; the grant-narrowing memo is reduced to one LRU of 16 segment-indexed plans; `RbacService` memos are bounded; the dispatcher and staff-frontend wiring are tested; docs explain how to keep a route reachable while its module is unavailable.

### 2026-10-07

- Second review: route and page guards deny a module's own routes and pages when it is unavailable; the per-instance memo is generation-checked with a one-second TTL; cache keys carry the governed set; LRU eviction for narrowing plans and generations; `customerRbacService` registration falls back without the auth key.
- First review: replay-bound RBAC methods honour the provider; availability state shared across per-request provider objects; invalidation generations; reporting on cache failures and invalid registrations; memoized grant narrowing; nav cache keyed by the evaluated tenant; deterministic portal feature ownership; probe reduced to two test-only routes; claims re-scoped to feature-guard enforcement. Audit-log undo/redo honours the provider.
- Rebased onto `develop` `85ee5f16b`.

### 2026-10-05

- Spec and first implementation.
