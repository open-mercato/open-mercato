# Fix: onboarding deferred-provisioning exhausts the Postgres connection pool

## Goal

Stop `runDeferredProvisioning` from piling up concurrent passes per onboarding request, which exhausts the Postgres connection pool and takes the demo instance down (failed new-tenant onboarding, "Tenant not found" at login, staff sessions invalidated).

## Scope

- `packages/onboarding/src/modules/onboarding/lib/deferred-provisioning.ts` — add an in-flight guard.
- `packages/onboarding/src/__tests__/` — unit test for the guard.

## Non-goals

- No change to the reindex/seed body, ordering, or `status.ts` polling cadence.
- No DB migration, no schema/entity change.
- No distributed (cross-process) lock — the per-process guard plus the existing `preparationCompletedAt` idempotency check is sufficient for the single-instance demo and a large improvement for any topology.

## Root cause

`api/get/onboarding/status.ts` re-triggers `runDeferredProvisioning` in an `after()` hook on **every** preparing-page poll while `!request.preparationCompletedAt`. `runDeferredProvisioning` is long-running (per-module `seedExamples` up to 15s each, then a force-reindex over every system entity). Because the page polls every few seconds, many full passes run concurrently for the same request (and across concurrent requests), saturating the pool (`DB_POOL_MAX` default 20, `DB_POOL_ACQUIRE_TIMEOUT` 6000ms). Under saturation even `markWorkspaceReady` (which sets `preparationCompletedAt`) times out, so the flag is never set and every later poll re-spawns the storm — a self-perpetuating thundering herd. Fresh demo logs are wall-to-wall `timeout exceeded when trying to connect` at `PostgresDriver.acquireConnection → rebuildTenantQueryIndexes → runDeferredProvisioning`.

## Fix

Add a module-level `Set<string>` of in-flight request ids. `runDeferredProvisioning` becomes a thin guarded wrapper around the existing body (extracted to a private `executeDeferredProvisioning`): if a pass for the same `requestId` is already running, return immediately; otherwise run, clearing the guard in `finally` so a failed pass can still be retried by a later poll — but only one at a time. Once the single live pass reaches `markWorkspaceReady`, `preparationCompletedAt` is set and `status.ts` stops triggering.

## Risks

- Per-process only: a multi-instance deployment still allows one pass per instance. Acceptable — bounded to instance count instead of poll count, and `preparationCompletedAt` still converges. Documented as residual risk.
- Guard cleared in `finally` preserves retry semantics; `markWorkspaceReady` already no-ops when `preparationCompletedAt` is set, so completed requests stay completed.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Guard + test

- [x] 1.1 Add in-flight guard to `runDeferredProvisioning` (extract body to private `executeDeferredProvisioning`) — 0f1462d24
- [x] 1.2 Add unit test proving concurrent calls for one requestId run the work once, and a later call runs again — 0f1462d24
- [x] 1.3 Run onboarding unit tests + typecheck; full validation gate — onboarding 82/82, build:packages ✓, generate ✓, typecheck 21/21 ✓

### Phase 2: Upgrade to cross-process claim + flag-after-rebuild (maintainer request)

The Phase 1 in-process `Set` guard stops the outage but is per-process and leaves a latent gap: `preparationCompletedAt` is written before the reindex, so a crash mid-rebuild strands a workspace with no search indexes and `status.ts` never re-triggers. Upgrade per maintainer request.

- [x] 2.1 Add `onboarding_requests.preparation_claimed_at` column (entity + migration + snapshot); `db:generate` reports onboarding no-drift — 4c833059a
- [x] 2.2 Add `OnboardingService.claimPreparation` (atomic CAS, mirrors `startProcessing`) + `releasePreparation` (timestamp-scoped CAS release) — 4c833059a
- [x] 2.3 Replace in-process Set with DB claim in `runDeferredProvisioning`; stale-reclaim after `PREPARATION_CLAIM_STALE_MS` — 4c833059a
- [x] 2.4 Move `markWorkspaceReady` after `rebuildTenantQueryIndexes`; send ready-email last — 4c833059a
- [x] 2.5 Rewrite unit tests (claim acquired/not-acquired, already-complete short-circuit, flag-after-rebuild ordering, release-on-throw); full gate — onboarding 83/83, build:packages ✓, generate ✓, db:generate no-drift ✓, typecheck 21/21 ✓
