# Plan — release-2-availability-contract

Source spec: `.ai/specs/2026-08-14-availability-contract.md` §13 Phases 1 and 2 only.

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids and `Exec` cells are immutable once the plan is committed — per-Step commits touch only `Status` and `Commit`.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 1 | 1.1 | shared/availability: types + provider registry + resolveAvailability | inline | done | 612b946c5 |
| 1 | 1.2 | shared/availability: catalog-only fallback provider + barrel + tests | inline | done | 492b0c18e |
| 1 | 2.1 | availability module skeleton (index/acl/events) | inline | done | 0497c1115 |
| 1 | 2.2 | AvailabilityPolicy entity + validators + migration | inline | done | e225f5ffd |
| 1 | 2.3 | policyResolution.ts — 6-level chain + tests | inline | done | 37c4994aa |
| 1 | 2.4 | policy commands + CRUD API route + tests | inline | done | 6b9e5e926 |
| 1 | 2.5 | admin check API route + tests | inline | done | 67f5dd809 |
| 1 | 2.6 | setup.ts + di.ts + i18n | inline | done | b5b5afdb7 |
| 1 | 2.7 | backend UI — policy list/create/edit | inline | done | 860befad1 |
| 1 | 2.8 | backend UI — admin check tool | inline | done | c67a04d87 |
| 1 | 2.9-checkpoint-fix | Checkpoint 2 fixes: useParams() route-param guard, batched policyResolution.resolveMany() for R4 | inline | done | 269051ee8 |
| 2 | 3.1 | wms sellable-quantity calculation + tests (R1, R4) | inline | done | cc7e1ba6f |
| 2 | 3.2 | wms availability cache + invalidation subscriber | inline | done | 59b94a8e1 |
| 2 | 3.3 | wms AvailabilityProvider + registration + integration tests | inline | done | 8610d9ec4 |
| — | 4.1 | Playwright UI integration tests | inline | done | 14aef0b2b |
| — | 4.2 | Module registration + generate + docs wrap-up | inline | done | 7499acb38 |

## Goal

Implement Phase 1 (base availability contract, catalog-only fallback, `AvailabilityPolicy` admin module) and Phase 2 (the `wms` availability provider) of the Availability Contract spec, per the Reconciliation note's split: the dependency-free base contract lives in `packages/shared/src/lib/availability/`, the policy/admin surface lives in the new `packages/core/src/modules/availability/` module, and `wms` registers as a provider without gaining a hard dependency on `availability`.

## Scope

- `packages/shared/src/lib/availability/`: `AvailabilityState`, `AvailabilityItemQuery`, `AvailabilityQuery`, `AvailabilityItemResult`, `AvailabilityResult`, `AvailabilityProvider`, `availabilityProviderRegistry` (register/get/list, idempotent replace-by-id, mirrors `llm-provider-registry.ts`), `resolveAvailability()`, and the built-in `catalog-only` fallback provider.
- `packages/core/src/modules/availability/`: `AvailabilityPolicy` entity + CRUD, `lib/policyResolution.ts` (6-level resolution chain), `acl.ts`, `events.ts` (policy CRUD events only), `setup.ts`, `di.ts`, admin backend UI (policy list/edit with resolution-chain preview, admin check tool), i18n.
- `packages/core/src/modules/wms/`: `AvailabilityProvider` implementation (`id: 'wms'`) — batched sellable-quantity aggregation, safety-stock handling (once per variant, §4.2/R1), low-stock thresholds, product-level rollup, 60s TTL cache with tag invalidation on `wms.inventory_balance.*` events, soft-resolved policy overlay via `tryResolve`.
- Module registration (`apps/mercato/src/modules.ts` + create-app template mirror), `yarn generate`, migration.
- Integration test coverage per spec §12 for everything in scope (service behaviour, policy resolution, API tenant isolation, admin UI paths) — excluding reservation-behaviour items, which are Phase 3.

## Non-goals

- Phase 3 (reservations: `reserveAvailability`/`releaseAvailability`/`commitAvailability`, `lib/reservationCommands.ts`, `'checkout'` `InventoryReservationSourceType` addition, expiry/reconciliation jobs, `availability.shortfall.detected`) — checkout-only, explicitly out of scope.
- `availability.state.changed` / `availability.reservation.*` / `availability.shortfall.detected` events — nothing in Phase 1/2 scope emits them (state-change notification is a Phase 3/spec-9 concern); not declared in `events.ts` to avoid dead declarations.
- Every other spec in the ecommerce suite (specs 3–10), and any integration with PR #6268 or `customer_groups` — this run stops and reports if a Step starts needing either.
- No public storefront endpoints (§8) — this module ships admin-only routes.

