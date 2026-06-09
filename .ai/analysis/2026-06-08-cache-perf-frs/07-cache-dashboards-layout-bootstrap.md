> Auto-generated cache-performance Feature Request — candidate 7 of 9
> Endpoint: `GET /api/dashboards/layout` · ROI 72 · Verdict: good
> Source: `packages/core/src/modules/dashboards/api/layout/route.ts`

## Summary

Add a manual, tenant-scoped, tag-invalidated cache to the `GET` handler of `/api/dashboards/layout` (`packages/core/src/modules/dashboards/api/layout/route.ts`). The endpoint is bootstrap-critical (hit on every backoffice app init and on every org switch) and recomputes an expensive per-user view (allowed widget resolution across user-override + role-widget + role-membership + ACL feature filtering, plus a decrypted `User` lookup) on every request.

This is **not** a `makeCrudRoute` endpoint, so the generic CRUD list cache in `packages/shared/src/lib/crud/factory.ts` does **not** cover it. It needs a small, hand-written get-then-set cache modeled on `packages/core/src/modules/customer_accounts/services/domainMappingService.ts`.

**Important nuance that makes this `good` and not a trivial quick win:** the `GET` handler is not a pure read. On first load it creates+persists a default `DashboardLayout`, and on later loads it prunes now-disallowed widgets and re-normalizes order, flushing when `hasChanged` (route.ts:105-143). The cache must store the **already-healed** response so a hit can be served without re-running the heal, and invalidation must fire on every input that changes the healed output — including cross-module role-membership/ACL changes. Design below accounts for this.

## Why (impact)

- **Hotness: very high.** Called on every dashboard render — app init and every organization switch re-fetch it. High read:write ratio; a given user reconfigures their layout rarely but loads it constantly.
- **Cost: high per call.** `GET` performs, per request:
  - `rbac.loadAcl(...)` (route.ts:86)
  - `resolveAllowedWidgetIds(...)` which itself runs `em.findOne(DashboardUserWidgets)` + `findWithDecryption(UserRole, { populate: ['role'] })` + `em.find(DashboardRoleWidgets, { roleId: { $in: ... } })` + per-widget feature filtering (`packages/core/src/modules/dashboards/lib/access.ts:37-107`)
  - `loadScopeLayout` (`em.findOne(DashboardLayout)`, route.ts:33-40, 101)
  - `findOneWithDecryption(User, ...)` for the display label (route.ts:150-156)
  - deep response mapping over all allowed widgets (route.ts:176-188)
  - `loadAllWidgets()` (route.ts:87) is already process-memoized (`widgetEntriesPromise` + `widgetCache` in `packages/core/src/modules/dashboards/lib/widgets.ts`), so it is cheap after warm-up and is **not** the target — the target is the per-user resolution + decryption layer.
- **Est. win:** eliminate ~4 DB round-trips (two of them decryption-decorated) plus widget-set filtering on the hot path for cached `(user, tenant, org)` tuples. On a cache hit the handler returns a serialized payload with zero query-engine/decryption work. Expected p95 reduction on dashboard bootstrap proportional to those round-trips, multiplied across every page load and org switch.

## Current behavior

File: `packages/core/src/modules/dashboards/api/layout/route.ts`

- `GET` (route.ts:70-192):
  - builds `scope = { userId, tenantId, organizationId }` from auth (route.ts:80-84)
  - `acl = await rbac.loadAcl(...)` (route.ts:86)
  - `widgets = await loadAllWidgets()` (route.ts:87)
  - `allowedIds = await resolveAllowedWidgetIds(em, {...}, widgets)` (route.ts:88-98) — the expensive multi-query resolution in `lib/access.ts`
  - `layout = await loadScopeLayout(em, scope)` (route.ts:101)
  - self-heal: creates a default layout on first load and persists it (route.ts:105-122), or prunes disallowed items + renormalizes order and flushes when `hasChanged` (route.ts:123-143)
  - `findOneWithDecryption(User, ...)` for `userName`/`userEmail`/`userLabel` (route.ts:150-161)
  - returns `{ layout: { items }, allowedWidgetIds, canConfigure, context, widgets: [...] }` (route.ts:166-191)
- `PUT` (route.ts:194-270) writes `DashboardLayout.layoutJson` for the scope.
- Sibling writers that change cached inputs:
  - `PATCH /api/dashboards/layout/[itemId]` — mutates one layout item (`packages/core/src/modules/dashboards/api/layout/[itemId]/route.ts:22-81`)
  - `PUT /api/dashboards/roles/widgets` — writes `DashboardRoleWidgets` (`packages/core/src/modules/dashboards/api/roles/widgets/route.ts:87-150`)
  - `PUT /api/dashboards/users/widgets` — writes `DashboardUserWidgets` (`packages/core/src/modules/dashboards/api/users/widgets/route.ts:87-152`)

