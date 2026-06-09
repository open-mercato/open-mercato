> Auto-generated cache-performance Feature Request — candidate 2 of 9
> Endpoint: `GET /api/directory/organization-switcher` · ROI 84 · Verdict: good
> Source: `packages/core/src/modules/directory/api/organization-switcher/route.ts`

## Summary

Add a tenant-scoped, get-then-set response cache to `GET /api/directory/organization-switcher` (`packages/core/src/modules/directory/api/organization-switcher/route.ts`). The handler is invoked on essentially every backend page load (the global `OrganizationSwitcher` chrome component) yet recomputes a stable org tree + RBAC scope on each call. Cache the full response payload keyed by `(userId, tenantId, selectedOrg)` with a short TTL (60s) and invalidate via tags on `directory.organization.*` and `directory.tenant.*` events. **The hard part — tag-based invalidation — is already wired** (`packages/core/src/modules/directory/subscribers/invalidateOrgScopeCache.ts` fires on `directory.organization.*`); this FR reuses the same tag namespace and adds a tenant-event hook so the new entry stays correct.

## Why (impact)

- **Hotness: very high.** `apps/mercato/src/components/OrganizationSwitcher.tsx:195` calls this URL on mount of the backend header chrome (every backend navigation that remounts the switcher), `packages/create-app/template/src/components/OrganizationSwitcher.tsx:195` does the same in scaffolded apps, and it is additionally fetched by `packages/core/src/modules/api_keys/backend/api-keys/create/page.tsx:39` and `packages/core/src/modules/customer_accounts/backend/customer_accounts/settings/domain/page.tsx:97`. Read:write ratio is extremely high — the org tree changes weekly at most.
- **Cost: moderate-to-heavy and compounding.** Per call the handler does: `em.find(Tenant)` (superadmin path), `rbac.loadAcl` (route.ts:142), `rbac.userHasAllFeatures` (route.ts:147), `em.find(Organization)` (route.ts:157), `computeHierarchyForOrganizations` (a recursive tree walk with per-level name sorting — `packages/core/src/modules/directory/lib/hierarchy.ts:37`), then `resolveOrganizationScope` (route.ts:166) which itself does a **second** `rbac.loadAcl` (organizationScope.ts:226) plus another `em.find(Organization)` for descendant expansion (organizationScope.ts:163), and finally `buildOrganizationMenu`. That is ~2 ACL loads + 2 org-table scans + tree compute on every page view.
- **Est. win:** eliminates 2 RBAC ACL loads, 2 `organizations` scans, and the hierarchy/menu compute for the ~60s window after the first hit per user — i.e. nearly every navigation within a session becomes a single cache read. This is the dominant per-navigation directory cost.

## Current behavior

`packages/core/src/modules/directory/api/organization-switcher/route.ts`:
- `route.ts:92` `GET` resolves auth, then on every request builds a fresh request container (`route.ts:101`).
- `route.ts:116` superadmin branch loads all tenants via `em.find(Tenant, { deletedAt: null })`.
- `route.ts:142` `rbac.loadAcl(...)` and `route.ts:147` `rbac.userHasAllFeatures([... 'directory.organizations.manage'])`.
- `route.ts:157` `em.find(Organization, { tenant, deletedAt: null })`.
- `route.ts:162` `computeHierarchyForOrganizations(orgEntities, tenantId)` (`hierarchy.ts:37`).
- `route.ts:166` `resolveOrganizationScope(...)` — note it calls the **uncached** `resolveOrganizationScope`, NOT the cached wrapper `resolveOrganizationScopeForRequest` (organizationScope.ts:317). Inside it does a second `rbac.loadAcl` (organizationScope.ts:226) and `loadOrgDescendantMap` org query (organizationScope.ts:163).
- `route.ts:178` `buildOrganizationMenu(hierarchy, accessible)` builds the final node tree + selectable set.
- `route.ts:199-221` assembles `{ items, selectedId, canManage, canViewAllOrganizations, tenantId, tenants, isSuperAdmin }`, calls `logCrudAccess`, and returns.

There is **no response cache** today. A partial cache exists for `resolveOrganizationScope` (the `org-scope:*` cache in `organizationScope.ts:317`, default-off behind `OM_ORG_SCOPE_CACHE_TTL_MS`), but this route bypasses it by calling the raw function, so even with that flag on the route stays uncached.

## Proposed cache

