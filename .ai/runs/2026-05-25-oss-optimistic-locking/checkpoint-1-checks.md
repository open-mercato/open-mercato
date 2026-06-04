# Checkpoint 1 — Steps 7.1..8.2 verified

**Timestamp:** 2026-05-25T11:00Z
**Steps covered:** 7.1, 7.2, 8.1, 8.2 (4 resumed steps; resume migration commit counts toward the 5-step trigger so checkpoint fires now)
**SHA range:** 23b28c066..ff7841453 (plan migration through sales.order wiring)

## Touched packages

- `packages/shared` — new `optimistic-lock-store.ts`; `optimistic-lock.ts` factory accepts optional `readers`
- `packages/core/src/modules/customers` — `di.ts` migrates to store + adds `customers.person` reader; `__integration__/TC-LOCK-OSS-002.spec.ts`
- `packages/core/src/modules/sales` — `di.ts` registers `sales.order` reader via store; `__integration__/TC-LOCK-OSS-003.spec.ts`
- `.github/workflows/ci.yml` — `OM_OPTIMISTIC_LOCK` env extended to all three resourceKinds

## Validation results

| Check | Result | Notes |
|---|---|---|
| `yarn jest @open-mercato/shared optimistic-lock*` | **27/27 pass** | 20 original + 7 new store/factory tests |
| `yarn jest @open-mercato/ui optimisticLock*` | **10/10 pass** | unchanged from Phase 3 — sanity that nothing broke |
| `yarn i18n:check-sync` | **pass** | "All translation files are in sync." |
| `tsc --noEmit` shared | **0 errors** | clean |
| `tsc --noEmit` core (touched files: customers/di.ts, sales/di.ts, TC-LOCK-OSS-002/003) | **0 new errors** | pre-existing `#generated/entities.ids.generated` baseline (~192 errors) is identical to develop |

## UI verification

**Skipped — no UI touched in this checkpoint window.**

The 4 resumed Steps changed: `*.ts` server-side (di.ts in two modules), one shared lib file, two new Playwright integration test specs (`*.spec.ts`), one CI workflow file. None are `.tsx` / UI component files. UI verification will fire at the next checkpoint after Phase 9 (CrudForm prop) lands.

## Notes / decisions

- The new `optimistic-lock-store.ts` solves the Phase 8 DI-clash risk that PLAN.md flagged: both customers and sales register `crudMutationGuardService` with the *same* store-backed factory, so the resulting reader set is identical regardless of Awilix's last-write-wins. CI exercises all three resourceKinds in a single run.
- Integration tests for customers.person and sales.order will execute against the ephemeral dev stack with the updated `OM_OPTIMISTIC_LOCK` env. No local Playwright run in this checkpoint (dev server not started in this worktree).

## Artifacts

None. No screenshots or Playwright transcripts were produced this checkpoint.

## Next step

Phase 9.1 — `CrudForm`: add `optimisticLockUpdatedAt` prop that auto-injects the extension header via `withScopedApiRequestHeaders` on `PUT`/`PATCH`/`DELETE`. **Touches UI → paired UI test in 9.2.**