No caching exists today. There is no `events.ts` in the dashboards module, so invalidation must be wired directly in each writing route (post-commit), not via an event subscriber.

## Proposed cache

Cache the **healed** `GET` response object keyed by the `(userId, tenantId, organizationId)` tuple, tenant-scoped via `runWithCacheTenant`. The handler runs the heal/persist on a miss, then stores the final response; on a hit it returns the stored response directly.

- **Cache KEY shape** (hashed + tenant-namespaced internally by the cache service):
  `dashboards:layout:resp:${userId}:${organizationId ?? 'none'}` — wrapped in `runWithCacheTenant(scope.tenantId, ...)` so the tenant prefix is applied automatically. (userId already encodes tenant membership, but keep org in the key because allowed-widget resolution is org-scoped — see `lib/access.ts:73-75`.)
- **TTL:** `15 * 60_000` (15 min). Justification: layout/role/user-widget changes are infrequent and we invalidate explicitly on every writer below, so TTL is only a backstop for the cross-module ACL/role-membership case (see Invalidation table — those are best-effort). 15 min bounds worst-case staleness if a role-membership change is made through a path we do not hook, without holding stale widget access for a meaningful session.

Code sketch (drop into the `GET` handler, after building `scope`):

```ts
import { runWithCacheTenant } from '@open-mercato/cache'

const cache = container.resolve('cache') as {
  get(key: string): Promise<unknown>
  set(key: string, val: unknown, opts?: { ttl?: number; tags?: string[] }): Promise<void>
  deleteByTags(tags: string[]): Promise<number>
}

const cacheKey = `dashboards:layout:resp:${scope.userId}:${scope.organizationId ?? 'none'}`
const cacheTags = [
  'dashboards:layout',
  `dashboards:layout:user:${scope.userId}`,
  scope.organizationId ? `dashboards:layout:org:${scope.organizationId}` : 'dashboards:layout:org:none',
  `rbac:user:${scope.userId}`, // REUSED: flushed by rbacService on every role/ACL change — closes the cross-module gap for free
]

const cached = await runWithCacheTenant(scope.tenantId, () => cache.get(cacheKey))
if (cached) return NextResponse.json(cached)

// ... existing resolution + self-heal (loadAcl, loadAllWidgets, resolveAllowedWidgetIds,
//     loadScopeLayout, persist/flush, findOneWithDecryption(User), build `response`) ...

await runWithCacheTenant(scope.tenantId, () =>
  cache.set(cacheKey, response, { ttl: 15 * 60_000, tags: cacheTags }),
)
return NextResponse.json(response)
```

Note: the heal/persist still runs on every miss (i.e., first request after any invalidation), so the default-layout creation and pruning are never skipped — the cache only short-circuits steady-state repeat reads.

## Cache tags

- `dashboards:layout` — coarse tag on every cached layout response; lets a broad widget-catalog or module-level change blow away all dashboard layout caches at once.
- `dashboards:layout:user:${userId}` — all cached responses for one user (currently one per org); invalidated by user-scoped layout/override writes and by that user's role-membership/ACL changes.
- `dashboards:layout:org:${organizationId}` (or `dashboards:layout:org:none`) — all cached responses scoped to one organization; invalidated by org-scoped role-widget assignment changes that affect every member.

## Invalidation

All `deleteByTags` calls MUST run **post-commit** (after `await em.flush()` / `em.remove(...).flush()`), wrapped in `runWithCacheTenant(scope.tenantId, ...)`, and be best-effort (try/catch, TTL is the backstop) — same contract as `invalidateCacheFor` in `domainMappingService.ts:479-488`.

| Trigger (route/command/event) | Where to call `deleteByTags` | Tags invalidated |
|---|---|---|
| `PUT /api/dashboards/layout` (`api/layout/route.ts` `PUT`, after `await em.flush()` at line 267) | end of `PUT`, post-flush | `dashboards:layout:user:${scope.userId}` |
| `PATCH /api/dashboards/layout/[itemId]` (`api/layout/[itemId]/route.ts`, after `await em.flush()` at line 78) | end of `PATCH`, post-flush | `dashboards:layout:user:${scope.userId}` |
| `PUT /api/dashboards/users/widgets` (`api/users/widgets/route.ts` `PUT`, after each `flush`/`remove(...).flush()` at lines 132/149) | post-flush; use the **target** `parsed.data.userId` (admin edits another user) | `dashboards:layout:user:${parsed.data.userId}` |
| `PUT /api/dashboards/roles/widgets` (`api/roles/widgets/route.ts` `PUT`, after `flush`/`remove(...).flush()` at lines 131/147) | post-flush; role change affects all members in scope | `dashboards:layout:org:${organizationId ?? 'none'}` **and** `dashboards:layout` (role membership per user is not known here, so fall back to the org-wide + coarse tags) |
| Role-membership / ACL feature change (cross-module: `auth` UserRole / RBAC grants) | **Already flushed** — the cached entry carries the existing `rbac:user:${userId}` tag, which `auth/services/rbacService.ts` flushes on every user/role ACL write (`deleteCacheByTags` covers the current, global, and hinted tenant namespaces, `rbacService.ts:167-187`). No new wiring; no subscriber needed. | `rbac:user:${userId}` (existing) |