Wrap the existing compute in a get-then-set around the **assembled response object**, scoped to the tenant with `runWithCacheTenant`. `logCrudAccess` must still run on every request (audit must not be cached), so cache only the payload, not the side effect.

Key shape (hashed + tenant-namespaced internally by the cache layer, but be explicit):

```
org-switcher:v1:<userId>:<tenantId>:<selectedOrg|none|all>
```

Code sketch (inside the `try` block, after `tenantId` is resolved and before the heavy compute at route.ts:142):

```typescript
import { runWithCacheTenant } from '@open-mercato/cache'
import type { CacheStrategy } from '@open-mercato/cache'

const ORG_SWITCHER_CACHE_PREFIX = 'org-switcher:v1'
const ORG_SWITCHER_TTL_MS = 60_000

const cache = (() => {
  try {
    const c = container.resolve('cache') as CacheStrategy | undefined
    return c && typeof c.get === 'function' && typeof c.set === 'function' ? c : null
  } catch { return null }
})()

const rawSelected = getSelectedOrganizationFromRequest(req)
const requestedAll = isAllOrganizationsSelection(rawSelected)
const selectedKeyPart = requestedAll ? 'all' : (rawSelected ?? 'none')
const cacheKey = `${ORG_SWITCHER_CACHE_PREFIX}:${auth.sub}:${tenantId}:${selectedKeyPart}`
const cacheTags = [
  `org-scope:tenant:${tenantId}`,        // reuse existing org-mutation invalidation
  `org-switcher:tenant:${tenantId}`,     // new: targeted switcher tag
  `org-switcher:user:${auth.sub}`,       // new: per-user (role/ACL change)
]

const buildPayload = async () => { /* existing route.ts:142..207 compute, returns `response` */ }

const response = await runWithCacheTenant(tenantId, async () => {
  if (cache) {
    try {
      const hit = await cache.get(cacheKey)
      if (hit && typeof hit === 'object') return hit as Awaited<ReturnType<typeof buildPayload>>
    } catch (err) { console.warn('[org-switcher:cache] read failed', err) }
  }
  const built = await buildPayload()
  if (cache) {
    try { await cache.set(cacheKey, built, { ttl: ORG_SWITCHER_TTL_MS, tags: cacheTags }) }
    catch (err) { console.warn('[org-switcher:cache] write failed', err) }
  }
  return built
})

// audit ALWAYS runs, never cached:
await logCrudAccess({ container, auth, request: req, items: response.items, ... })
return NextResponse.json(response)
```

Notes:
- TTL 60s mirrors the sibling `org-scope` cache default and bounds staleness for membership/visibility changes that do not emit a directory event.
- For the superadmin tenant-list portion, the `org-switcher:tenant:<tenantId>` + tenant-event invalidation (below) keeps it fresh; the 60s TTL is the backstop for cross-tenant tenant renames a superadmin might not have a direct tag for. If exactness of the *other-tenant* list matters, gate the superadmin path out of the cache (`if (actorIsSuperAdmin) skip set`) — recommended as a conservative v1.

## Cache tags

- `org-scope:tenant:<tenantId>` — **reused** from the existing org-scope cache. Already invalidated by `packages/core/src/modules/directory/subscribers/invalidateOrgScopeCache.ts` on `directory.organization.*`. Tagging the switcher entry with it means org create/update/delete already busts this entry with zero new wiring.
- `org-switcher:tenant:<tenantId>` — new. Represents "any switcher entry for this tenant" (org tree + tenant-active state). Invalidated on org and tenant mutations for that tenant.
- `org-switcher:user:<userId>` — new. Represents "this user's allowed-org / role view". Invalidated when the user's role/ACL/org membership changes (so a permission grant is reflected without waiting for TTL).

## Invalidation

