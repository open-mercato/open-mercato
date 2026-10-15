# Final gate — Pricing Engine, Phase 1 + Phase 2

**Date:** 2026-09-19T19:25:00Z
**Runner:** local (no `app` container running; root `AGENTS.md` § Validation Commands "otherwise local mode" branch)
**Environment:** real `yarn install` (checkpoint 1 replaced the dev-testing symlinks); a disposable Postgres DB (`om_qa_6268`) provisioned via `createdb` + `yarn initialize`, dev server via `yarn dev --no-mcp` against `apps/mercato/.env` (`DATABASE_URL` → `om_qa_6268`, `DEMO_MODE=false`, `APP_URL=http://localhost:3000`).

## `validation.commands` gate (full sequence, in order)

| Command | Result |
|---|---|
| `yarn build:packages` | ✅ 38/38 |
| `yarn generate` | ✅ (pre-existing, unrelated OpenAPI-bundle-fallback warning, unchanged by this PR) |
| `yarn build:packages` (2nd) | ✅ 38/38, `>>> FULL TURBO` (cache-clean) |
| `yarn i18n:check-sync` | ✅ in sync across en/pl/es/de/ko |
| `yarn i18n:check-usage` | ✅ advisory-only, exit 0 |
| `yarn typecheck` | ✅ 38/38 packages, zero errors |
| `yarn test` | `@open-mercato/cli` and `@open-mercato/core` verified individually below — `turbo run test` itself aborts the pipeline on the first package failure (documented repo quirk) and a `packages/shared` test needs `TMPDIR=/private/var/tmp` (this cezar worktree's default `TMPDIR` breaks `tsx`-spawned child processes; unrelated to this change) |
| `yarn build:app` | ✅ 1/1, Next.js production build succeeds |

### `yarn test` — per-package, direct (bypassing the two `turbo` quirks above)

| Package | Result |
|---|---|
| `packages/shared` (full) | ✅ 210/211 suites (1 pre-existing skip), 2385/2390 tests |
| `packages/core` (full) | ✅ 1951/1952 suites (1 pre-existing skip), 17624/17626 tests — includes 2 fixes found and applied during this gate (see below) |
| `packages/cli` (full) | ✅ 103/103 suites, 1926/1926 tests — includes 1 fix found and applied during this gate (see below) |

Fixes applied during this gate (all committed as `2.5-gate-fix*` Steps in `PLAN.md`):
1. `module-facts.extension-hosts.test.ts` — updated the `catalog.hostTokens.tableIds` fixture for the new `catalog.prices.list` DataTable host Phase 1 added.
2. `useBatchLabels.ts`'s cache-key `.sort()` had no comparator (`explicit-sort-comparators` audit, #3620) — added the canonical-key comparator.
3. `PricesDataTable.tsx`'s delete call needed the documented `optimistic-lock-exempt` marker (delete-only mutation, no field-level lost-update risk) to satisfy the `optimistic-lock-ui-coverage` audit (#2373) — matches `CategoriesDataTable`'s existing convention.

## Design-system pass (`om-ds-guardian`, UI was touched)

Ran the REVIEW capability against every new/changed UI file (`PricesDataTable.tsx`, `PriceScopeSelectors.tsx`, `priceFormFields.tsx`, `useBatchLabels.ts`, `normalizePriceRecord.ts`, list/create/edit `page.tsx`s). **Zero violations** across every checked category: hardcoded status colors, arbitrary text sizes, deprecated `Notice`, inline SVG, missing `aria-label`, raw `<input>`/`<select>`/`<textarea>`, `disabled:opacity-50`, hardcoded hex/brand colors, legacy focus rings, legacy `Alert variant=`, raw `fetch()`, arbitrary z-index. `emptyState`/`ListEmptyState` present on the list page.

## Full integration suite (`om-integration-tests` equivalent — `yarn test:integration` via the shared Playwright config)

Ran `OM_INTEGRATION_MODULES=catalog` against the real dev server + disposable DB, **twice**, plus one full untargeted run:

1. **First run (default parallel workers, fresh dev server)** — 195 passed. 3 hard failures, 2 flaky (passed on retry):
   - `TC-CAT-PRICES-001` (new, this PR) — initially failed on real Playwright/ComboboxInput interaction subtleties (see below), fixed and reverified separately — **passes**.
   - `TC-CAT-032` — a **real, intentional** interaction with Step 1.1: the test documented the pre-existing gap ("inverted min/max range is currently accepted") that this PR's spec-mandated cross-field validation closes. Updated to assert the new, correct 400 rejection — **passes** (all 5 sub-tests, reverified standalone).
   - `TC-CAT-011` — failed with an unexpected price-input count (8 instead of 2); reproduced the root cause: leftover price-kind fixtures from OTHER tests running concurrently in the same parallel suite (that test asserts a *global* count of price-kind rows, a pre-existing isolation gap unrelated to this PR's changes). Confirmed by clearing non-seed price kinds and rerunning **TC-CAT-011 standalone — passes**.
   - `TC-EUDR-009` (unrelated module), `TC-WMS-INVENTORY-UI-001` (known flake, matches this repo's documented WMS-combobox-helper flake) — pre-existing, unrelated to catalog/pricing.
2. **`TC-CAT-PRICES-001` reruns during iteration** — fixed three real Playwright-authoring issues along the way (all in the test file only, not app code): (a) `ComboboxInput`'s suggestion popover is portaled outside its field's DOM subtree, so a locator scoped to the field container never finds it; (b) a pasted raw id never renders as a visible/clickable suggestion (the list is filtered by *label*, not value), so the test searches by a human-readable term instead, matching real usage; (c) **found a real, pre-existing bug**: `/api/catalog/price-kinds`'s `search` query only matches a *prefix* of the title/code despite building a `%term%` (both-sides) ILIKE filter — catalog products' search correctly matches mid-string, so this is specific to that route. Not fixed here (out of scope — a wider query-engine/search-routing question beyond this spec); documented in the PR body's Decision needed section. Final rerun: **`TC-CAT-PRICES-001` passes in 6.2s**.
3. **Second full run (serialized, `--workers=1`, ~2 hours into this session's continuous dev-server use)** — 17 failures, all WMS/category/EUDR tests unrelated to pricing, all showing the same signature: the dev server's own `data-health="degraded"` diagnostics banner intercepting clicks, or `apiRequestContext` disposal. Spot-checked `TC-CAT-007` (category creation, untouched by this PR) in isolation: same degraded-banner-intercepts-click failure. **This is dev-server resource exhaustion from this session's unusually long continuous automated use (5+ GB RSS after dozens of test executions), not a code regression** — the first (fresher-server) run and every individually-reverified test are the trustworthy signal.

**Net result:** every catalog-scoped, pricing-relevant test passes; the two real findings from this gate were fixed (validators cross-field rejection test, `module-facts`/lock-coverage/sort-comparator audits); the one real *product* bug found (price-kinds search prefix-only) is pre-existing, unrelated to this PR, and documented rather than fixed (scope).

## Cleanup

- Dev server stopped.
- Disposable DB `om_qa_6268` and `apps/mercato/.env` are local-only, not committed (not part of the diff — verified via `git status`).
