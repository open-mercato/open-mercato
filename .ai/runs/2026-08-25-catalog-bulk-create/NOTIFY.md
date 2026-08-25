# NOTIFY — Catalog Bulk-Create (Products & Categories)

## 2026-08-25T13:00:00Z — resume paused: second decision point before Step 2.1

Started Step 2.1 per the operator's memoization-wrapper decision. Confirmed `resolveScopedTaxRate`/`resolveProductUnitDefaults` in `commands/products.ts` are separate, wrappable functions (not inlined) — but they are not `export`ed, so wrapping them requires adding `export` to `commands/products.ts` itself. That's a smaller edit than the rejected `.fork({clear:false})` change (no behavior/contract change, purely additive visibility), but it wasn't explicitly covered by the prior decision, which only cleared wrapping "without editing the command's own `execute()`". Stopped and documented full detail + two options in `HANDOFF.md` rather than deciding unilaterally. No code changed this pass; worktree still at commit `0e30d0e62`. Status remains `in-progress`, PR stays draft.

## 2026-08-25T12:30:00Z — operator decision: Phase 2 reference-data caching

The operator was presented all three options from the 2026-08-25T10:40:00Z architecture finding (memoization wrapper / `em.fork({clear:false})` command change / drop the optimization) and chose the **targeted memoization wrapper** (path 1). The `em.fork()` command change is explicitly rejected — `commands/categories.ts`/`commands/products.ts` stay untouched, Resolved Assumption #3 holds.

Next resume (starting Step 2.1) must first confirm `resolveScopedTaxRate`, `resolveProductUnitDefaults`, and the option-schema-template fetch are separately-callable helpers before wrapping them in a batch-scoped memoization cache. If they are inlined in the command with no extractable seam, stop and re-surface to the operator — do not fall back to the rejected command-change path or silently drop the optimization.

## 2026-08-25T12:00:00Z — resume ends, still in-progress

- Status: `in-progress`, PR stays draft. Steps 1.1, 1.2, 1.4 landed (commits `86d8beeee`..`b4c787c8e`); Step 1.3 (integration test, no new code) is the next `todo` row.
- Checkpoint 1 verification and the comprehensive resume summary were posted to PR #5610.
- Architecture finding surfaced to the operator (not resolved unilaterally): the spec's shared-EntityManager identity-map pre-warm does not reduce the create commands' own internal lookups given MikroORM's `fork()` clearing the identity map by default; Phase 2 needs a decision (memoization wrapper vs. a minimal, explicitly-approved command change) before Step 2.1 can credibly deliver the products-side DB-lookup reduction the spec leads with.
- Re-entry: `/om-auto-continue-pr-loop 5610`, starting at Step 1.3.

## 2026-08-25T10:35:00Z — om-auto-continue-pr-loop resume