| Trigger (route/command/event) | Where to call deleteByTags | Tags invalidated |
|---|---|---|
| `directory.organization.created` / `.updated` / `.deleted` (emitted by `packages/core/src/modules/directory/commands/organizations.ts`, post-commit after `rebuildHierarchyForTenant`) | Already handled by existing subscriber `directory/subscribers/invalidateOrgScopeCache.ts` (event `directory.organization.*`); extend it to also delete `org-switcher:tenant:${tenantId}` | `org-scope:tenant:<id>` (existing), add `org-switcher:tenant:<id>` |
| `directory.tenant.created` / `.updated` / `.deleted` (`directory/commands/tenants.ts`, post-commit) | New ephemeral subscriber `directory/subscribers/invalidateOrgSwitcherOnTenant.ts` (event `directory.tenant.*`) calling `cache.deleteByTags(['org-switcher:tenant:'+tenantId])` (rename/deactivate affects the superadmin tenant list + active flag) | `org-switcher:tenant:<id>` |
| User role/ACL/org-membership change (auth/RBAC writes; e.g. user-organization assignment) | In the same post-commit hook that already calls `invalidateOrganizationScopeCacheForUser(container, userId)` (organizationScope.ts:78), also delete `org-switcher:user:${userId}`. If that helper has no current caller wired, add a subscriber on the user-org-membership event | `org-switcher:user:<id>` (and reuse `org-scope:user:<id>`) |

All `deleteByTags` calls fire **post-commit** (outside `withAtomicFlush`), consistent with the existing `invalidateOrgScopeCache` subscriber which runs on the persisted, post-write event. TTL (60s) is the backstop for any membership/visibility change that does not emit a directory event.

## Implementation steps

- [ ] In `route.ts`, after `tenantId` resolution (route.ts:130), resolve `cache` from `container` defensively and compute `cacheKey` + `cacheTags` from `auth.sub`, `tenantId`, and the selected-org cookie.
- [ ] Extract the existing compute (route.ts:142..207) into a local `buildPayload()` returning the `response` object; wrap the get/set in `runWithCacheTenant(tenantId, ...)`.
- [ ] Keep `logCrudAccess` (route.ts:209) and the `NextResponse.json` OUTSIDE/AFTER the cache so audit fires every request.
- [ ] (Conservative v1) skip the cache `set` when `actorIsSuperAdmin` to avoid caching cross-tenant tenant lists, OR add tenant-tag invalidation per the table.
- [ ] Extend `directory/subscribers/invalidateOrgScopeCache.ts` to also `deleteByTags(['org-switcher:tenant:'+tenantId])`.
- [ ] Add `directory/subscribers/invalidateOrgSwitcherOnTenant.ts` (event `directory.tenant.*`, `persistent: false`) deleting `org-switcher:tenant:<tenantId>`.
- [ ] Wire `org-switcher:user:<userId>` deletion into the same place that already invalidates `org-scope:user:<userId>` on role/membership change; if none exists, add a subscriber on the user-organization assignment event.
- [ ] `yarn generate` (new subscriber auto-discovery), then `yarn workspace @open-mercato/core build` + `test`.

## Risks & staleness window

- **Staleness window: ≤60s** for changes with no emitted event (e.g. a direct DB org edit). For org/tenant CRUD and role changes done through commands, invalidation is near-immediate (post-commit event) with TTL as backstop.
- **Cross-tenant leakage: none** — keyed and namespaced by `tenantId` via `runWithCacheTenant`, and the key embeds `userId`. Conservative v1 also excludes the superadmin all-tenants list from caching.
- **Not auth/financial data** — this is read-mostly navigation metadata; a brief convergence window is acceptable. `selectedId` correction logic (route.ts:181) still runs inside the cached payload per `(userId, selectedOrg)` key, so per-selection responses stay correct.
- **Audit integrity preserved** — `logCrudAccess` deliberately stays outside the cache.
- Verdict is `good` (not strong-quick-win) because partial infrastructure exists but the route currently bypasses it, the superadmin tenant-list branch needs a deliberate cache decision, and one user-level invalidation hook may need to be located/added.

## Acceptance criteria / tests

- [ ] Unit: a cache double records one `set` for the first `GET` and zero ACL/org `em.find` calls on the immediate second `GET` with identical `(userId, tenantId, selectedOrg)` (extend `directory/utils/__tests__/organizationScopeCache.test.ts` style).
- [ ] Unit: `set` is tagged with all three tags; `deleteByTags(['org-switcher:tenant:<id>'])` (and the reused `org-scope:tenant:<id>`) removes the entry.
- [ ] Integration (extend `directory/__integration__/TC-DIR-004.spec.ts`): create an organization, then `GET /api/directory/organization-switcher` returns the new org within the convergence window (event-driven invalidation), proving no stale tree is served after a write.
- [ ] Integration: two different users in the same tenant get correctly different `items`/`canManage` (key isolation by `userId`).
- [ ] Audit: `audit_logs` still records one access row per request even on cache hits.

## Labels

`feature`, `performance`, `priority-medium`
