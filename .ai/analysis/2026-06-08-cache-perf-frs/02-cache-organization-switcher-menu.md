> Auto-generated cache-performance Feature Request — candidate 2 of 9
> Endpoint: `GET /api/directory/organization-switcher` · ROI 84 · Verdict: good
> Source: `packages/core/src/modules/directory/api/organization-switcher/route.ts`
> Revised 2026-06-09: all invalidation now rides **existing flushed tags** (`org-scope:tenant:*`, `rbac:user:*`); the previously proposed new tags + tenant-event subscriber are dropped. Includes one safety fix to the existing org-scope subscriber.

## Summary

Add a tenant-scoped, get-then-set response cache to `GET /api/directory/organization-switcher` (`packages/core/src/modules/directory/api/organization-switcher/route.ts`). The handler is invoked on essentially every backend page load (the global `OrganizationSwitcher` chrome component) yet recomputes a stable org tree + RBAC scope on each call. Cache the full response payload keyed by `(userId, tenantId, selectedOrg)` with a 60 s TTL and **invalidate via two tags that are already flushed today**:

- `org-scope:tenant:<tenantId>` — flushed by the existing subscriber `directory/subscribers/invalidateOrgScopeCache.ts` on every `directory.organization.*` event.
- `rbac:user:<userId>` — flushed by `auth/services/rbacService.ts` on every role/ACL change for the user (`deleteCacheByTags` flushes across the current, global, and hinted tenant namespaces).

No new tags, no new subscribers. One safety fix is required (below) so the existing org-scope flush always lands in the right tenant namespace.

## Why (impact)

- **Hotness: very high.** `apps/mercato/src/components/OrganizationSwitcher.tsx:195` calls this URL on mount of the backend header chrome (every backend navigation that remounts the switcher); also fetched by `api_keys/backend/api-keys/create/page.tsx:39` and `customer_accounts/backend/customer_accounts/settings/domain/page.tsx:97`.
- **Cost: moderate-to-heavy and compounding.** Per call: `em.find(Tenant)` (superadmin path), `rbac.loadAcl` (route.ts:142), `rbac.userHasAllFeatures` (route.ts:147), `em.find(Organization)` (route.ts:157), `computeHierarchyForOrganizations` (`hierarchy.ts:37`), then `resolveOrganizationScope` (route.ts:166) which does a **second** `rbac.loadAcl` (organizationScope.ts:226) plus another `em.find(Organization)` (organizationScope.ts:163), and finally `buildOrganizationMenu`. ~2 ACL loads + 2 org-table scans + tree compute on every page view.
- **Est. win:** eliminates 2 RBAC ACL loads, 2 `organizations` scans, and the hierarchy/menu compute for the ~60 s window after the first hit per user — nearly every navigation within a session becomes a single cache read.

## Current behavior

`packages/core/src/modules/directory/api/organization-switcher/route.ts`: see line references above. There is **no response cache** today. A partial cache exists for `resolveOrganizationScope` (the `org-scope:*` cache in `organizationScope.ts`, default-off behind `OM_ORG_SCOPE_CACHE_TTL_MS`), but this route bypasses it by calling the raw function.

The invalidation infrastructure, however, **already exists**:
- `directory/subscribers/invalidateOrgScopeCache.ts` (event `directory.organization.*`, ephemeral) flushes `org-scope:tenant:<tenantId>` on every org create/update/delete.
- `invalidateOrganizationScopeCacheForUser(container, userId)` (`organizationScope.ts:78`) flushes `org-scope:user:<userId>` on membership changes.
- `rbacService` flushes `rbac:user:<userId>` on every user/role ACL write (`auth/commands/users.ts:1052`, `auth/api/users/acl/route.ts:243`, `auth/api/roles/acl/route.ts:254` flushes `rbac:tenant:<tenantId>`).

## Proposed cache

Wrap the existing compute in a get-then-set around the **assembled response object**. `logCrudAccess` must still run on every request (audit must not be cached), so cache only the payload, not the side effect. The dispatcher's `runWithCacheTenant(auth.tenantId, …)` wrapper provides the tenant namespace.

Key: `org-switcher:v1:<userId>:<tenantId>:<selectedOrg|none|all>`

```ts
const ORG_SWITCHER_TTL_MS = 60_000

const cache = (() => { try { return container.resolve('cache') } catch { return null } })()
const selectedKeyPart = requestedAll ? 'all' : (rawSelected ?? 'none')
const cacheKey = `org-switcher:v1:${auth.sub}:${tenantId}:${selectedKeyPart}`
const cacheTags = [
  `org-scope:tenant:${tenantId}`, // existing org-mutation flush — zero new wiring
  `rbac:user:${auth.sub}`,        // existing role/ACL-change flush — zero new wiring
]

// Conservative v1: skip the cache entirely for superadmins (cross-tenant tenant list).
if (cache && !actorIsSuperAdmin) {
  const hit = await cache.get(cacheKey)
  if (hit && typeof hit === 'object') { await logCrudAccess(...); return NextResponse.json(hit) }
}
const response = await buildPayload() // existing route.ts:142..207 compute
if (cache && !actorIsSuperAdmin) {
  try { await cache.set(cacheKey, response, { ttl: ORG_SWITCHER_TTL_MS, tags: cacheTags }) } catch {}
}
await logCrudAccess(...) // audit ALWAYS runs, never cached
return NextResponse.json(response)
```

