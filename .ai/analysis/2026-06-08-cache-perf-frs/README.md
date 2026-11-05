# Cache Performance — Feature Request Backlog

> Generated 2026-06-08 by a multi-agent workflow (4 discovery lanes → 9 deep-dive agents).
> Revised 2026-06-09: invalidation reworked to **connect to already-flushed tags** instead of adding bespoke per-entity flush wiring; overlap with the existing CRUD API cache audited (2 FRs rescoped/demoted); 7 new candidates added (FR 10–16).
> Goal: highest-ROI API endpoints to cache **with tag-based invalidation** so data stays fresh. Quick wins, most-used read paths.

## How caching works here (read first)

- **Cache service**: `container.resolve('cache')` — API `get/set(key,val,{ttl,tags})/deleteByTags(tags[])`. No `getOrSet`; do manual get-then-set.
- **Tenant scoping is automatic in API handlers**: the API dispatcher wraps every route handler in `runWithCacheTenant(auth.tenantId, …)` (`apps/mercato/src/app/api/[...slug]/route.ts:382`). Keys and tags are SHA1-hashed under a `tenant:<id>:` namespace (`packages/cache/src/service.ts`), so cross-tenant reads are impossible even when the literal key omits the tenant.
- **Generic CRUD list cache already exists** (`packages/shared/src/lib/crud/factory.ts`) but is gated OFF behind env `ENABLE_CRUD_API_CACHE`. It only covers `makeCrudRoute` GETs. **Custom GET handlers bypass it entirely** — those are the manual-cache quick wins below.

## Invalidation doctrine: connect to already-flushed tags (do NOT add bespoke flush wiring)

The platform already flushes a rich set of tags post-commit. A new manual cache should **carry one of these existing tags** so it is invalidated for free — new subscribers or per-write `deleteByTags` calls are a last resort, not the default.

**Tags that are already flushed today:**

| Tag (literal) | Flushed by | When |
|---|---|---|
| `crud:<module>.<entity>:tenant:<T>:org:<O>:collection` | `makeCrudRoute` POST/PUT/DELETE (`factory.ts:2266/2597/2882`) **and** the command bus after every command execute/undo (`packages/shared/src/lib/commands/command-bus.ts:610/642`, resource derived from `resourceKind` + `deriveResourceFromCommandId` + `context.cacheAliases`) | post-commit, every domain write |
| `crud:<module>.<entity>:tenant:<T>:record:<id>` | same | post-commit |
| `org-scope:tenant:<T>`, `org-scope:user:<U>` | `directory/subscribers/invalidateOrgScopeCache.ts` + `invalidateOrganizationScopeCacheForUser/Tenant` | org create/update/delete, membership change |
| `rbac:user:<U>`, `rbac:tenant:<T>`, `rbac:org:<O>`, `rbac:all` | `auth/services/rbacService.ts` (`deleteCacheByTags` flushes across current + global + hinted tenant namespaces) | role/user ACL change |
| `nav:sidebar:user:<U>`, `nav:sidebar:role:<R>`, `nav:sidebar:scope:<U>:<T>:<O>:<locale>` | `auth/api/sidebar/preferences/route.ts` PUT (lines 488–503) | sidebar preference write |
| `inbox_ops:counts:<T>` | `invalidateCountsCache` at 9 write sites (7 routes + extraction worker + ai-tools) | every proposal mutation |
| `customers:dictionaries:<T>:<kind>[…:org:<O>]` | `customers/api/dictionaries/cache.ts` `invalidateDictionaryCache` | customer dictionary entry write |
| `feature_toggles:identifier:<id>`, `module-config:module:<id>`, `domain_routing`, `perspectives:*`, `custom-entity:*`, `nav:entities:<T>` | their owning modules | respective writes |

**Two safety rules that make piggybacking correct:**

1. **The `ENABLE_CRUD_API_CACHE` gate.** Every `crud:*` flush goes through `invalidateCrudCache`, which **no-ops when the flag is off** (`packages/shared/src/lib/crud/cache.ts:180`). Therefore any manual cache that carries `crud:*` tags MUST itself be gated on `isCrudCacheEnabled()` — when the flag is off, skip caching (fall back to uncached behavior or a very short TTL-only cache). Otherwise entries would never be invalidated and would serve stale data for the full TTL.
2. **Tenant-namespace matching.** Tags only match within the same tenant namespace. Request-side `get`/`set` inherit the namespace from the dispatcher wrapper; `invalidateCrudCache` wraps its flush in `runWithCacheTenant(tenantId, …)` explicitly — these match. But a flush issued from a **subscriber or queue worker** without an explicit `runWithCacheTenant(payload.tenantId, …)` wrapper lands in the `global` namespace and silently misses tenant-scoped entries. Any subscriber-based flush MUST wrap explicitly (FR 02 fixes one such latent gap in the existing org-scope subscriber).

**Universal safety backstops (every FR below assumes these):**

- Always set a TTL. Tags carry correctness; TTL bounds staleness when a flush is missed (e.g. a command whose metadata lacks `organizationId` flushes only the `org:null` collection tag, leaving org-scoped entries until TTL; or an out-of-band SQL write).
- Never cache error/early-return responses (401/400/empty-auth branches).
- Per-user payloads MUST include `userId` in the cache key; per-org payloads MUST include the org axis in key or tags.
- Cache resolution is defensive (`try { container.resolve('cache') } catch { null }`) — behavior with no cache service is byte-identical to today.
- Audit side effects (`logCrudAccess`) always run outside the cached block.

## Overlap audit (vs the existing CRUD API cache and module caches)

