> Cache-performance Feature Request — round-2 candidate 14
> Endpoint: `GET /api/auth/roles` · Verdict: good
> Source: `packages/core/src/modules/auth/api/roles/route.ts`
> Added 2026-06-09 (round 2): verified non-cached; invalidation piggybacks on existing `crud:auth.role:*` + `crud:auth.user:*` tags, with `rbac:tenant:*` as a bonus axis.

## Summary

The roles list backs the admin roles page and role-select dropdowns in user management. The custom GET is query-heavy per call: `em.findAndCount(Role)` + a `findWithDecryption(UserRole)` sweep to compute per-role **user counts** + `findWithDecryption(Tenant)` for tenant names + `loadCustomFieldValues` for role CFs (`route.ts:193-237`). Cache the assembled page per `(tenant, query-shape)` with a 120 s TTL, tagged with the **already-flushed** `crud:auth.role:*` and `crud:auth.user:*` collection tags so role CRUD and user-role grants invalidate it via the command bus, with no new wiring.

## Why (impact)

- **Hotness — medium** (admin surface, but bursty: every user-management session reloads it repeatedly).
- **Cost — high per call**: 3-4 round-trips, two decryption-decorated; user-count sweep grows with user count.
- **Est. win** — the expensive user-count sweep collapses to a cache `get` for the window.

## Current behavior

`api/roles/route.ts:133-268` — custom handler (not `makeCrudRoute`): `em.findAndCount(Role, where, { limit, offset })` (route.ts:193), `findWithDecryption(UserRole, …)` per-role user counting (route.ts:197-202), `findWithDecryption(Tenant, …)` (route.ts:210), `loadCustomFieldValues(E.auth.role, …)` (route.ts:230-237). No module cache on this path. Writes: role CRUD via commands with `resourceKind: 'auth.role'` (`commands/roles.ts:188/385/506`); user-role grants via `auth.users.*` commands (`commands/users.ts`, resourceKind `auth.user`) which also flush `rbac:user:*` / `rbac:tenant:*` tags.

## Proposed cache

```ts
import { buildCollectionTags, isCrudCacheEnabled } from '@open-mercato/shared/lib/crud/cache'

const ROLES_LIST_TTL_MS = 120_000

const cacheEnabled = isCrudCacheEnabled()
const cache = cacheEnabled ? (() => { try { return container.resolve('cache') } catch { return null } })() : null
const cacheKey = `auth:roles:list:${querySignature /* page,pageSize,search,sort */}`

if (cache) {
  const cached = await cache.get(cacheKey)
  if (cached) return NextResponse.json(cached)
}
// ... existing queries + assembly → payload ...
if (cache) {
  try {
    await cache.set(cacheKey, payload, {
      ttl: ROLES_LIST_TTL_MS,
      tags: [
        ...buildCollectionTags('auth.role', tenantId, [null]),  // roles are tenant-level (org:null)
        ...buildCollectionTags('auth.user', tenantId, [null]),  // user-role grants change the userCount column
        `rbac:tenant:${tenantId}`,                              // existing rbac flush on role-ACL writes (bonus axis)
      ],
    })
  } catch {}
}
return NextResponse.json(payload)
```

## Cache tags

- `crud:auth.role:tenant:<T>:org:null:collection` — **reused**, flushed by the command bus on `auth.roles.create/update/delete` execute/undo.
- `crud:auth.user:tenant:<T>:org:null:collection` — **reused**, flushed on `auth.users.*` commands; covers the per-role `userCount` changing when a user is granted/revoked a role or deleted.
- `rbac:tenant:<T>` — **reused**, flushed by `auth/api/roles/acl/route.ts:254` on role-ACL writes (`rbacService.deleteCacheByTags` covers current + global + hinted namespaces).

No new tags. No subscribers.

## Invalidation

| Trigger | Where the flush already happens | Tags |
|---|---|---|
| Role create/update/delete (commands, `auth.role`) | command bus — existing | `crud:auth.role:…:collection` |
| User create/update/delete + role grant/revoke (commands, `auth.user`) | command bus — existing | `crud:auth.user:…:collection` |
| Role ACL feature change | `roles/acl` route — existing | `rbac:tenant:<T>` |
| Undo/redo | command bus — existing | same crud tags |

**Nothing to add on the write side.**

## Safety / non-invalidation risks (double-checked)

- **Gate:** the `crud:*` flushes no-op while `ENABLE_CRUD_API_CACHE` is off — cache gated on `isCrudCacheEnabled()`. (`rbac:tenant:*` flushes are NOT flag-gated, but alone they don't cover role/user CRUD — so the flag gate stands.)
- **Org axis of grants:** verify during implementation whether `auth.users.*` command metadata records an `organizationId`; if it does, the flush targets `org:<O>` while this entry is tagged `org:null` — in that case also tag with the actor org axis or rely on the 120 s TTL. List this as an explicit implementation checkpoint, not an assumption.
- **No ACL bypass:** the cached payload is the same RBAC-guarded response the route returns today; the route's `requireFeatures` guard runs before the cache lookup. The cache stores per-tenant data only; key carries the query shape, namespace carries the tenant.
- **Role custom fields:** CF edits on roles route through `auth.roles.update` → covered by the role collection tag.
- **120 s TTL backstop** for anything missed (e.g. direct SQL).

## Implementation steps

- [ ] Add the gated get-then-set to `api/roles/route.ts`; assemble the response into a `payload` first.
- [ ] Verify the org-axis of `auth.users.*` command metadata (see Safety) and adjust tags if needed.
- [ ] Unit tests: key axes; tag shapes; flag-off ⇒ no caching.
- [ ] Integration: grant a role to a user → roles list `userCount` updates immediately; create/delete a role → list updates immediately.
- [ ] `yarn workspace @open-mercato/core build && test`.

## Labels

`feature`, `performance`, `priority-low`
