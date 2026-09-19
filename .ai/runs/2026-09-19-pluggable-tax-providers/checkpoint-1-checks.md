# Checkpoint 1 — Phase 1 closed (Steps 1.3 to 1.8)

**Date:** 2026-09-19
**Steps landed this checkpoint:** 1.3, 1.4, 1.5, 1.6, 1.7, 1.8
**Runner:** local (`yarn X`). No compose `app` container is running — `docker ps` shows only `om-app-redis`, `om-app-postgres`, `om-app-meilisearch`.

## Targeted validation

| Command | Result |
|---|---|
| `yarn build:packages --cache-dir=/srv/om/cache/turbo` | ✅ 38/38 tasks |
| `yarn generate` | ✅ clean; `git status` empty afterwards, so no generated drift |
| `yarn i18n:check-sync` | ✅ all 5 locales in sync across 61 modules |
| `yarn i18n:check-usage` | ✅ advisory only (4247 pre-existing unused keys; this phase adds no locale key) |
| `yarn typecheck` | ✅ 38/38 tasks |
| `yarn test` (full repo) | ⚠️ 5 pre-existing failures in `@open-mercato/cli`, everything else green |
| `yarn test` (`@open-mercato/core`, `modules/sales`) | ✅ 116 suites, 897 tests |

## The five `@open-mercato/cli` failures are pre-existing

`src/lib/__tests__/resolve-environment.test.ts` (1) and `src/lib/__tests__/resolver.enterprise.test.ts` (4).
Reproduced on `origin/develop` in this same worktree: same 2 suites, same 5 tests, same messages
(`resolveEnvironment` reports `monorepo` where the test expects `standalone` — the temporary directory
it creates resolves upward into this monorepo). This branch touches no file under `packages/cli`.

## UI verification

Skipped: phase 1 changes no `.tsx`, no component and no route. The first UI surface lands in Step 2.7
(document detail badge, breakdown and banner) and will be captured at the next checkpoint.

## Integration tests

Not run at this checkpoint: the first acceptance spec (`TC-SALES-TAX-001`) lands in Step 2.8. The full
integration suite runs at the final gate.

## What phase 1 establishes

- A tax provider contract and registry shaped exactly like the shipping and payment ones.
- `table-rates` as the built in default and an **exact identity** over the calculation engine, so an
  organization without a selection keeps every amount it has today. Proven against the engine's own
  fixtures, including the explicit-tax-amount and gross-delta (#2457) cases.
- `fixed-rate` as a real single-jurisdiction provider and the double the acceptance scenarios need.
- The stage running as a third stage of the totals hook, with timeout, fallback, reconciliation and
  the two lifecycle events, and never failing a write.
- All eighteen recalculation sites feeding it, guarded by a source scan.
- Provenance on `sales.document.totals.calculated`.

Nothing is persisted yet — the result lives in `calculation.metadata.tax`. Phase 2 adds the columns.
