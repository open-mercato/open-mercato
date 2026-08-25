# HANDOFF — Catalog Bulk-Create (Products & Categories)

**PR:** #5610 (`feat/catalog-bulk-create` → `develop`, fork `adeptofvoltron/open-mercato`)
**Status:** in-progress
**Last commit:** `0fd7a9085` (docs commit follows to record its own SHA in the Tasks table — see PLAN.md)
**Next concrete action:** Step 1.3 — write the integration test confirming `catalog.category.created` fires and a query-index entry is written exactly once per row created via `POST /api/catalog/categories/bulk-create` (no new production code; the command is unchanged, so this is verification only). Then continue to Phase 2 (products bulk-create) per PLAN.md's Tasks table.

## What landed this resume

- Migrated the legacy flat plan into this run folder (`PLAN.md` + Tasks table + this file + `NOTIFY.md`), and committed the spec doc (`.ai/specs/2026-08-25-catalog-bulk-create.md`) the PR body already referenced but that was never landed by the interrupted creator run.
- Step 1.1: `POST /api/catalog/categories/bulk-create` route + `categoriesBulkCreateSchema`/`categoryBulkCreateRowSchema` validators.
- Step 1.2 + 1.4 (landed together — see PLAN.md Tasks table note): `lib/bulkCreateCategories.ts` + `workers/catalog-category-bulk-create.ts` — batch pre-validation, per-row `commandBus.execute('catalog.categories.create', ...)`, per-row failure collection, cooperative cancellation check, checkpoint/resume via `ProgressJob.meta.lastCompletedRowIndex` with a dynamic (not fixed-window) resume-boundary search. 7 unit tests in `lib/__tests__/bulkCreateCategories.test.ts`, all passing.
- Checkpoint 1 recorded in `checkpoint-1-checks.md`: `build:packages` → `generate` → `build:packages`, `typecheck` (27/27), `test catalog` (1435/1436 suites — the one failure is a pre-existing, unrelated Polish-locale issue in `warranty_claims`), `eslint`, `i18n:check-hardcoded` all clean.

## Architecture finding that changes Phase 2's scope (full reasoning in NOTIFY.md)

The spec's core premise — "share one `EntityManager` across the batch so the create command's internal reference-data lookups hit the identity map after the first occurrence" — **does not work as literally designed**. Verified by reading this repo's installed `@mikro-orm/core` `ForkOptions` typedef: `EntityManager.fork()` defaults `clear: true` (a cleared, not inherited, identity map). `createCategoryCommand.execute` / `createProductCommand.execute` both call `(ctx.container.resolve('em') as EntityManager).fork()` with no options, so every row's command call gets a fresh, empty identity map regardless of what a worker pre-fetches into the container's own `em` beforehand — and this repo configures no MikroORM result cache that could serve a hit another way.

This is a harder blocker than the risk the spec's Architecture section anticipated (a raw query-builder path bypassing the identity map): it holds even when every lookup goes through `em.findOne`/`em.find`. Given the create commands are contractually unchanged (Resolved Assumption #3), the pre-warm cannot deliver the stated DB-lookup-count reduction through this mechanism.

**Phase 1 impact:** none on correctness — the "pre-warm" step was implemented instead as a batch pre-validation pass (fail rows with an already-taken slug or missing parent before calling the command at all), which is genuinely useful and does not misrepresent MikroORM's behavior.

**Phase 2 impact (needs a decision before Step 2.1):** products' reference-data optimization (tax rate / option-schema / unit-default lookups) is the spec's headline value proposition, and it runs into the same wall. Step 2.3 ("Identity-map hit-rate verification") will measure ~0% hit rate under the current design. Two paths, neither exercised yet:
1. **Targeted memoization wrapper** (the spec's own sanctioned fallback) around the specific lookup helper functions (`resolveScopedTaxRate`, `resolveProductUnitDefaults`, option-schema-template fetch) — viable only if those are separately-callable helpers the worker can wrap/pre-populate a batch-scoped cache for, without editing the command's own `execute()`. Not yet confirmed whether they're structured that way — check `commands/products.ts` first.
2. **Minimal command change** (`em.fork({ clear: false })` instead of `em.fork()`) — would actually work, but touches a Resolved-Assumption-#3-protected contract surface ("the create commands are entirely unchanged") and should not be decided unilaterally; needs explicit operator sign-off before touching `commands/categories.ts`/`commands/products.ts`.

Recommend surfacing this to the operator before Step 2.1 rather than picking a path autonomously, since it changes what Phase 2 can credibly claim to deliver.

## Reference implementation

`packages/core/src/modules/catalog/api/bulk-delete/route.ts`, `workers/catalog-product-bulk-delete.ts`, `lib/bulkDelete.ts`, `lib/__tests__/bulkDelete.test.ts` — still the right scaffolding pattern to mirror for Phase 2 (route → `ProgressJob` → `@open-mercato/queue` → worker → lib), modulo the identity-map finding above.

## Environment / worktree

- Worktree: `~/workspace/OpenMercatoTest/.ai/tmp/om-auto-create-pr/catalog-bulk-create-20260825-115305` (branch `feat/catalog-bulk-create`, remote `fork` = `adeptofvoltron/open-mercato`, PR is cross-repository). `yarn install` was run this resume (worktree had no `node_modules`).
- `.ai/agentic.config.json`: `baseBranch: develop`, `qaGate: true`, labels enabled, validation gate = `yarn build:packages`, `yarn generate`, `yarn build:packages`, `yarn i18n:check-sync`, `yarn i18n:check-usage`, `yarn typecheck`, `yarn test`, `yarn build:app`.

## Blockers

None hard-blocking Step 1.3, but the Phase 2 architecture question above should be surfaced to the operator before starting Step 2.1.
