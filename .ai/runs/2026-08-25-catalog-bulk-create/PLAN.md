# Execution Plan: Catalog Bulk-Create (Products & Categories)

Source doc: `.ai/specs/2026-08-25-catalog-bulk-create.md`

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids and `Exec` cells are immutable once the plan is committed.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 1 | 1.1 | Route + validators (categories bulk-create) | inline | done | 86d8beeee |
| 1 | 1.2 | Worker + lib (categories bulk-create) | inline | todo | — |
| 1 | 1.3 | Verify events/index fire per row unchanged | inline | todo | — |
| 1 | 1.4 | Checkpoint + idempotent resume | inline | todo | — |
| 2 | 2.1 | Worker + pre-warm (products bulk-create) | inline | todo | — |
| 2 | 2.2 | Route + validators (products bulk-create) | inline | todo | — |
| 2 | 2.3 | Identity-map hit-rate verification | inline | todo | — |
| 2 | 2.4 | Per-row failure + checkpoint/resume parity | inline | todo | — |
| 3 | 3.1 | i18n + job-detail surfacing | inline | todo | — |
| 3 | 3.2 | Docs | inline | todo | — |

## Goal

Add `POST /api/catalog/products/bulk-create` and `POST /api/catalog/categories/bulk-create`, modeled on the existing `bulk-delete` route's `ProgressJob` + `@open-mercato/queue` scaffolding, but resolving shared reference-data lookups (tax rate, option-schema template, unit defaults) once per batch via a shared/forked `EntityManager`'s identity map — while still calling the unchanged `catalog.products.create` / `catalog.categories.create` commands per row (no command-layer bypass, no new bulk-only entity-creation logic, no new event IDs, no new ACL feature IDs).

## Scope

- Two new API routes, two new queue workers, two new lib files, validators, ACL wiring reuse, tests (unit + integration) per the spec's Implementation Plan.
- Two new `ProgressJob` `jobType` values and their i18n labels in `ProgressTopBar`.
- Docs for both new endpoints.

## Non-goals

- No changes to `createProductCommand` / `createCategoryCommand` internals or their public contract.
- No new event IDs, no new ACL feature IDs, no CSV/file upload import path.
- No changes to the existing `bulk-delete` route/worker.

## Risks

- Identity-map hit-rate for reference-data lookups depends on whether the create commands' internal lookups (`resolveScopedTaxRate`, `resolveProductUnitDefaults`, option-schema template fetch) go through `em.findOne`/`em.find` (identity-map-eligible) rather than a raw query-builder path. Verified in Phase 2 via a query-count assertion; if bypassed, add a minimal targeted memoization wrapper around just that lookup (spec Architecture section).
- Checkpoint-lag replay window (up to 19 rows) requires natural-key-conflict detection to avoid mis-reporting already-created rows as failures on worker retry.
- `createCategoryCommand`/`createProductCommand` resolve `em` from `ctx.container.resolve('em')` and fork it internally — the shared-identity-map design therefore depends on all rows in a batch sharing one `container` whose `em` registration is the pre-warmed root/chunk `EntityManager`, not on passing an `em` through `ctx` directly (verified while implementing Step 1.2).

## Implementation Plan

### Phase 1: Categories bulk-create

- [ ] 1.1 Route + validators: `packages/core/src/modules/catalog/api/categories/bulk-create/route.ts`, `categoriesBulkCreateSchema`/response schema in `data/validators.ts`, ACL `catalog.categories.manage`, mutation-guard wiring, `ProgressService.createJob`, enqueue to a new catalog queue.
- [ ] 1.2 Worker + lib: `workers/catalog-category-bulk-create.ts` + `lib/bulkCreateCategories.ts` — one root EntityManager + synthetic CommandRuntimeContext, pre-warm slug/parent-id lookups, loop rows via `commandBus.execute('catalog.categories.create', ...)`, forking EntityManager every 100 rows, collecting `failedItems`.
- [ ] 1.3 Verify events/index fire per row unchanged (integration test only, no new code).
- [ ] 1.4 Checkpoint + idempotent resume (`meta.lastCompletedRowIndex` every 20 rows, natural-key-conflict-based replay detection).

### Phase 2: Products bulk-create

- [ ] 2.1 Worker + pre-warm: `workers/catalog-product-bulk-create.ts` + `lib/bulkCreateProducts.ts` — same scaffolding as Phase 1, pre-warming tax-rate/option-schema/unit-default lookups.
- [ ] 2.2 Route + validators: `packages/core/src/modules/catalog/api/products/bulk-create/route.ts`, `productsBulkCreateSchema`.
- [ ] 2.3 Identity-map hit-rate verification (query-count assertion test).
- [ ] 2.4 Per-row failure + checkpoint/resume parity with Phase 1.

### Phase 3: Progress UI polish + docs

- [ ] 3.1 i18n + job-detail surfacing for the two new `jobType`s in `ProgressTopBar`.
- [ ] 3.2 Docs for both new endpoints in `apps/docs`.

## Progress

> Legacy checkbox section, superseded by the `## Tasks` table above as the authoritative status source. Kept for narrative context only — do not edit checkboxes here; flip the Tasks table instead.

### Phase 1: Categories bulk-create

- [ ] 1.1 Route + validators
- [ ] 1.2 Worker + lib
- [ ] 1.3 Verify events/index fire per row unchanged
- [ ] 1.4 Checkpoint + idempotent resume

### Phase 2: Products bulk-create

- [ ] 2.1 Worker + pre-warm
- [ ] 2.2 Route + validators
- [ ] 2.3 Identity-map hit-rate verification
- [ ] 2.4 Per-row failure + checkpoint/resume parity

### Phase 3: Progress UI polish + docs

- [ ] 3.1 i18n + job-detail surfacing
- [ ] 3.2 Docs
