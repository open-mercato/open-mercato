# Cache Performance — Feature Request Backlog

> Generated 2026-06-08 by a multi-agent workflow (4 discovery lanes → 9 deep-dive agents).
> Goal: highest-ROI API endpoints to cache **with tag-based invalidation** so data stays fresh. Quick wins, most-used read paths.

## How caching works here (read first)

- **Cache service**: `container.resolve('cache')` — API `get/set(key,val,{ttl,tags})/deleteByTags(tags[])`. No `getOrSet`; do manual get-then-set.
- **Tenant scoping is mandatory**: wrap every `get`/`set`/`deleteByTags` in `runWithCacheTenant(tenantId, …)` from `@open-mercato/cache`. It namespaces keys+tags per tenant, so cross-tenant reads are impossible even when the literal key omits the tenant.
- **Reference pattern to copy**: `packages/core/src/modules/customer_accounts/services/domainMappingService.ts` (get-then-set + ttl + tags, `deleteByTags` on every mutation, TTL as backstop).
- **Invalidation timing**: fire `deleteByTags` **post-commit** (outside `withAtomicFlush`) — event subscribers and `emitCrudSideEffects` already run post-commit. Tags carry correctness; TTL is only a backstop for missed invalidations.
- **Generic CRUD list cache already exists** (`packages/shared/src/lib/crud/factory.ts`) but is gated OFF behind env `ENABLE_CRUD_API_CACHE`. It only covers `makeCrudRoute` GETs and invalidates via collection/record tags from the command bus. **Custom GET handlers bypass it entirely** — those are the biggest manual-cache quick wins.

## Two classes of work

1. **Manual cache on custom GET handlers** (bypass the factory cache) — most of the wins below.
2. **Enable + harden the generic CRUD cache** for hot `makeCrudRoute` reads — turn on `ENABLE_CRUD_API_CACHE` and close cross-resource invalidation gaps (see FR 06 / 08).

## FR issues (deep-analyzed, ready to file)

| # | ROI | Endpoint | Verdict | Class | FR file |
|---|---|---|---|---|---|
| 1 | 86 | `GET /api/catalog/categories` | strong-quick-win | Manual cache | [01-cache-catalog-categories-list.md](./01-cache-catalog-categories-list.md) |
| 2 | 84 | `GET /api/directory/organization-switcher` | good | Manual cache | [02-cache-organization-switcher-menu.md](./02-cache-organization-switcher-menu.md) |
| 3 | 82 | `GET /api/notifications/unread-count` | good | Manual cache | [03-cache-notifications-unread-count.md](./03-cache-notifications-unread-count.md) |
| 4 | 82 | `GET /api/inbox_ops/proposals` | good | Manual cache | [04-cache-inbox-ops-proposals-list.md](./04-cache-inbox-ops-proposals-list.md) |
| 5 | 82 | `GET /api/dictionaries` | good | Manual cache | [05-cache-dictionaries-list.md](./05-cache-dictionaries-list.md) |
| 6 | 78 | `GET /api/catalog/products` | good | CRUD cache | [06-enable-and-fix-catalog-products-list-cache.md](./06-enable-and-fix-catalog-products-list-cache.md) |
| 7 | 72 | `GET /api/dashboards/layout` | good | Manual cache | [07-cache-dashboards-layout-bootstrap.md](./07-cache-dashboards-layout-bootstrap.md) |
| 8 | 72 | `GET /api/catalog/offers` | good | CRUD cache | [08-catalog-offers-decoration-cache.md](./08-catalog-offers-decoration-cache.md) |
| 9 | 58 | `GET /api/messages` | good | Manual cache | [09-cache-messages-list-per-user.md](./09-cache-messages-list-per-user.md) |

## Full candidate ranking (20 discovered; top 9 deep-dived above)

Remaining candidates are pre-vetted but not yet written up — good follow-up backlog.