## Key design decisions (documented per the autonomous-run rule — no user in the loop)

1. **Provider selection without a shared→core dependency.** `resolveAvailability(query, options?)` accepts an optional narrow `moduleConfig` reader interface (`{ getValue(moduleId, name, opts): Promise<T|null> }`) declared locally in `packages/shared`, so callers with DI access (the `availability` module's own `check` route, future `ecommerce`/`cart`/`checkout`) pass their resolved `ModuleConfigService` instance in; omitting it defaults to `'auto'`. This keeps `packages/shared` at zero domain dependencies while still allowing real per-tenant selection where the caller has a container. Mirrors the existing port/adapter precedent in `llm-provider-registry.ts`.
2. **Catalog-only fallback's optional policy awareness.** Per §4.3 the built-in `catalog-only` provider must consult an `AvailabilityPolicy` "soft-resolved via `tryResolve`" when `availability` is installed — but a provider registered from `packages/shared` has no DI container. Solution: a settable module-level hook (`setCatalogOnlyPolicyLookup(fn)`, default `null`) in `packages/shared/src/lib/availability/`, wired by the `availability` module's `di.ts` at container-build time (closure captures the container, same technique `wms/di.ts` uses for its own provider). Absent/throwing hook degrades to the pure fallback (`not_tracked`, `canFulfil: true`, `isAuthoritative: true`).
3. **`wms`'s own policy overlay.** `wms`'s `getAvailability` soft-resolves `availability`'s `policyResolutionService` the same way — via `tryResolve(container, 'policyResolutionService')` — never a static import of the `availability` module (ejectability, §3.1).
4. **`wms`'s "is_stock_managed" module default.** §5.2's module default ("`true` when `wms` is enabled and a `ProductInventoryProfile` exists") is resolved by `availability`'s policy resolution soft-resolving wms's `ProductInventoryProfile` **entity class** via `tryResolve(container, 'ProductInventoryProfile')` (already DI-registered in `wms/di.ts`) and querying it through the caller's `EntityManager` — never a static import of `wms`.
5. **Cache + invalidation stays entirely inside `wms`.** The 60s TTL cache and its tag-based invalidation subscriber are wms's own concern (wms caches its own computed availability, invalidated by wms's own `wms.inventory_balance.*` events) — no cross-module event wiring needed, and it degrades cleanly when `availability` is ejected (irrelevant) or when `wms` itself is disabled (nothing to cache). **Refined at Step 3.2:** the cache tag is a single coarse `wms:availability` tag (tenant-scoped automatically by `runWithCacheTenant`), not a literal per-`{tenantId}:{variantId}` tag as §6's table names — this matches the existing, already-shipped `WMS_INVENTORY_CACHE_TAG` precedent in `enricherCacheTags.ts`, whose own comment states the rationale: "collection tags over-invalidate slightly; a per-warehouse scheme the write side could miss would under-invalidate, which is the failure that actually shows wrong stock to a user." The same tradeoff applies here, and consistency with the module's own established pattern outweighs matching the spec's literal tag string.
6. **`AvailabilityQuery.bypassCache?: boolean`** — an additive, optional field (harmless since this is a brand-new, previously-unshipped contract) so §6's "cart re-validation: never cached" row has a caller-facing hook, even though no caller in this PR's scope (cart) exists yet.
7. **Catalog-only + policy interaction when stock IS managed but no wms is installed**: `is_stock_managed: true` with no real stock source and no active preorder is treated as `out_of_stock` (canFulfil: false) rather than `not_tracked`, since "explicitly marks unavailable" (§4.3) is read as "opted into tracking without a data source to verify against." `preorder_release_at` in the future → `preorder`; `is_active: false` on the policy → `out_of_stock`. Documented here because §4.3 does not fully enumerate this matrix.

## Implementation Plan

### Phase 1 — Base contract (shared) + policy module