- **FR 05 `GET /api/dictionaries` — demoted (skip).** The hot dictionary-select surface is the **customers** module's dictionary API, which is **already cached** (`customers:dictionaries:*`, 5 min TTL + invalidation). The `dictionaries`-module list endpoint mostly serves the admin manager page — low traffic, not worth the change. Issue #2910 recommended for closure.
- **FR 08 `GET /api/catalog/offers` — rescoped.** The originally proposed decoration cache (snapshot store + 4-event subscriber + price→product mapping) is exactly the bespoke complexity this backlog now avoids. v1 is reduced to extending FR 06's `cacheAliases` mechanism (`['catalog.offer']` on price/variant commands) so the generic CRUD offers list cache stays correct; the decoration cache is explicitly deferred.
- `catalog/variants` and `catalog/prices` (from the original candidate ranking) are `makeCrudRoute` reads — enabling `ENABLE_CRUD_API_CACHE` (FR 06) covers them; **no separate FR is warranted**.
- `GET /api/auth/admin/nav` and `GET /api/entities/definitions` are **already cached** (`nav.ts:138/166`; `definitions.cache.ts`) — disqualified as new candidates.

## FR issues (deep-analyzed, filed)

Tracked in GitHub (proposed in PR #2905):

| # | ROI | Endpoint | Verdict | Invalidation source | Issue | FR file |
|---|---|---|---|---|---|---|
| 1 | 86 | `GET /api/catalog/categories` | strong-quick-win | existing `crud:catalog.category:*` tags (command bus) | #2906 | [01](./01-cache-catalog-categories-list.md) |
| 2 | 84 | `GET /api/directory/organization-switcher` | good | existing `org-scope:tenant:*` + `rbac:user:*` tags | #2907 | [02](./02-cache-organization-switcher-menu.md) |
| 3 | 82 | `GET /api/notifications/unread-count` | good | TTL-only v1 (no command-bus writes exist) | #2908 | [03](./03-cache-notifications-unread-count.md) |
| 4 | 82 | `GET /api/inbox_ops/proposals` | good | existing `inbox_ops:counts:<T>` tag (9 sites already flush it) | #2909 | [04](./04-cache-inbox-ops-proposals-list.md) |
| 5 | 82 | `GET /api/dictionaries` | **skip — overlap** | n/a (hot surface already cached in customers module) | #2910 | [05](./05-cache-dictionaries-list.md) |
| 6 | 78 | `GET /api/catalog/products` | good | enable CRUD cache + `cacheAliases` cross-resource fix | #2911 | [06](./06-enable-and-fix-catalog-products-list-cache.md) |
| 7 | 72 | `GET /api/dashboards/layout` | good | module-local writes (4 routes) + existing `rbac:user:*` tag | #2912 | [07](./07-cache-dashboards-layout-bootstrap.md) |
| 8 | 72 | `GET /api/catalog/offers` | **rescoped** | folded into FR 06's `cacheAliases` mechanism | #2913 | [08](./08-catalog-offers-decoration-cache.md) |
| 9 | 58 | `GET /api/messages` | good | existing `crud:messages.message:*` tags (command bus) | #2914 | [09](./09-cache-messages-list-per-user.md) |

## New candidates (round 2 — verified non-cached, invalidation piggybacks on existing tags)

| # | Endpoint | Hotness | Invalidation source | Issue | FR file |
|---|---|---|---|---|---|
| 10 | `GET /api/messages/unread-count` | polled every 5 s (`useMessagesPoll.ts`) | existing `crud:messages.message:*` tags | #2915 | [10](./10-cache-messages-unread-count.md) |
| 11 | `GET /api/notifications` (list) | polled every 5 s (`useNotificationsPoll.ts`) | TTL-only v1 (no command-bus writes) | #2916 | [11](./11-cache-notifications-list.md) |
| 12 | `GET /api/dictionaries/[dictionaryId]/entries` | every dictionary-backed custom-field select (`entities/api/definitions.ts:366`) | existing `crud:dictionaries.entry:*` tags | #2917 | [12](./12-cache-dictionary-entries.md) |
| 13 | `GET /api/currencies/options` | currency selects in pricing/order forms | existing `crud:currencies.currency:*` tags | #2918 | [13](./13-cache-currencies-options.md) |
| 14 | `GET /api/auth/roles` | admin roles page + role selects; N+1 per-role user counts | existing `crud:auth.role:*` + `crud:auth.user:*` tags | #2919 | [14](./14-cache-auth-roles-list.md) |
| 15 | `GET /api/auth/sidebar/preferences` | sidebar bootstrap | existing `nav:sidebar:*` tags (PUT already flushes them) | #2920 | [15](./15-cache-sidebar-preferences.md) |
| 16 | `GET /api/catalog/product-media` | product detail media | `crud:catalog.product:*:record:<id>` tag + TTL | #2921 | [16](./16-cache-product-media.md) |

## Suggested rollout order

1. **FR 06** — enable `ENABLE_CRUD_API_CACHE` + `cacheAliases` fix. This is the keystone: most other FRs piggyback on `crud:*` flushes, which are live only when this flag is on.
2. **FR 03 + FR 10 + FR 11** — polled badges/lists, extreme request volume, tiny risk, short TTL. Biggest QPS reduction for least code.
3. **FR 01 + FR 12 + FR 13** — read-mostly reference data on existing `crud:*` tags, zero new flush wiring.
4. **FR 02 + FR 07 + FR 15** — bootstrap-critical per-user payloads on existing `org-scope`/`rbac`/`nav:sidebar` tags.
5. **FR 04 + FR 09 + FR 14 + FR 16** — remaining list/detail surfaces.

> Each FR file contains: exact cache key shape, literal tag strings, a Trigger→Where→Tags invalidation table, an implementation checklist, risks/staleness window, and acceptance tests.