| ROI | Endpoint | Module | makeCrudRoute? | Why it is a candidate |
|---|---|---|---|---|
| 92 ✅ FR | `GET /api/directory/organization-switcher` | directory | no | Heavy compute: em.find(Organization), em.find(Tenant), computeHierarchyForOrganizations (builds ancestor/descendant maps for each org), reso… |
| 92 ✅ FR | `GET /api/catalog/products` | catalog | yes | Massive afterList enricher (decorateProductsAfterList, lines 351–741): parallel lookups of offers, channels, categories, tags, variants, pri… |
| 92 ✅ FR | `GET /api/messages` | messages | no | 5-6 sequential/parallel queries: Kysely base query + findWithDecryption (Message entities with encryption overhead) + em.find (MessageObject… |
| 88 ✅ FR | `GET /api/notifications/unread-count` | notifications | no | Single em.count(Notification) query, but the COUNT is executed on every request without batching or coalescing. Lightweight query but extrem… |
| 88 ✅ FR | `GET /api/catalog/categories` | catalog | no | Custom GET (no makeCrudRoute): full hierarchy computation (computeHierarchyForCategories), tree-view node construction, custom field values … |
| 88 ✅ FR | `GET /api/dashboards/layout` | dashboards | no | Custom GET: loadAllWidgets (dynamic imports of ~40+ dashboard widgets across all modules + Promise.all(widgetEntries.map...)), loadScopeLayo… |
| 88 ✅ FR | `GET /api/inbox_ops/proposals` | inbox_ops | no | findAndCountWithDecryption (proposals with encryption overhead) + Promise.all parallel fetch of InboxEmail, InboxProposalAction, InboxDiscre… |
| 85 ✅ FR | `GET /api/dictionaries` | dictionaries | no | Custom GET handler with em.find() to fetch all active dictionaries, org-scoped filtering, inheritance resolution (reads both org and parent-… |
| 85 ✅ FR | `GET /api/catalog/offers` | catalog | yes | decorateOffersWithDetails (lines 84–337): Promise.all of products fetch, prices with priceKind populate, variant defaults. Then complex pric… |
| 85 | `GET /api/messages/unread-count` | messages | no | Joins message_recipients table to messages with 6+ filter conditions (status, deleted_at, archived_at, organization scoping, tenant scoping)… |
| 82 | `GET /api/dictionaries/[dictionaryId]/entries` | dictionaries | no | Custom handler: loadDictionary (em.findOne), findWithDecryption for all entries (encryption overhead), sortDictionaryEntries computation, ma… |
| 82 | `GET /api/catalog/product-media` | catalog | no | Custom GET (not makeCrudRoute): findOne product scope check + find attachments. Lightweight but called at high frequency (product detail pag… |
| 80 | `GET /api/currencies/options` | currencies | no | Custom GET: em.find with complex $or search filter (code + name), optional active/inactive filter, limit loop, response mapping to options f… |
| 80 | `GET /api/notifications` | notifications | no | em.find (main query) + em.count (separate count query, 2 ORM calls). Filter applied in code requires both queries to run before filtering. F… |
| 78 | `GET /api/auth/roles` | auth | no | Multiple em.find/em.count calls per request: findWithDecryption(UserRole) to count users per role (count grows with users), findWithDecrypti… |
| 78 | `GET /api/catalog/variants` | catalog | yes | makeCrudRoute with buildCustomFieldFiltersFromQuery + decorateCustomFields. Custom field resolution per variant can be 100+ items per page. … |
| 75 | `GET /api/catalog/prices` | catalog | yes | resolveNormalizedQuantityForFilter (lines 67–139) runs on filter and in afterList hook: variant + product lookups, unit-conversion table sca… |
| 72 | `GET /api/messages/types` | messages | no | Registry lookup via getAllMessageTypes() + JS transformation/map. Cost is in-memory only (not database), but the response is large (all mess… |
| 70 | `GET /api/auth/sidebar/preferences` | auth | no | Multiple helper calls: loadSidebarPreference (em.findOne), loadRolesPayload (em.find(Role) + em.findOne RoleSidebarPreference per role), loa… |
| 65 | `GET /api/auth/roles/acl` | auth | no | Simple em.findOne(RoleAcl) query but called with full validation chain: resolveIsSuperAdmin (rbacService.loadAcl), assertActorCanModifySuper… |

## Suggested rollout order

1. **FR 03 `notifications/unread-count`** + **`messages/unread-count`** — polled badges, extreme request volume, tiny risk, short TTL. Biggest QPS reduction for least code.
2. **FR 01 `catalog/categories`** + **FR 05 `dictionaries`** — read-mostly reference data, expensive hierarchy/inheritance compute, simple event-tag invalidation.
3. **FR 02 `directory/organization-switcher`** + **FR 07 `dashboards/layout`** — bootstrap-critical, per-user scoped, invalidate on org/layout mutation.
4. **FR 06 `catalog/products`** + **FR 08 `catalog/offers`** — enable `ENABLE_CRUD_API_CACHE` AND close the cross-resource (price/offer/category) invalidation gap into `catalog.product`. Highest payoff, highest care.
5. **FR 04 `inbox_ops/proposals`** + **FR 09 `messages`** — encrypted-decryption-heavy lists, per-user scope.

> Each FR file contains: exact cache key shape, literal tag strings, a Trigger→Where→Tags invalidation table, an implementation checklist, risks/staleness window, and acceptance tests.