**Step 1.1 — shared/availability: types + provider registry + resolveAvailability**
- `packages/shared/src/lib/availability/types.ts`: `AvailabilityState`, `AvailabilityItemQuery`, `AvailabilityQuery` (+ `bypassCache?: boolean`, decision 6), `AvailabilityItemResult`, `AvailabilityResult`, `AvailabilityProvider` — exact shapes from spec §4.1a.
- `packages/shared/src/lib/availability/registry.ts`: `availabilityProviderRegistry` (register/get/list/reset — mirror `llm-provider-registry.ts` exactly), `resolveAvailability(query, options?)` implementing `auto`/`wms`/`catalog-only` selection with safe fallback to `catalog-only` (decision 1).
- Unit tests: register/replace-by-id, list order, `resolveAvailability` selection matrix (explicit id, `auto` picks highest-precedence non-`catalog-only` registrant, unregistered id falls back).

**Step 1.2 — shared/availability: catalog-only fallback provider + barrel + tests**
- `packages/shared/src/lib/availability/catalogOnlyProvider.ts`: built-in provider (id `catalog-only`), auto-registered at import time; consults the optional policy-lookup hook (decision 2); implements decision 7's matrix.
- `packages/shared/src/lib/availability/index.ts` barrel.
- Unit tests: no-hook fallback (`not_tracked`/`canFulfil:true`/`isAuthoritative:true` for every item — R5), hook-driven preorder/out-of-stock override, hook throwing degrades gracefully. Covers Phase 1 Gate: "storefront-shaped consumer gets coherent states with wms disabled."

**Step 2.1 — availability module skeleton**
- `packages/core/src/modules/availability/index.ts` (`ejectable: true`, no hard `requires`), `acl.ts` (§8.1 features), `events.ts` (`availability.policy.created/.updated/.deleted` only — decision non-goal).
- **Ordering note (not a scope change):** module registration (`apps/mercato/src/modules.ts` + create-app template mirror) moved here from Step 4.2, because `yarn generate`/`yarn db:generate` resolve modules from `apps/mercato/src/modules.ts`'s `enabledModules` — later Steps need the module registered to generate entity ids and migrations. Step 4.2 keeps the final full `yarn generate` + `yarn db:generate` no-op check and the spec changelog update.

**Step 2.2 — AvailabilityPolicy entity + validators + migration**
- `data/entities.ts`: `AvailabilityPolicy` per §5.1 (all columns, `updated_at` for optimistic locking, unique constraint on `(tenant_id, organization_id, store_id, product_id, variant_id)` among non-deleted rows, `variant_id` non-null requires `product_id` non-null enforced at validation layer).
- `data/validators.ts`: zod create/update schemas enforcing §5.1 constraints (`allow_backorder` requires `backorder_lead_time_days`; non-negative ints; `max_order_quantity >= min_order_quantity`; `variant_id` requires `product_id`).
- `yarn db:generate`; review and keep only this entity's migration; update `migrations/.snapshot-open-mercato.json`.

**Step 2.3 — policyResolution.ts**
- `lib/policyResolution.ts`: resolves each field through the 6-level chain (variant+store → variant → product+store → product → store default → module default), returns `policySourceId` per §5.2. Module default `is_stock_managed` per decision 4.
- Unit tests: all 6 levels resolve independently and correctly, `policySourceId` correct at each, module default with/without wms+profile.

**Step 2.4 — policy commands + CRUD API route + tests**
- `commands/policies.ts` (create/update/delete via `runCrudCommandWrite`, custom-field-free), `api/policies/route.ts` (`makeCrudRoute`, `indexer: { entityType }`), `api/openapi.ts`.
- Integration tests: CRUD happy path, ACL gating (`availability.policies.view`/`.manage`), tenant isolation (second-tenant fixture), optimistic-lock 409 on stale `updatedAt`.

**Step 2.5 — admin check API route + tests**
- `api/check/route.ts` (`POST /api/availability/check`, `availability.check` feature) — mirrors `resolveAvailability()` for support reproduction, includes `policySourceId` trace.
- Integration tests: gated access (403 without feature), not_tracked/no-balance-no-policy path, unknown item id → inline 4xx (not a 500), quantity default handling.

**Step 2.6 — setup.ts + di.ts + i18n**
- `setup.ts`: `defaultRoleFeatures` for `admin`/`employee` per §15 (existing-tenant sync note in NOTIFY, not run automatically — no live tenant in this dev/test environment).
- `di.ts`: registers `AvailabilityPolicy` entity class + `policyResolutionService`; wires `setCatalogOnlyPolicyLookup` (decision 2).
- `i18n/en.json` + `i18n/pl.json`: policy field labels, state labels, validation/error copy.