Rationale for the role-widget writer using the coarse + org tags: `DashboardRoleWidgets` changes affect every user holding that role, and the writer does not enumerate members. Invalidating `dashboards:layout:org:${organizationId}` (members share the org scope) plus the coarse `dashboards:layout` tag guarantees correctness; the blast radius is acceptable because role-widget edits are rare admin actions.

## Implementation steps

- [ ] In `api/layout/route.ts` `GET`, resolve `cache` from the existing `container`, build `cacheKey` + `cacheTags`, add the `runWithCacheTenant` get-then-set around the existing resolution/heal/response build (sketch above). Serve cached payload on hit; keep the heal/persist on miss.
- [ ] Add post-commit, best-effort `deleteByTags` (wrapped in `runWithCacheTenant(tenantId, ...)`, try/catch) to: `api/layout/route.ts` `PUT`, `api/layout/[itemId]/route.ts` `PATCH`, `api/users/widgets/route.ts` `PUT`, `api/roles/widgets/route.ts` `PUT` — using the tag mapping in the Invalidation table.
- [ ] Extract a shared helper (e.g. `lib/cacheKeys.ts` in the dashboards module) exporting the key builder and tag builders so the GET and all writers stay in sync (single source of truth for tag strings).
- [ ] Confirm no PII leaks across tenants: key+tags are tenant-scoped via `runWithCacheTenant`; the cached payload contains the user's own decrypted name/email only, never another tenant's data.
- [ ] Gate behind an env flag if desired for staged rollout (optional; the per-endpoint cache is low-risk enough to ship on).
- [ ] Run `yarn workspace @open-mercato/core test` and add the integration test below.

## Risks & staleness window

- **Self-heal skipped on hit (acceptable):** because invalidation fires whenever an input that the heal depends on changes (layout, user-override, role-widget assignment), a cache hit only occurs when the healed output is still valid. The first request after any change is a miss and re-runs the heal/persist.
- **Cross-module convergence window (double-checked):** role/ACL changes flush the reused `rbac:user:${userId}` tag immediately, so the previous-role widget set disappears on the next load — no 15-min wait. Residual edge: a superadmin editing a user's ACL from *another tenant's* request context flushes in the actor's + global namespaces, which may miss the target tenant's namespace; bounded by the 15 min TTL. Either way widget *visibility* is cosmetic, not a security boundary — widget data endpoints (`api/widgets/data/route.ts`) re-check ACL independently, so a stale `allowedWidgetIds` can never expose data the user is not entitled to.
- **Module-local writes need inline flushes (unavoidable, but small):** the dashboards module has no commands and no events, so its four write routes cannot piggyback on command-bus tags — the four post-flush `deleteByTags` calls in the table above are the minimal possible wiring, kept in one shared `lib/cacheKeys.ts` helper. These run inside the mutating request, so the tenant namespace matches the GET-side entries automatically.
- **Not financial/stock/auth data** — short staleness is tolerable per the cache-safety contract (`packages/cache/AGENTS.md` → Consistency vs commit timing).
- Invalidation is best-effort; TTL guarantees eventual convergence.

## Acceptance criteria / tests

- [ ] `GET /api/dashboards/layout` returns identical payloads on a cold call vs a warm (cached) call for the same `(user, tenant, org)`.
- [ ] After `PUT /api/dashboards/layout`, the next `GET` reflects the new layout (cache invalidated for `dashboards:layout:user:${userId}`).
- [ ] After `PATCH /api/dashboards/layout/[itemId]`, the next `GET` reflects the new size/settings.
- [ ] After `PUT /api/dashboards/users/widgets` for a target user, that target user's next `GET` reflects the new `allowedWidgetIds` (invalidated by target userId, not the admin's userId).
- [ ] After `PUT /api/dashboards/roles/widgets`, affected members' next `GET` reflects the change (org-tag + coarse invalidation).
- [ ] Tenant isolation: a cached entry for tenant A is never served to a request in tenant B (assert distinct `runWithCacheTenant` namespaces).
- [ ] First load for a brand-new user still creates+persists the default `DashboardLayout` (heal runs on the miss path); a subsequent load is served from cache without re-persisting.
- [ ] Integration test colocated at `packages/core/src/modules/dashboards/__integration__/` (per the per-module integration-test convention), creating fixtures via API and cleaning up in teardown.

## Labels

`feature`, `performance`, `priority-medium`