- Resumed by: @adeptofvoltron
- Resume point: 1.1 (source: this is the PR's first implementation attempt — only the spec and a flat plan existed)
- PR head SHA: e12af46ad
- Action: migrated the legacy flat plan (`.ai/runs/2026-08-25-catalog-bulk-create.md`) into this run folder (`PLAN.md` + `Tasks` table + `HANDOFF.md` + `NOTIFY.md`) per the run-folder-lookup fallback for pre-folder-migration PRs.

## 2026-08-25T10:40:00Z — architecture finding: identity-map pre-warm does not reach the command's internal lookups

While implementing Step 1.2, verified (by reading this repo's installed `@mikro-orm/core` `ForkOptions` typedef) that `EntityManager.fork()` defaults `clear: true` — a **cleared** identity map, not an inherited one. `createCategoryCommand.execute` (and, per its structurally-identical code, `createProductCommand.execute`) call `(ctx.container.resolve('em') as EntityManager).fork()` with **no options**, so every row's command call gets a fresh, empty identity map regardless of what the worker pre-fetches into the container's own `em` beforehand. This repo also configures no MikroORM result cache (`packages/shared/src/lib/db/mikro.ts`), so there is no other layer that could turn a repeated lookup into a cache hit.

This is a more fundamental blocker than the risk the spec's Architecture section anticipated (a raw query-builder path bypassing the identity map) — it holds even when every lookup goes through `em.findOne`/`em.find`, because the identity map itself is discarded before the command's own lookups run. Given the create commands are contractually unchanged (Resolved Assumption #3), the shared-EntityManager pre-warm as literally designed in the spec **cannot** reduce the command-internal reference-data lookups (slug/parent-scope checks for categories; tax-rate/option-schema/unit-default lookups for products in Phase 2).

**Resolution taken for Phase 1:** the "pre-warm" step is implemented instead as a **batch pre-validation pass** — one `em.find` for distinct slugs and one for distinct parent IDs referenced across the batch, used to fail obviously-invalid rows before ever calling the command (real DB-round-trip savings for provably-bad rows), rather than as an (inert) identity-map warm-up. This is documented in a code comment at the top of the pre-warm block in `lib/bulkCreateCategories.ts`.

**Open question for Phase 2 (Step 2.3, "Identity-map hit-rate verification"):** the spec's own query-count assertion test will measure a 0% hit rate for `resolveScopedTaxRate`/`resolveProductUnitDefaults`/option-schema-template lookups under the current design. The spec's own sanctioned fallback is "a small, targeted memoization wrapper around just that lookup call" — viable if those are separately-callable helper functions (not yet confirmed), but does NOT apply to categories' inlined slug/parent checks (no extractable helper to wrap without touching the command itself, which Resolved Assumption #3 forbids). Flagging this for the operator/reviewer rather than deciding unilaterally to modify the create commands' own `.fork()` call, since that would touch a contract surface Resolved Assumption #3 explicitly protects.

## 2026-08-25T11:10:00Z — checkpoint durability note

`ProgressService.updateProgress` persists on an internal throttle (`HEARTBEAT_INTERVAL_MS` = 5000ms, or sooner on a >=1% progress change), not on every call — confirmed by reading `progressServiceImpl.ts`. This means the durably-persisted `meta.lastCompletedRowIndex` can lag further behind actual processing than the nominal 20-row `CHECKPOINT_INTERVAL` would suggest, especially at the throughput the spec itself cites (~20-30 rows/sec). Implemented resume as a **dynamic boundary search** instead of assuming a fixed ~19-row replay window: on resume, every row from `lastCompletedRowIndex + 1` is pre-checked against its natural key (slug, or name+parentId) until the first row that was NOT already created by the prior attempt — since rows are created in array order, every row after that point is guaranteed genuinely new, so the pre-check stops there. This preserves the Edge Cases section's stated behavior (a replayed row is recognized and skipped, not duplicated or misreported as failed) regardless of how large the actual persisted-checkpoint lag turns out to be.

## 2026-08-25T11:40:00Z — checkpoint 1 — Steps 1.1-1.2 (+1.4, landed together)

- Step 1.1: `POST /api/catalog/categories/bulk-create` route + `categoriesBulkCreateSchema`/`categoryBulkCreateRowSchema` in `data/validators.ts`.
- Step 1.2: `lib/bulkCreateCategories.ts` (batch pre-validation, per-row command execution, per-row failure collection, cancellation cooperative check) + `workers/catalog-category-bulk-create.ts`. Checkpoint/resume (Step 1.4) is implemented in the same function — the row loop and its checkpoint bookkeeping are not separable into two independent diffs — so 1.4 is marked `done` against the same commit as 1.2; see the Tasks table.
- Validation run: `yarn generate`, `yarn build:packages` (x2, generate-then-rebuild order), `yarn typecheck` (27/27 packages pass), `yarn workspace @open-mercato/core test catalog` (1435/1436 suites pass; the one failing suite, `warranty_claims/__tests__/quantity.test.ts`, fails on this machine's Polish decimal-comma locale and is unrelated pre-existing drift — same class of failure already on file for this repo's local-machine test runs), `yarn eslint` on the four new/changed files (clean), `yarn i18n:check-hardcoded` (new files not flagged).
- Step 1.3 ("verify events/index fire per row unchanged") is explicitly a verification-only integration test per the spec, not yet written — next action for the following session.
- Phase 2 (products) and Phase 3 (UI polish + docs) not started.
