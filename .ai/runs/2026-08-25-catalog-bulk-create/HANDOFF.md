# HANDOFF — Catalog Bulk-Create (Products & Categories)

**PR:** #5610 (`feat/catalog-bulk-create` → `develop`, fork `adeptofvoltron/open-mercato`)
**Status:** in-progress
**Last commit:** `0db68c727`
**Next concrete action:** Phase 3 — Step 3.1 (i18n + job-detail surfacing for the two new `jobType`s, `catalog.categories.bulk_create` and `catalog.products.bulk_create`, in `ProgressTopBar`) and Step 3.2 (docs for both endpoints in `apps/docs`). Then the spec-correction commit to `.ai/specs/2026-08-25-catalog-bulk-create.md` described below. Then the final gate (Step 7 of the skill) and `om-auto-review-pr --autofix` (Step 8).

## Current Tasks-table state (see PLAN.md for the authoritative table)

All of Phase 1 (1.1–1.4) and Phase 2 (2.1–2.4) are `done`. Phase 3 (3.1, 3.2) is `todo`. The Non-goals section's original reference-data-memoization intent for products was formally dropped by operator decision (history below) — Phase 2 ships pre-validation only, matching Phase 1's design.

## What landed since resume start

- Migrated the legacy flat plan into this run folder, committed the previously-unlanded spec doc.
- Phase 1: categories bulk-create — route, validators, worker, lib (batch pre-validation + checkpoint/resume), 7 unit tests. Checkpoint 1 clean.
- Step 1.3: integration-style test (loads the real `catalog.categories.create` command through the bulk worker) verifying `dataEngine.markOrmEntityChange` fires once per row with the command's unchanged event wiring. Documents that this command passes no `indexer` config today.
- Phase 2: products bulk-create — route, validators (`productBulkCreateRowSchema`/`productsBulkCreateSchema`), worker, lib (SKU/handle pre-validation + checkpoint/resume, same pattern as Phase 1), 8 unit tests. This satisfies the redefined Step 2.3 (pre-validation fail-fast assertions, since no identity-map mechanism exists to measure) and Step 2.4 (checkpoint/resume parity) in the same test file.
- Checkpoint 2 recorded in `checkpoint-2-checks.md`: `generate`, `build:packages`, `typecheck` (27/27), `test catalog` (1437/1438 suites — the one failure is the same pre-existing Polish-locale issue noted at checkpoint 1), `eslint` on every new/changed file, `i18n:check-hardcoded` (catalog module not flagged) — all clean.

## Reference implementation

`packages/core/src/modules/catalog/api/bulk-delete/route.ts`, `workers/catalog-product-bulk-delete.ts`, `lib/bulkDelete.ts` — the scaffolding pattern both phases mirror (route → `ProgressJob` → `@open-mercato/queue` → worker → lib).

## Environment / worktree

- Worktree: `~/workspace/OpenMercatoTest/.ai/tmp/om-auto-create-pr/catalog-bulk-create-20260825-115305` (branch `feat/catalog-bulk-create`, remote `fork` = `adeptofvoltron/open-mercato`, PR is cross-repository).
- `.ai/agentic.config.json`: `baseBranch: develop`, `qaGate: true`, labels enabled, validation gate = `yarn build:packages`, `yarn generate`, `yarn build:packages`, `yarn i18n:check-sync`, `yarn i18n:check-usage`, `yarn typecheck`, `yarn test`, `yarn build:app`.

## Remaining work

1. **Step 3.1** — i18n labels + job-detail surfacing for `catalog.categories.bulk_create` / `catalog.products.bulk_create` in `ProgressTopBar` (find the existing `jobType` → i18n-key mapping the `bulk-delete` jobType already uses and mirror it).
2. **Step 3.2** — docs for both new endpoints under `apps/docs`.
3. **Spec correction commit** — edit `.ai/specs/2026-08-25-catalog-bulk-create.md`'s Architecture/Risks sections per the "Concrete scope for Phase 2" note in the decision history below. Docs-only, its own commit.
4. **Step 7 (final gate)** — full `validation.commands` gate, integration suite via `om-integration-tests` (or a documented skip reason — this PR's changes are backend-only, no `.tsx` touched, so a Playwright UI pass may not be warranted; decide at that point per the skill's UI-verification rule), style-compliance pass.
5. **Step 8** — `om-auto-review-pr 5610 --autofix`.
6. **Steps 9–10** — comprehensive summary comment (must explicitly state the products memoization goal was dropped and why, and that the spec was corrected), label normalization, draft→ready promotion, lock release.

## Decision history: reference-data caching (fully resolved — do not re-open)

The spec's core premise — sharing one `EntityManager` across a batch so the create commands' internal reference-data lookups hit the identity map after the first occurrence — **does not work as designed**. `EntityManager.fork()` defaults `clear: true` in this repo's MikroORM version, and `createCategoryCommand.execute`/`createProductCommand.execute` both fork with no options, so every row's command call gets a fresh, empty identity map. A repo has no MikroORM result cache to serve a hit another way.

Three sequential attempts at a fix, each caught and stopped before landing non-functional code:

1. **`em.fork({ clear: false })` in the create commands** — would work, but touches a Resolved-Assumption-#3-protected contract surface (the create commands are supposed to stay entirely unchanged). **Operator rejected this.**
2. **`export` the two lookup helpers (`resolveScopedTaxRate`, `resolveProductUnitDefaults`) for a worker-side memoization wrapper** — operator initially approved this as a smaller, additive-only edit. Before implementing, traced the actual call sites in `commands/products.ts` (`execute()` calls both functions by direct module-local reference) and found this is a **no-op**: exporting a function doesn't change what `execute()` itself calls, so a wrapper built around the exported copy is never consulted. No code was written against this plan once the no-op was confirmed.
3. **Genuinely editing `execute()`'s call sites** to accept and use an optional batch-scoped cache — the only mechanism that would actually work, but a strictly bigger edit than either prior option, touching the same protected surface as option 1's rejected `.fork()` change.

**Final operator decision (2026-08-25):** drop the reference-data memoization goal for products entirely. Do not edit `commands/categories.ts`/`commands/products.ts` in any way — this question is closed, not open for a fourth variant. Phase 2 ships pre-validation only (SKU/handle uniqueness, mirroring Phase 1's slug/parentId pattern), which is what landed. The spec itself needs a correction commit (see "Remaining work" above) so `.ai/specs/2026-08-25-catalog-bulk-create.md` states this as a known permanent constraint rather than a risk to verify.

## Blockers

None.
