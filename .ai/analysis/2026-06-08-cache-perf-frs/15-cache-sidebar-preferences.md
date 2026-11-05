> Cache-performance Feature Request — round-2 candidate 15
> Endpoint: `GET /api/auth/sidebar/preferences` · Verdict: strong-quick-win
> Source: `packages/core/src/modules/auth/api/sidebar/preferences/route.ts`
> Added 2026-06-09 (round 2): the GET is uncached, but its PUT **already flushes a complete tag set** (`nav:sidebar:user/role/scope`) — caching the GET with those exact tags needs zero new flush wiring. (The sibling `GET /api/auth/admin/nav` is already cached on these tags — `nav.ts:138/166` — proving the pattern.)

## Summary

The sidebar-preferences GET feeds sidebar customization state on backend shell bootstrap. For admins (`canApplyToRoles=true`) it is query-heavy: `findWithDecryption(Role)` for all roles plus a per-role `RoleSidebarPreference` lookup, plus the user-scoped preference row (`route.ts:100-117, 206-226`).

The module already defines the freshness contract: the PUT handler flushes `nav:sidebar:user:<userId>`, `nav:sidebar:scope:<userId>:<tenantId>:<orgId>:<locale>`, and `nav:sidebar:role:<roleId>` post-commit (`route.ts:488-503`), and the already-cached `GET /api/auth/admin/nav` consumes these same tags. This FR simply caches the preferences GET payload under the same tags — the existing flush wiring invalidates it for free, and the two nav surfaces stay consistent by construction.

## Why (impact)

- **Hotness — high**: part of backend shell bootstrap; re-fetched on sidebar customization UI opens.
- **Cost** — for admins: roles enumeration with decryption + N per-role preference lookups; for everyone: user preference + role payload assembly.
- **Est. win** — bootstrap reads become a cache `get`; the N+1 role-preference sweep disappears from the hot path.

## Current behavior

`api/sidebar/preferences/route.ts` — GET: `loadSidebarPreference` (`em.findOne(SidebarPreference)`), `loadRolesPayload` (`findWithDecryption(Role)` + `em.findOne(RoleSidebarPreference)` per role), assembly. No `cache.get`/`cache.set` on the GET path (verified). PUT: writes user/role preferences and **already** flushes the `nav:sidebar:*` tags listed above. The admin-nav GET (`api/admin/nav.ts:138/166`) already caches its payload with `nav:sidebar:role:<id>`-family tags.

## Proposed cache

```ts
const SIDEBAR_PREFS_TTL_MS = 15 * 60_000 // backstop; the PUT flush carries correctness

const cache = (() => { try { return container.resolve('cache') } catch { return null } })()
const cacheKey = `nav:sidebar:prefs:${auth.sub}:${auth.orgId ?? 'null'}:${locale}`
const cacheTags = [
  `nav:sidebar:user:${auth.sub}`,
  `nav:sidebar:scope:${auth.sub}:${auth.tenantId ?? 'null'}:${auth.orgId ?? 'null'}:${locale}`,
  ...userRoleIds.map((roleId) => `nav:sidebar:role:${roleId}`),
]

if (cache) {
  const cached = await cache.get(cacheKey)
  if (cached) return NextResponse.json(cached)
}
// ... existing load + assembly → payload ...
if (cache) {
  try { await cache.set(cacheKey, payload, { ttl: SIDEBAR_PREFS_TTL_MS, tags: cacheTags }) } catch {}
}
return NextResponse.json(payload)
```

Note: **not** gated on `ENABLE_CRUD_API_CACHE` — the `nav:sidebar:*` flushes in the PUT are unconditional module-local calls, independent of the CRUD-cache flag.

## Cache tags

All **reused** — the PUT already flushes every one of them (`route.ts:488-503`):

- `nav:sidebar:user:<userId>` — user-scoped preference writes.
- `nav:sidebar:scope:<userId>:<tenantId>:<orgId>:<locale>` — scope-precise variant.
- `nav:sidebar:role:<roleId>` — role-preference writes (flushed for each updated/cleared role).

## Invalidation

| Trigger | Where the flush already happens | Tags |
|---|---|---|
| User saves sidebar prefs (PUT, user scope) | existing flush `route.ts:494-503` | `nav:sidebar:user:<U>` + scope tag |
| Admin saves/clears role sidebar prefs (PUT, role scope) | existing flush `route.ts:488-492` | `nav:sidebar:role:<R>` per role |
| Role created/deleted, user role membership change | not flushed by nav tags — **TTL backstop (15 min)**; affects only which roles appear in the admin's roles payload | (TTL) |

**Nothing to add on the write side.**

## Safety / non-invalidation risks (double-checked)

- **Namespace matching:** both the PUT flush and the GET set run inside mutating/reading requests of the same tenant — the dispatcher's `runWithCacheTenant(auth.tenantId)` wrapper puts them in the same namespace. (Same contract the already-shipped admin-nav cache relies on.)
- **Role-membership drift:** a user gaining/losing a role changes which `nav:sidebar:role:*` tags their entry *should* carry; the stale entry survives ≤ TTL. Cosmetic (sidebar layout preference), and rbac changes also flush `rbac:user:<U>` — optionally carry that tag too to close the window for free.
- **Per-user + locale key**: preferences are personal; `userId` + `locale` + org are all in the key.
- **Never cache 401 branches; no-op without cache service.**
- **Locale axis**: the PUT flushes the scope tag with the writing locale; the broad `nav:sidebar:user:<U>` tag covers cross-locale variants — keep it on every entry (it is).

## Implementation steps

- [ ] Add the get-then-set to the GET handler; assemble the response into a `payload` first; collect `userRoleIds` before tagging.
- [ ] Optionally add `rbac:user:${auth.sub}` to the tag list (existing rbac flush closes the role-membership window).
- [ ] Unit tests: tags exactly match the PUT's flush strings; per-user/locale key isolation.
- [ ] Integration: save sidebar prefs → next GET reflects them immediately (existing flush); admin role-pref save → affected users' next GET reflects it.
- [ ] `yarn workspace @open-mercato/core build && test`.

## Labels

`feature`, `performance`, `priority-low`