## Cache tags

- `org-scope:tenant:<tenantId>` — **reused.** Flushed by the existing `invalidateOrgScopeCache` subscriber on `directory.organization.*`; covers org create/update/delete and hierarchy rebuilds.
- `rbac:user:<userId>` — **reused.** Flushed by `rbacService.deleteCacheByTags` on user-ACL and role-grant changes; covers "user's allowed-org / role view changed". `rbacService` flushes across current + global + hinted tenant namespaces (`rbacService.ts:167-187`), so it reaches the request-namespace entry.

## Invalidation

| Trigger | Where the flush already happens | Tags |
|---|---|---|
| `directory.organization.created/updated/deleted` | existing subscriber `directory/subscribers/invalidateOrgScopeCache.ts` | `org-scope:tenant:<T>` |
| User role/ACL/membership change | existing `rbacService` flushes (`auth/commands/users.ts:1051-1052`, ACL routes) | `rbac:user:<U>` |
| Tenant rename/deactivate (superadmin tenant list) | not hooked — superadmin path is **not cached** (conservative v1); 60 s TTL backstops the non-superadmin `tenantId`-derived fields | (TTL) |

**Required safety fix (small, part of this FR):** the existing subscriber calls `cache.deleteByTags(['org-scope:tenant:…'])` **without** `runWithCacheTenant(payload.tenantId, …)`. When the subscriber runs synchronously inside the request it inherits the request's tenant namespace and matches; when it runs from a queue/async context it lands in the `global` namespace and silently misses tenant-scoped entries. Wrap the subscriber's flush in `runWithCacheTenant(tenantId, …)` (and the same in `invalidateOrganizationScopeCacheForUser/Tenant`) so the flush always matches request-namespace entries. This also hardens the existing org-scope cache, not just this FR.

## Safety / non-invalidation risks (double-checked)

- **Staleness window ≤ 60 s** for changes with no flushed tag (e.g. direct DB org edit, tenant rename affecting `tenants[]` metadata). Org/role changes through commands invalidate near-immediately.
- **Cross-tenant superadmin ACL edits:** `rbac:user:<U>` is flushed in the actor's + global namespaces (+hints); if a superadmin in tenant A edits a user of tenant B, the tenant-B-namespace entry may survive until TTL. Accepted: 60 s.
- **Cross-tenant leakage: none** — key embeds `userId` + `tenantId`; namespace isolation via the dispatcher wrapper. Superadmin responses are never cached in v1.
- **Audit integrity preserved** — `logCrudAccess` stays outside the cache.
- **Not auth-enforcing data:** the switcher payload is navigation metadata; actual access checks re-run server-side per request elsewhere.

## Implementation steps

- [ ] In `route.ts`, after `tenantId` resolution (route.ts:130), resolve `cache` defensively; compute `cacheKey` + the two reused tags; extract the existing compute into `buildPayload()`; add the get-then-set, skipping cache for superadmins.
- [ ] Keep `logCrudAccess` (route.ts:209) outside/after the cache so audit fires on every request.
- [ ] Safety fix: wrap the flushes in `directory/subscribers/invalidateOrgScopeCache.ts` and `invalidateOrganizationScopeCacheForUser/Tenant` (`organizationScope.ts:78-102`) in `runWithCacheTenant(tenantId, …)`.
- [ ] `yarn workspace @open-mercato/core build` + `test`.

## Acceptance criteria / tests

- [ ] A cache double records one `set` for the first `GET` and zero ACL/org `em.find` calls on the immediate second `GET` with identical `(userId, tenantId, selectedOrg)`.
- [ ] `set` is tagged `org-scope:tenant:<T>` + `rbac:user:<U>`; `deleteByTags` on either removes the entry.
- [ ] Integration (extend `directory/__integration__/TC-DIR-004.spec.ts`): create an organization → `GET` returns the new org promptly (existing subscriber flush, not TTL).
- [ ] Granting/revoking a role feature for a user → that user's next `GET` reflects new `canManage`/`items` (rbac tag flush).
- [ ] Two different users in the same tenant get correctly different `items`/`canManage` (key isolation by `userId`).
- [ ] Superadmin requests are never cached.
- [ ] Audit: `audit_logs` still records one access row per request even on cache hits.

## Labels

`feature`, `performance`, `priority-medium`
