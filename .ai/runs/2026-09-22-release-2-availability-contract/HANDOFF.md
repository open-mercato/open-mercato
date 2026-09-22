# Handoff — 2026-09-22-release-2-availability-contract

**Last updated:** 2026-09-22T13:00:00Z
**Branch:** feat/release-2-availability-contract
**PR:** https://github.com/open-mercato/open-mercato/pull/6339
**Current phase/step:** Phase 1 COMPLETE. Phase 2, Step 3.1 (wms sellable-quantity calculation) — code + tests drafted and passing, not yet committed.
**Last commit:** 269051ee8 — fix(availability): checkpoint 2 fixes — route-param guard, batched policy resolution

## What just happened
- Landed the rest of Phase 1 (Steps 2.5–2.8): admin check API route, setup.ts/di.ts/i18n, backend UI (policy list/create/edit + admin check tool).
- Ran checkpoint 2 (see `checkpoint-2-checks.md`) — full suites, typechecks, build:packages, generate/db:generate no-op, i18n checks all green. Fixed a real bug (#5600-pattern `useParams()` route-param guard) and closed an R4 gap in `policyResolution.ts` by adding batched `resolveMany()`.
- Phase 1 is now fully `done` in PLAN.md's Tasks table.
- Started Phase 2: `packages/core/src/modules/wms/lib/availabilityCalculation.ts` + `lib/tryResolve.ts` + a 14-test suite are written and passing locally (R1 safety-stock-once, state boundaries, low_stock override vs reorder_point, preorder before/after, product rollup excluding inactive variants, R4 constant-query-count for a 200-variant batch, no-policy-service default-open path) — not yet committed as a Step.

## Next concrete action
- Commit the Step 3.1 work already on disk (`wms/lib/availabilityCalculation.ts`, `wms/lib/tryResolve.ts`, `wms/lib/__tests__/availabilityCalculation.test.ts`) as Step 3.1, flip PLAN.md, push.
- Then Step 3.2: `wms/lib/availabilityCache.ts` (60s TTL, tag invalidation — mirror `wms/lib/invalidateInventoryEnricherCache.ts`'s `runWithCacheTenant` pattern) + `wms/subscribers/invalidate-availability-cache.ts` (event `wms.inventory_balance.*`, mirroring `wms/subscribers/invalidate-enricher-cache-balance.ts`). Design note: coarse per-tenant cache tags (matching the existing `WMS_INVENTORY_CACHE_TAG` precedent's safety rationale), not literal per-variant tags — documented deviation from the spec's §6 literal tag naming, to be logged in PLAN.md.
- Then Step 3.3: `wms/lib/availabilityProvider.ts` + `wms/di.ts` registration (`availabilityProviderRegistry.register({id:'wms', getAvailability})`) + integration tests.

## Blockers / open questions
- None.

## Environment caveats
- Dev runtime runnable: not started. Playwright `__integration__` specs cannot execute in this sandbox (no container runtime for the ephemeral Postgres + live server) — all written specs are typechecked-only so far, real execution deferred to the final gate.
- Database/migration state: clean; no entity changes in Phase 2 so far (calculation-only).

## Worktree
- Path: /Users/bernard/workspace/open-mercato/.ai/cezar/worktrees/8967983c-8f33-4fe0-b10e-e683933caf94
- Created this run: no (reused the existing cezar-linked worktree)
