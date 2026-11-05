# Checkpoint 8 — QA round-4 fixes + develop merge (Phase 29)

**Date:** 2026-06-02
**Resume:** auto-continue-pr-loop #2055 (round-4 QA from @alinadivante, 2026-06-01T22:00Z)
**Steps covered:** 29.0..29.5

## Scope

Merge `develop` (34 commits) into the branch and fix the four remaining QA blockers:

1. **Customer task (todos) optimistic lock** — task modal saved without the lock header;
   stale-after-delete returned a bare 404 "Interaction not found".
   - Client: canonical `useInteractions.updateInteraction` now sends
     `buildOptimisticLockHeader(target.updatedAt)` + surfaces the conflict bar; legacy
     `usePersonTasks.updateTask`/`unlinkTask` send the header. `updatedAt` plumbed through
     `todoCompatibility` (LegacyTodoDetail / CustomerTodoRow / both mappers) → todos route
     `todoItemSchema` (`todoUpdatedAt`) → `TodoLinkSummary` → `mapRowToSummary`.
   - Server: `customers.interactions.{update,complete,cancel,delete}` commands call
     `enforceCommandOptimisticLock` (exists-but-stale → 409) next to the existing
     `enforceRecordGoneIsConflict` (gone → 409). Covers the legacy `/api/customers/todos`
     bridge, which skips the makeCrudRoute guard.
2. **Activity modal raw toast** — `ScheduleActivityDialog` skips the raw `record_modified`
   flash on an optimistic-lock 409 (the persistent conflict bar is already surfaced by
   `useGuardedMutation`); closes the modal so the bar is visible.
3. **Sales order false-positive 409** — `mapUpdateResponse` now returns `updatedAt`; the
   sales document page refreshes `record.updatedAt` centrally inside `updateDocument`, so a
   second inline save on the same page no longer sends a stale token.
4. **Product variant** — detail page renders `RecordNotFoundState` (not an empty CrudForm)
   when the variant 404s. Integration test confirms the server already 409s a stale variant
   DELETE (no server change needed for delete enforcement).

## Validation

- `yarn turbo run typecheck --filter=@open-mercato/{shared,ui,core}` ✅ (exit 0)
- `yarn build:packages` ✅ (×2; 2nd pass bundles `dist/generated`)
- `yarn generate` ✅
- `yarn i18n:check-sync` ✅ (added `catalog.variants.form.backToVariants` ×4 locales, re-sorted)
- `yarn i18n:check-usage` ✅ (advisory; new key is used; 3648 unused = pre-existing baseline)
- `yarn build:app` ✅ (exit 0)
- Touched unit suites ✅: shared `optimistic-lock-command` 28/28; core `interactions` /
  `todoCompatibility` / `usePersonTasks` / `useInteractions` / `handleVariantDeleteError` /
  `optimisticLockSingleSource` pass. The sole failing suite is `TasksSection.test.tsx`
  (`React.act is not a function`) — the pre-existing testing-library/React env issue that
  reproduces on the PR head (documented in NOTIFY); CI runs it clean.

## Integration tests (ephemeral env, `OM_OPTIMISTIC_LOCK=all`, base `http://127.0.0.1:5001`)

New (all green):
- `customers/__integration__/TC-LOCK-OSS-009` — todos concurrent edit → 409; stale edit
  after delete → 409 (not 404); header-less PUT still passes.
- `catalog/__integration__/TC-LOCK-OSS-010` — variant stale DELETE → 409; fresh DELETE → 2xx.
- `sales/__integration__/TC-LOCK-OSS-011` — order PUT response includes a fresh `updatedAt`;
  back-to-back saves using the returned token succeed; original stale token still 409s.
- `catalog/__integration__/TC-LOCK-OSS-012` — browser UI: missing variant renders
  RecordNotFoundState + "Back to variants", no editable form.

Regression (all green): TC-LOCK-OSS-001/002/004/005/006/007/008 (15 tests). Total **20** lock
integration tests pass.

## Notes

- Playwright MCP browser tools were not connected this session; UI verification used the
  page-fixture Playwright runner (TC-LOCK-OSS-012) instead, which is equivalent and CI-runnable.
- #2 activity raw-toast suppression is a pure client guard verified by typecheck + code review +
  the 409-contract integration test (TC-LOCK-OSS-009 exercises the same interactions command path).