**Step 2.7 — backend UI: policy list/create/edit**
- `backend/availability/policies/page.tsx` (list, DataTable), `.../create/page.tsx`, `.../[id]/page.tsx` (`CrudForm`, optimistic-lock conflict bar, resolution-chain preview widget per US-A2, "no policy set" empty state per US-A1, view-only for `policies.view`-only role).

**Step 2.8 — backend UI: admin check tool**
- `backend/availability/check/page.tsx` per US-B1/US-B2: gated by `availability.check` with an explicit no-access state, quantity default 1, store default = tenant default, Cmd/Ctrl+Enter to run, unknown-item inline error, `not_tracked` rendered distinctly, per-field `policySourceId` trace (child→parent→store→module-default).

### Phase 2 — `wms` implementation

**Step 3.1 — wms sellable-quantity calculation + tests**
- `wms/lib/availabilityCalculation.ts`: one batched raw-SQL aggregation (mirrors `lowStockBalanceFilter.ts`'s query shape) computing `sellable = max(0, aggregate_available − safety_stock)` once per variant after aggregation (R1), low-stock from policy override else `reorder_point`, product-level rollup summing active variants, single aggregation + single profile lookup + single policy lookup regardless of item count (R4). Soft policy overlay via `tryResolve`.
- Unit tests: R1 (4 locations, asymmetric balances, safety stock subtracted once), state boundaries (exact-qty in_stock, one-over out_of_stock/backorder), low_stock override vs `reorder_point`, preorder before/after `preorder_release_at`, product rollup excludes inactive variants, R4 query-count assertion for a 200-variant batch.

**Step 3.2 — wms availability cache + invalidation subscriber**
- `wms/lib/availabilityCache.ts`: 60s TTL read-through cache keyed per requested item, tag `availability:{tenantId}:{variantId|productId}` (decision 5), honors `bypassCache`.
- `wms/subscribers/invalidate-availability-cache.ts` (ephemeral, non-persistent): on `wms.inventory_balance.created/.updated/.deleted`, `cache.deleteByTags(...)` for the affected variant.
- Tests: cache hit → `isAuthoritative: false`; balance event clears the tagged entry; `bypassCache: true` always computes live.

**Step 3.3 — wms AvailabilityProvider + registration + integration tests**
- `wms/lib/availabilityProvider.ts`: implements `AvailabilityProvider` (`id: 'wms'`), maps calculation output to `AvailabilityItemResult`.
- `wms/di.ts`: `availabilityProviderRegistry.register({ id: 'wms', getAvailability })` at container-build time; confirm `requires` array unchanged (no hard dependency).
- Integration tests: module-decoupling style — wms enabled vs disabled (provider registered/absent), `resolveAvailability` with `selectedProvider: 'wms'`/`'auto'`/`'catalog-only'`/unregistered-id fallback, coherent multi-location states on a seeded warehouse (Phase 2 Gate).

### Final

**Step 4.1 — Playwright UI integration tests**
- Policy list/create/edit (resolution-chain preview live update, optimistic-lock conflict bar, view-only role), admin check tool (all US-B1/US-B2 ACs) — per `.ai/qa/AGENTS.md` conventions.

**Step 4.2 — Final generate/migration no-op check + docs wrap-up**
- Module registration happened in Step 2.1 (ordering note above). Here: final full `yarn generate` + `yarn db:generate` no-op check across the whole branch.
- Update `.ai/specs/2026-08-14-availability-contract.md` changelog: Phase 1 + Phase 2 implemented, Phase 3 remains open (do not move to `implemented/`).

## Risks

- R1/R4 (spec) are gate-blocking — covered by dedicated tests in Step 3.1.
- The shared↔core DI boundary (decisions 1–4) is the highest-risk area since it's genuinely underspecified in the deferred contract; documented above and re-verified in the module-decoupling integration test (Step 3.3).
- No live "store" concept exists yet in this repo (confirmed via grep — no `store_id`/`storeId` usage anywhere in `packages/core/src/modules`); `AvailabilityPolicy.store_id` ships as a plain nullable uuid with no FK/ORM relation, matching "null = all stores" and not blocking on the (not-yet-built) ecommerce store entity.

## External References

None (`--skill-url` not passed).
