# Checkpoint 3 — Steps 3.1 – 3.3 (Phase 2 close)

**Range:** Step 3.1 through Step 3.3 (3 Steps; closes Phase 2 — every Phase 2 row is now `done`).
**Commits:** `cc7e1ba6f` .. `33de29e90` (see PLAN.md Tasks table for per-Step SHAs).
**Touched areas:** `packages/core/src/modules/wms/lib/{availabilityCalculation,availabilityCache,availabilityProvider,tryResolve}.ts`, `wms/subscribers/invalidate-availability-cache.ts`, `wms/di.ts` (provider registration).

## Validation run (runner: local, no Docker `app` container running)

| Check | Scope | Result |
|---|---|---|
| `npx tsc --noEmit` | `packages/core` | ✅ pass, 0 errors |
| `npx turbo run typecheck` | `packages/shared` + `packages/core` | ✅ pass |
| `npx jest` (full suite) | `packages/core` | ✅ 1957/1959 suites, 17685/17691 tests pass. 2 remaining failures are the same pre-existing, unrelated `catalog` product-page tests noted at checkpoints 1–2. |
| `npx jest` (full suite) | `packages/shared` | ✅ 212/213 suites pass; the same `TMPDIR`-only failure noted at checkpoints 1–2 reproduced identically (environment-only, passes with `TMPDIR=/private/var/tmp`). |
| `npx jest src/modules/wms src/modules/availability` | scoped | ✅ 54 suites / 351 tests |
| `npx jest module-decoupling` | scoped | ✅ 12/12 — `wms` module-decoupling coverage unaffected by the new provider registration |
| `yarn build:packages` | full | ✅ 38/38 tasks successful |
| `yarn generate` | full | ✅ — `wms:invalidate-availability-cache` subscriber registered |
| `yarn db:generate` | full | ✅ no-op for `availability` and for `wms` (no entity changes in Phase 2 — pure calculation/cache/provider logic). Same pre-existing unrelated `wms` snapshot-drift migration as prior checkpoints reappeared on every run; deleted, not committed, `wms` snapshot left untouched (this branch never modifies `wms` entities). |

## Phase 2 gate verification (spec §13)

- **R1** (safety stock subtracted once per variant, not once per location): `availabilityCalculation.test.ts` — "subtracts safety stock once per variant after aggregating across 4 locations with asymmetric balances" (20-unit aggregate, `safety_stock: 5` → sellable 15, not 20 − 4×5 = 0). ✅
- **R4** (one balance aggregation + one profile lookup + one policy lookup, regardless of item count): `availabilityCalculation.test.ts` — 200-variant batch issues exactly 2 `em.getConnection().execute` calls (balance + profile) and exactly 1 batched `policyResolutionService.resolveMany()` call; a batch with a product-level item adds exactly one more (variant-rollup) query. ✅
- **States match hand-computed expectations on a seeded multi-location warehouse**: `availabilityProvider.test.ts` — 4 locations (20+15+10+5=50 aggregate), `safety_stock: 10` → sellable 40; requesting exactly 40 → `in_stock`; requesting 41 → `out_of_stock`. Exercised through the full `resolveAvailability()` → registry → `wms` provider → cache → calculation path, not just the calculation function directly. ✅

## Design note carried from Step 3.2

Cache tag granularity deliberately deviates from §6's literal `availability:{tenantId}:{variantId}` tag naming — a single coarse `wms:availability` tag (tenant-scoped automatically by `runWithCacheTenant`), matching the already-shipped `WMS_INVENTORY_CACHE_TAG` precedent and its documented over-invalidate-rather-than-under-invalidate rationale. Recorded in PLAN.md § Key design decisions (decision 5, refined).

## UI verification

Not applicable — Phase 2 touched no UI. Playwright specs (written, not yet executable in this sandbox) remain deferred to the final gate; Step 4.1 (UI integration tests) is next.

## Next Step

4.1 — Playwright UI integration tests (policy list/create/edit incl. resolution-chain preview + optimistic-lock conflict bar, admin check tool). Research on the real CrudForm/flash/conflict-banner locator patterns used elsewhere in this repo is complete; ready to write.
