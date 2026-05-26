# SPEC — CRUD API performance quick wins (target < 100 ms p50)

**Status:** draft / proposal
**Owner:** core / shared
**Date:** 2026-05-24
**Tracking issue:** [open-mercato/open-mercato#2044](https://github.com/open-mercato/open-mercato/issues/2044)

## TLDR

Every CRUD API list/detail call shares one pipeline (`packages/shared/src/lib/crud/factory.ts`). Static analysis of that pipeline surfaces five backward-compatible hot spots that, taken together, should bring most CRUD list responses from "a few hundred ms" down to **< 100 ms p50** for a 50-item page on a warm process. None of the proposed changes alter the request/response wire format, ACL semantics, ORM contract, cache-tag contract, or any public TypeScript type — they are pure internal optimizations behind feature flags where appropriate.

## Overview

Open Mercato's CRUD endpoints all flow through `makeCrudRoute(...)` in `packages/shared/src/lib/crud/factory.ts`. A single list request currently does, per call:

1. **`createRequestContainer()`** — fresh Awilix container, fresh EM fork, dynamic `import('@open-mercato/core/bootstrap')`, dynamic `import('@/di')`, re-registration of the tenant-encryption subscriber. ([`packages/shared/src/lib/di/container.ts:57-118`](../../packages/shared/src/lib/di/container.ts))
2. **Auth** — JWT verify (CPU-only) + cookie parsing. ([`packages/shared/src/lib/auth/server.ts`](../../packages/shared/src/lib/auth/server.ts))
3. **`resolveOrganizationScopeForRequest`** — 1 SQL `SELECT` against `organizations`, **uncached**. ([`packages/core/src/modules/directory/utils/organizationScope.ts:64`](../../packages/core/src/modules/directory/utils/organizationScope.ts))
4. **`rbacService.loadAcl` (`getGrantedFeatures`)** — 3–5 SQL queries (User → UserAcl → UserRole → RoleAcl). A 5-minute `CacheStrategy` cache exists but is only wired when a backing cache is registered. ([`packages/core/src/modules/auth/services/rbacService.ts:28-401`](../../packages/core/src/modules/auth/services/rbacService.ts)) — called by both the interceptor context (factory.ts:988) and the enricher context (factory.ts:961).
5. **Interceptors `before`** — feature-gated, in-process. ([`factory.ts:1026-1058`](../../packages/shared/src/lib/crud/factory.ts))
6. **`buildFilters` / advanced-filter merge / id merge / scoped where**. ([`factory.ts:1408-1485`](../../packages/shared/src/lib/crud/factory.ts))
7. **`QueryEngine.query`** — `COUNT(*)` + `SELECT` (with LEFT-JOIN custom-field aggregation when CF sources are configured). ([`packages/shared/src/lib/query/engine.ts:194-821`](../../packages/shared/src/lib/query/engine.ts))
8. **`decorateItemsWithCustomFields`** — **per request** `em.find(CustomFieldDef, ...)` — uncached. ([`factory.ts:891-955`](../../packages/shared/src/lib/crud/factory.ts) → [`packages/shared/src/lib/crud/custom-fields.ts:340-407`](../../packages/shared/src/lib/crud/custom-fields.ts))
9. **Translation overlay** — plugin call per list. ([`factory.ts:1496-1515`](../../packages/shared/src/lib/crud/factory.ts))
10. **`logCrudAccess`** — **awaited** `Promise.all` of N inserts into `access_logs` (one per unique item id). With encryption enabled, each insert also does AES + a fork-EM allocation. ([`factory.ts:708-766`](../../packages/shared/src/lib/crud/factory.ts) + [`packages/core/src/modules/audit_logs/services/accessLogService.ts:37-100`](../../packages/core/src/modules/audit_logs/services/accessLogService.ts))
11. **Interceptors `after`** + **enrichers** + maybe **store cache**.

A warm process with cached templates, on a list of 50 rows, plausibly spends:

| stage | typical cost (warm) |
|---|---|
| createRequestContainer + bootstrap re-entry | 5–25 ms |
| resolveOrganizationScopeForRequest (1 SQL) | 1–3 ms |
| rbac (3-5 SQL, no cache hit) | 5–15 ms |
| CF definition index load (1 SQL, no cache) | 2–8 ms |
| QueryEngine COUNT + SELECT | 5–30 ms (data-dependent) |
| `logCrudAccess` 50× INSERT (awaited) | **30–150 ms** |
| serialize / interceptors / enrichers | 2–10 ms |
| **total** | **~50–240 ms** |

The `logCrudAccess` row dominates on lists. CF/RBAC/scope queries are the next tier. The DI container creation dominates on cold paths.

## Problem statement

CRUD reads have several easily addressable, 100% backward-compatible inefficiencies on the per-request critical path. They are:

| # | Hot spot | BC impact | Estimated win (warm, p50) |
|---|---|---|---|
| 1 | `logCrudAccess` awaits N parallel INSERTs on every list/detail | **None** — output unchanged; persistence semantics unchanged (still at-least-once) | **20–100 ms** on 50-item lists |
| 2 | `loadCustomFieldDefinitionIndex` runs an `em.find(CustomFieldDef, ...)` on every CRUD list, never cached | **None** — CF def index is read-only inside a request; existing `@open-mercato/cache` tag-invalidation contract already exists for CF defs | **3–10 ms** per list |
| 3 | `rbacService.getGrantedFeatures` is called twice per request (interceptors + enrichers) and the cache backend is optional | **None** — same return value; just memoize inside the request and ensure a default in-process cache is wired when no Redis is configured | **5–15 ms** per request |
| 4 | `resolveOrganizationScopeForRequest` re-issues 1 SQL `SELECT` on every request | **None** — `OrganizationScope` is a pure function of `(tenantId, userId)` between scope-membership changes; can be short-TTL cached using existing tag pattern | **1–3 ms** per request |
| 5 | `createRequestContainer` runs dynamic `import('@/di')` and `import('@open-mercato/core/bootstrap')` on every request, and re-registers the encryption subscriber on every forked EM | **None** — both imports are already cached by Node's module loader, but the re-registration of the subscriber on every forked EM is observable in profilers; we can hoist that to a one-shot per-process gate | **2–8 ms** per request, **bigger** on cold first request |

There is no current spec for CRUD-API request-time optimization. The profiler infrastructure (`OM_PROFILE=*`) is already in place ([`packages/shared/src/lib/profiler/index.ts`](../../packages/shared/src/lib/profiler/index.ts)), so each phase here is measurable before/after.

## Proposed solution

Five phases, each independently shippable, ordered by leverage. **All five preserve the public CRUD contract verbatim** — no response-shape change, no header change, no behavior change other than latency.

### Phase 1 — Batch + fire-and-forget `logCrudAccess` _(biggest win, ships first)_

**Where:** [`packages/shared/src/lib/crud/factory.ts:708-766`](../../packages/shared/src/lib/crud/factory.ts) and [`packages/core/src/modules/audit_logs/services/accessLogService.ts`](../../packages/core/src/modules/audit_logs/services/accessLogService.ts).

**Today:**
```ts
// factory.ts:739-765
for (const item of items) {
  ...
  tasks.push(Promise.resolve(service.log(payload)).catch(...))
}
if (tasks.length > 0) await Promise.all(tasks)   // ← blocks the response
```
…and each `service.log` issues its own `INSERT` + optional encrypt round.

**Change:**
1. Add an optional `service.logMany(payloads: AccessLogCreateInput[])` to `AccessLogServiceLike` (`AccessLogServiceLike.logMany?:` — keeping `log()` untouched for BC). Implement in `AccessLogService` with a single multi-row `INSERT ... VALUES (...), (...), ...` (Postgres trivially supports up to ~1000 rows per statement). For encryption, batch-encrypt all rows in one `encryption.encryptEntityPayload` pass per tenant.
2. In `factory.ts:logCrudAccess`, prefer `logMany` when available, fall back to the old per-row loop otherwise.
3. Make the **outer** call non-blocking: replace `await logCrudAccess(...)` with a fire-and-forget pattern using a per-request "deferred" queue that resolves after the response is sent (Next.js `waitUntil`-style, or simply `void` with a `.catch` and a process-level "in-flight" counter the test harness can drain). Guard with `process.env.OM_CRUD_ACCESS_LOG_BLOCKING === '1'` for the rare callers that explicitly want it awaited (CI tests, integration scenarios that assert immediately on `access_logs`).

**BC story:**
- Wire format unchanged.
- `access_logs` rows are still written at-least-once with the same shape and the same encryption.
- Existing callers of `accessLogService.log(...)` keep working — the multi-row path is purely additive.
- Test code that asserts on access-log rows directly after a CRUD call must either (a) `await` an explicit `flushAccessLog()` helper exposed on the service, or (b) set `OM_CRUD_ACCESS_LOG_BLOCKING=1`. The integration test harness ([`packages/cli/src/lib/testing/integration.ts`](../../packages/cli/src/lib/testing/integration.ts)) will default to **blocking** so existing tests keep passing without churn.

**Estimated win:** 20–100 ms p50 on 50-item lists; up to **200+ ms on 100-item lists with encryption enabled**.

### Phase 2 — Request-scoped + tag-invalidated cache for the CF definition index

**Where:** [`packages/shared/src/lib/crud/custom-fields.ts:340-407`](../../packages/shared/src/lib/crud/custom-fields.ts) and [`packages/shared/src/lib/crud/factory.ts:911-916`](../../packages/shared/src/lib/crud/factory.ts).

**Today:** every list path calls `loadCustomFieldDefinitionIndex({ em, entityIds, tenantId, organizationIds })` → 1 SQL on `custom_field_defs`. No cache.

**Change:**
1. Wrap `loadCustomFieldDefinitionIndex` with a thin caching layer that uses the existing `@open-mercato/cache` service via `cf:def:<tenantId>:<sortedEntityIds>:<sortedOrgIds>:<fieldsetKey?>` as the key.
2. Tags: `cf:def:tenant:<tenantId>`, `cf:def:entity:<entityId>` (one per entity in the index), `cf:def:org:<orgId>` for org-scoped defs.
3. Wire invalidation in the CustomFieldDef CRUD routes (create/update/delete) and in the existing entities-module setup hooks — call `cache.deleteByTags(...)` with the matching tags. CF defs change rarely, so a 5-minute default TTL is conservative; admins can override via `OM_CF_DEF_CACHE_TTL_MS`.
4. Add a per-request micro-cache (Map keyed by `(tenantId, sortedEntityIds.join('|'), sortedOrgIds.join('|'))`) so two CRUD calls inside one HTTP request (rare but possible via interceptors) don't re-fetch.

**BC story:**
- `loadCustomFieldDefinitionIndex` return type unchanged.
- Caching is layered behind the same function signature; callers see identical data.
- If a tenant disables `@open-mercato/cache` (memory backend) the implementation degrades to today's behavior (no cache hit).
- Tag invalidation only affects the new keys; no other caches are touched.

**Estimated win:** 3–10 ms p50 per list.

### Phase 3 — Hoist `rbacService.getGrantedFeatures` to a per-request memo + ensure default in-process cache

**Where:** [`factory.ts:961-1023`](../../packages/shared/src/lib/crud/factory.ts) and [`packages/core/src/modules/auth/services/rbacService.ts:28-401`](../../packages/core/src/modules/auth/services/rbacService.ts).

**Today:**
- `buildEnricherContext` and `buildInterceptorContextInner` both call `rbac.getGrantedFeatures(...)` independently.
- A `WeakMap`-backed cache for `buildInterceptorContext` exists (`interceptorContextCache`, factory.ts:1004), but it doesn't share with the enricher path. The enricher path calls `getGrantedFeatures` again.
- The `RbacService` constructor accepts an optional `CacheStrategy`. If none is wired (DI registration omits it), every request pays 3-5 SQL queries.

**Change:**
1. In `factory.ts`, add a single `resolveUserFeaturesOnce(ctx)` that caches the resolved feature list on the `CrudCtx` object itself (extend `CrudCtx` with `userFeatures?: Promise<string[] | undefined>` — non-enumerable, optional, so existing TS consumers of `CrudCtx` are unaffected; the field is read internally only).
2. Replace both call sites (`buildEnricherContext`, `buildInterceptorContextInner`, and the legacy `resolveUserFeatures`) with `resolveUserFeaturesOnce(ctx)`.
3. In `rbacService` DI registration (`packages/core/src/modules/auth/di.ts`), default the `CacheStrategy` argument to an in-process LRU when no shared cache is registered. This keeps single-process deployments fast without forcing Redis. (This change is also opt-in via `OM_RBAC_DEFAULT_CACHE=off` for callers who want strict pass-through.)

**BC story:**
- `getGrantedFeatures` signature, return values, and tag-invalidation semantics unchanged.
- The new internal `userFeatures` field on `CrudCtx` is read-only inside the factory and isn't part of the public `CrudCtx` JSDoc surface that third-party modules consume.

**Estimated win:** 5–15 ms p50 per request (eliminates one full 3-5 query RBAC roundtrip).

### Phase 4 — Short-TTL cache for `resolveOrganizationScopeForRequest`

**Where:** [`packages/core/src/modules/directory/utils/organizationScope.ts:76-90`](../../packages/core/src/modules/directory/utils/organizationScope.ts) and `factory.ts:1135`.

**Today:** 1 SQL `SELECT` on `organizations` per request, never cached.

**Change:**
1. Add a tag-based cache around `resolveOrganizationScopeForRequest`. Key: `org-scope:<userId>:<tenantId>`. Tags: `org-scope:user:<userId>`, `org-scope:tenant:<tenantId>`.
2. Invalidate on organization membership changes, organization create/delete, and tenant change — every existing mutation site that already touches `user_organizations` / `organizations` already runs through commands or CRUD routes, so we can hook invalidation into `emitCrudSideEffects` for those entities.
3. Default TTL: 60 s (organization scope changes are rare; staleness window is acceptable and short).
4. Like Phase 3, falls back to today's behavior if the cache service is not registered.

**BC story:**
- Function signature unchanged.
- Tag contract is additive; nothing reads these tags today.

**Estimated win:** 1–3 ms p50 per request.

### Phase 5 — Trim `createRequestContainer` cold-path work

**Where:** [`packages/shared/src/lib/di/container.ts:57-118`](../../packages/shared/src/lib/di/container.ts).

**Today:**
- `import('@open-mercato/core/bootstrap')` and `import('@/di')` are dynamic, but Node module loader caches them after the first call. Still, the `await bootstrap(container)` path is gated by `!container.registrations?.eventBus`, which is true on _every_ request (each request gets a fresh container) — so `bootstrap` is invoked every request. Cost depends on what bootstrap does (event-bus init, encryption subscriber registration, module subscribers); typical 2–8 ms.
- `registerTenantEncryptionSubscriber(emForEnc, tenantEncryptionService)` is called on every fork.

**Change:**
1. Hoist the parts of `bootstrap` that are process-scoped (event-bus instance, encryption KMS) to module-load time, behind a `globalThis` once-guard (same pattern already used by `registerDiRegistrars` in this file, lines 28-34). The bootstrap function stays callable for external consumers, but inside the factory we skip it if a per-process `__openMercatoBootstrapped__` flag is set.
2. Cache the `tenantEncryptionService.isEnabled?.()` result for the lifetime of the process — encryption enablement does not change at runtime.
3. Pre-build the Awilix registrations record once per process (`em` and `queryEngine` still need per-request binding, but the registrar list and the `commandRegistry` reference do not).

**BC story:**
- Module-level once-guards are an extension of the existing pattern used for `getDiRegistrars`.
- All existing `bootstrap(container)` callers continue to work; the once-guard is internal to the factory.

**Estimated win:** 2–8 ms p50 warm; **significantly more on cold start** (first request after a deploy).

## Architecture

No new modules, no new tables, no new public types. All five phases live inside `packages/shared/src/lib/crud/*` and the targeted module services. They reuse existing infrastructure:

- `@open-mercato/cache` for tag-based invalidation (already supports memory / sqlite / redis backends).
- `@open-mercato/shared/lib/profiler` for measurement (`OM_PROFILE=*` already emits the relevant marks: `cache_checked`, `query_engine_resolved`, `custom_fields_complete`, `access_logged`, `enrichers_complete`).
- Existing `rbacService` tag-invalidation contract (`rbac:user:*`, `rbac:tenant:*`, `rbac:org:*`).
- Existing CF def `em.find` query.

## Data models

**No schema changes.** New cache keys + tags only:

- `cf:def:<tenantId>:<entitiesHash>:<orgsHash>:<fieldsetHash?>`
- `cf:def:tenant:<tenantId>`, `cf:def:entity:<entityId>`, `cf:def:org:<orgId>`
- `org-scope:<userId>:<tenantId>`
- `org-scope:user:<userId>`, `org-scope:tenant:<tenantId>`

## API contracts

**No public API change.** Internal signatures touched:

- `AccessLogServiceLike` gains an optional `logMany?(payloads): Promise<void>` (additive).
- `LogCrudAccessOptions` unchanged.
- `CrudCtx` gains an internal `userFeatures?: Promise<string[] | undefined>` field (not part of any documented public surface — searched via grep, only the factory itself constructs `CrudCtx`).
- `loadCustomFieldDefinitionIndex(...)` signature unchanged; caching is wrapper-only.
- `resolveOrganizationScopeForRequest(...)` signature unchanged.

## Risks & impact review

| Risk | Severity | Affected area | Mitigation | Residual |
|---|---|---|---|---|
| Fire-and-forget access logs lose a row on process crash | low | audit_logs | At-least-once is already the contract today (the current path swallows individual errors with a `console.error`). We keep the same try/catch and add a `flushAccessLog()` test hook to drain on shutdown. | acceptable |
| Tag invalidation for CF defs misses an edge path | medium | custom fields rendering shows stale label/kind | All CF-def write paths go through the entities module's CRUD route + commands; we add the tag delete in `emitCrudSideEffects` for `CustomFieldDef`, plus an explicit invalidate in the `seedDefaults` helper. Stale window bounded by TTL (5 min). | acceptable |
| Per-request RBAC memo desyncs from a mid-request grant change | very low | RBAC | RBAC grants do not change mid-request — they change via admin API mutations on another request. The memo lifetime equals one HTTP request. | none |
| Org-scope cache staleness on membership change | low | a user keeps seeing/missing an org for up to 60 s after the admin change | Default TTL 60 s; cache invalidation hooked into `user_organizations` mutations. `OM_ORG_SCOPE_CACHE_TTL_MS=0` disables. | acceptable |
| Process-scoped bootstrap once-guard breaks HMR | low | dev only | The existing `globalThis` pattern (lines 28-34 of container.ts) already handles HMR by re-registering; we follow the same pattern with a debug log. | acceptable |
| Multi-row INSERT batch size exceeds Postgres parameter limit | low | very large lists | Cap batch at 500 rows; chunk if pageSize ever exceeds (today pageSize is capped at 100). | acceptable |

## Verification plan

Per-phase, before/after using the existing profiler:

```bash
OM_PROFILE='*' yarn dev:ephemeral
# in another shell:
curl -s -H 'cookie: ...' 'http://localhost:3000/api/customers/people?pageSize=50' | head -c 300
# inspect [crud:profile] JSON for the per-mark durations
```

Per-phase acceptance criteria:

| Phase | Acceptance |
|---|---|
| 1 | `access_logged` mark falls from O(N × 0.5–2 ms) to O(1 ms); `total - access_logged` unchanged or lower |
| 2 | `custom_fields_complete - transform_complete` falls below 1 ms on cache hit; first request per (tenant, entities) unchanged |
| 3 | RBAC SQL counter (`OM_DB_POOL_DEBUG=1`) drops by 3–5 queries per request after the first per-(user, tenant, org) call |
| 4 | `context_ready` time drops by 1–3 ms after first request per (user, tenant) |
| 5 | First request after `yarn dev` cold boot is 20–60 ms faster; warm requests 2–8 ms faster |

Add integration coverage:
- `.ai/qa/tests/api/crud-access-log-batched.spec.ts` — assert that 50 items in one list produce 50 `access_logs` rows (existing semantics), exercised once with `OM_CRUD_ACCESS_LOG_BLOCKING=1` and once with the new default + an explicit `flushAccessLog()`.
- `.ai/qa/tests/api/crud-rbac-memo.spec.ts` — assert RBAC SQL query count per CRUD request stays constant (1 lookup) regardless of enricher/interceptor configuration.
- `.ai/qa/tests/api/crud-cf-def-cache.spec.ts` — assert `custom_field_defs` SELECT count goes from 1-per-list to 1-per-(tenant, entities) within a TTL window.

## Rollout / phasing

Each phase is independently shippable behind an env flag for safety:

| Phase | Flag | Default |
|---|---|---|
| 1 | `OM_CRUD_ACCESS_LOG_BLOCKING` | `0` in prod, `1` in integration tests |
| 2 | `OM_CF_DEF_CACHE_TTL_MS` | `300000` (5 min); `0` disables |
| 3 | `OM_RBAC_DEFAULT_CACHE` | `on` |
| 4 | `OM_ORG_SCOPE_CACHE_TTL_MS` | `60000`; `0` disables |
| 5 | (none — once-guard is internal) | — |

Recommended order: 1 → 2 → 3 → 4 → 5. Phase 1 is the largest win and lowest risk; ship it standalone first to validate the approach end-to-end with the integration suite.

## Out of scope

- Replacing `BasicQueryEngine` or rewriting query indexer.
- Adding HTTP-level response caching (already exists behind `ENABLE_CRUD_API_CACHE`; orthogonal to this spec).
- Persistent connection pool tuning (already addressed in `packages/core/src/modules/orm-pool-config.ts` and the recent flaky-test fix).
- Any change to encryption / KMS path.

## Companion FR (for GitHub)

This spec is intended to be filed together with a GitHub Feature Request issue titled:

> **feat: CRUD API performance quick wins (target < 100 ms p50)**

Suggested body (paste into the `Feature request` template):

```
## Proposed solution

Cut p50 latency for CRUD list/detail endpoints below 100 ms via five backward-compatible
internal optimizations in `packages/shared/src/lib/crud/factory.ts` and adjacent helpers.
No wire-format change, no public-type change, no ACL/data-model change. Each phase is
independently shippable and gated by an env flag where helpful.

Hot spots (see spec for file/line refs):

1. `logCrudAccess` awaits N inserts on every list — biggest single win (~20-100ms on 50-item lists).
2. `loadCustomFieldDefinitionIndex` runs an em.find on every CRUD list — no cache.
3. `rbacService.getGrantedFeatures` is called twice per request and may not have a cache backend wired.
4. `resolveOrganizationScopeForRequest` re-issues one SELECT per request — uncached.
5. `createRequestContainer` re-runs `bootstrap()` and subscriber registration every request.

## Specification

- [x] Yes
- File: `.ai/specs/2026-05-24-crud-api-performance-quick-wins.md`

## Additional context

Profiler is already in place (`OM_PROFILE=*`) and the spec lists per-phase acceptance
criteria for measuring before/after. Integration coverage proposed in `.ai/qa/tests/api/`.
```

## Changelog

- **2026-05-24** — initial draft (research + spec; no code change yet).
