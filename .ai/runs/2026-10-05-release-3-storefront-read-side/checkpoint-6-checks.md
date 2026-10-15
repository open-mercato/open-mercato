# Checkpoint 6 — Phase 3 (part 2: Omnibus resolution, config, backfill, admin UI)

**Timestamp:** 2026-10-05T17:20:07Z
**Steps covered:** 3.4–3.8-fix (4f3b6c1a7e .. c73c7b42b6)
**Runner:** local mode (unit/typecheck, `LANG=en_US.UTF-8` to neutralise the pre-existing locale-dependent warranty test); ephemeral env (fresh build, own DB) for the UI check
**Touched areas:** catalog `catalogOmnibusService` (+ batched history queries, cache), omnibus-preview route + products-list enrichment, `GET|PATCH /api/catalog/config/omnibus` (mutation guards, 422 backfill gate), `omnibus:backfill` CLI, `OmnibusSettings` + `PriceEditorOmnibusRow` UI, catalog i18n (5 locales).

| Check | Result | Notes |
|---|---|---|
| `yarn generate` | ✅ pass | |
| `yarn turbo run typecheck --filter=@open-mercato/{core,shared,ui} --force` | ✅ pass | |
| `yarn workspace @open-mercato/core test` (FULL) | ❌ → ✅ | first run 1 failure: `explicit-sort-comparators` guard flagged bare `.sort()` in `OmnibusSettings.tsx` / `omnibusConfig.ts` → 3.8-fix; re-run of guard + catalog components/lib 442/442 |
| `yarn workspace @open-mercato/shared test` (FULL) | ✅ 2622 passed | |
| `yarn i18n:check-sync` | ✅ pass | |
| eslint catalog | ✅ 0 errors | 10 warnings, all pre-existing patterns in files outside this window's changes |
| UI smoke (ephemeral, Playwright) | ✅ | login → /backend/config/catalog → Omnibus panel renders with defaults; `checkpoint-6-artifacts/screenshot-omnibus-settings.png`, `browser-session.log` |
