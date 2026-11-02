# Checkpoint 2 — Steps 1.3, 2.1–2.4

Resumed Steps since checkpoint 1: 1.3, 2.1, 2.2, 2.3, 2.4 (5 Steps — checkpoint fires per the skill's every-5 cadence).

## What landed

- **1.3** — `commands/__tests__/categories.bulkCreate.events.test.ts`: loads the real `catalog.categories.create` command through the Step-1.2 bulk worker and asserts `dataEngine.markOrmEntityChange` fires once per row with the command's unchanged `categoryCrudEvents` wiring (same object reference across all rows), one distinct emitted id per row. Documents that this command does not pass an `indexer` config today, so there is nothing index-side for bulk usage to have changed.
- **2.1/2.2/2.4** — `lib/bulkCreateProducts.ts`, `workers/catalog-product-bulk-create.ts`, `api/products/bulk-create/route.ts`, `productBulkCreateRowSchema`/`productsBulkCreateSchema` in `data/validators.ts`. Mirrors Phase 1's categories scaffolding exactly (route → `ProgressJob` → `@open-mercato/queue` → worker → lib → unchanged `catalog.products.create` command per row), with SKU/handle fail-fast pre-validation instead of slug/parentId, and the same dynamic resume-boundary checkpoint/resume design as Phase 1.
- **2.3 (redefined per operator decision)** — no identity-map/memoization hit-rate exists to measure (see HANDOFF.md's "Third finding"), so this step's test target changed to asserting the pre-validation behavior instead: a row with a colliding SKU/handle (against existing DB rows or an earlier row in the same batch) never reaches the command; a valid row calls the command exactly once.
- 8 new unit tests in `lib/__tests__/bulkCreateProducts.test.ts` (create-all, sku-conflict, handle-conflict, in-batch sku collision, command-error-continues-batch, resume-recognizes-prior-row, cancellation-mid-flight, checkpoint-on-final-row) — all passing.

## Validation run

- `yarn generate` — clean, 526 API route files discovered (was 525 before the new products bulk-create route).
- `yarn build:packages` — clean, `@open-mercato/core:build` found 4352 entry points, built successfully.
- `yarn typecheck` — clean across all 27 typecheck tasks (0 `error TS` lines in the full log).
- `yarn workspace @open-mercato/core test catalog` — 1437/1438 suites pass (11564/11568 tests). The one failing suite, `warranty_claims/__tests__/quantity.test.ts` (2 tests), fails on this machine's Polish decimal-comma locale — pre-existing, unrelated to this PR (documented in checkpoint 1 already).
- `npx eslint` on every new/changed file this checkpoint (`bulkCreateProducts.ts`, `bulkCreateProducts.test.ts`, `catalog-product-bulk-create.ts`, `products/bulk-create/route.ts`, `validators.ts`, `categories.bulkCreate.events.test.ts`) — clean, no issues.
- `yarn i18n:check-hardcoded` — `catalog` module does not appear in the flagged-modules list; the new fail-fast failure messages (`"Product SKU already exists..."`, `"Product handle already exists..."`) follow the identical, already-passing pattern from Phase 1's `"Category slug already exists..."` message.

No UI was touched this checkpoint, so no screenshots were captured.

## Commits this checkpoint

- `012e1ad94` — Step 1.3 test
- `b588e2cc4` — docs fix (Step 1.3 commit sha recorded in Tasks table)
- `5e356dd46` — Steps 2.1–2.4 (products bulk-create)
- `0db68c727` — docs fix (Phase 2 commit shas recorded in Tasks table)

## Remaining

Phase 3 (Steps 3.1 i18n/job-detail surfacing, 3.2 docs) and the spec-correction commit to `.ai/specs/2026-08-25-catalog-bulk-create.md` (per the operator's final decision) are still open.
