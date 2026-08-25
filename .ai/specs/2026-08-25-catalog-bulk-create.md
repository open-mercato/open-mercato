# Catalog Bulk-Create (Products & Categories)

## 📝 TLDR

Catalog has a bulk-delete endpoint but no bulk-create — importing N products or categories today costs N HTTP requests, each paying the full fixed per-request overhead (auth, ACL, and repeated reference-data lookups: tax rate, option-schema template, unit defaults) on top of the row's own insert work. This spec adds `POST /api/catalog/products/bulk-create` and `POST /api/catalog/categories/bulk-create`, modeled on the existing `bulk-delete` route's `ProgressJob` + `@open-mercato/queue` scaffolding. Unlike `bulk-delete` — which only batches the HTTP/queue/progress plumbing and still loops the same per-row command with its own DB lookups — this endpoint still calls the existing `catalog.products.create` / `catalog.categories.create` commands per row (preserving every command interceptor, guard, and event unchanged) but shares one `EntityManager` across the batch so MikroORM's identity map serves repeated tax-rate/option-schema/unit-default lookups from cache after the first hit, instead of re-querying per row.

## Resolved assumptions (autonomous defaults)

| # | Question | Resolved default | Rationale |
|---|----------|-------------------|-----------|
| 1 | Bundle products + categories in one spec, or split? | Both, in one spec, delivered as two sequential phases (categories first, products second) | They are one capability ("catalog bulk-create") explicitly requested together in the issue; splitting would produce two specs constantly cross-referencing the same scaffolding. Phasing (not splitting) gets independent shippability without spec duplication. |
| 2 | Reuse `bulk-delete`'s exact pattern (batch only the HTTP/queue/progress plumbing, still loop the existing per-row `commandBus.execute(...)` paying its own DB lookups every time), or go further? | Go further: still call the per-row command, but share one `EntityManager` across the batch so its internal reference-data lookups (tax rate, option-schema template, unit defaults) hit MikroORM's identity map instead of the DB after the first occurrence of each distinct value | The issue's premise is that `bulk-delete`'s actual pattern — loop-per-row-command-with-its-own-lookups — does **not** fix "~44 queries/row, mostly fixed context." A plain copy of that pattern for create would ship an endpoint that doesn't address the issue. |
| 3 | To avoid N per-row reference-data lookups, bypass the command layer with new bulk-only helper functions (duplicates command logic, risks silently skipping any interceptor registered on `catalog.products.create`/`catalog.categories.create`), or keep calling the existing command per row and instead share/pre-warm one `EntityManager`'s identity map across the batch? | Keep calling the existing command per row via a shared, job-scoped `EntityManager` (forked periodically to bound memory — see Architecture); no new bulk-only entity-creation logic, no command-layer bypass | AGENTS.md's hard rule is "Never bypass... command side effects" — command interceptors are a first-class extension point other modules may register on these command IDs. Sharing an `EntityManager` for identity-map reuse gets the same reference-data-lookup reduction without touching the command's contract, its tested behavior, or its interceptor pipeline at all. |
| 4 | New ACL feature IDs for bulk-create, or reuse the existing `catalog.products.manage` / `catalog.categories.manage` features already required for single-row create? | Reuse the existing `.manage` features | Matches the `bulk-delete` precedent (reuses `catalog.products.manage` rather than minting `catalog.products.bulk_delete`) and avoids a `sync-role-acls` pass across every existing tenant for a new feature ID. |
| 5 | Should a partial-batch failure (some rows invalid/conflicting) fail the whole job, or complete with per-row failures reported? | Complete with per-row failures reported in `ProgressJob.resultSummary.failedItems`; the job still ends `completed` | Explicitly required by the issue ("partial failures within a batch are surfaced per-row rather than failing the whole batch silently"), matching the existing `customers/lib/bulkDeals.ts` precedent. |
| 6 | Should the bulk-create job be cancellable mid-flight (`ProgressJob.cancellable`)? | Yes (`cancellable: true`), unlike `bulk-delete`'s `false` | Creating is non-destructive to existing data — cancelling mid-batch just stops creating further rows; already-created rows are valid, ordinary records reachable through the standard single-row API and deletable the normal way. `bulk-delete` disables cancellation because a partially-applied delete is destructive/irreversible; that reasoning does not apply here. |
| 7 | Support file/CSV upload for very large imports (the scope of the closed PR #4718)? | No — JSON array request body only, same per-row shape as the existing single-row create schema | Matches the issue's own "Out of scope" section. Clients importing tens of thousands of rows chunk client-side into multiple bulk-create calls, the same way `bulk-delete`/`bulk-update-*` cap batch size rather than accept unbounded payloads. |
| 8 | Emit a new `catalog.product.bulk_created` / `catalog.category.bulk_created` event? | No — the existing per-entity `catalog.product.created` / `catalog.category.created` events fire exactly as they do today, once per row, as a direct consequence of still calling the unchanged command per row (Resolved Assumption #3) | Webhooks subscribe to event ID patterns generically; a new bulk event ID would require every existing webhook/notification consumer to learn a second shape. Because the command itself is unchanged and still emits its normal event per row, this isn't even a separate design choice — it falls out of Resolved Assumption #3. |
| 9 | Request size cap per call | 2,000 items for products, 10,000 for categories (tunable constants) | Products carry more per-row work (offers/categories/tags sync, custom fields) than categories; the lower cap bounds one queue job's runtime and the shared `EntityManager`'s working-set growth. Both are ordinary tunable constants, not a public contract. |
| 10 | `EntityManager` fork boundary (how often to discard the per-row working set to bound memory, while keeping the reference-data cache warm) | Fork a fresh child `EntityManager` from a job-level root every 100 rows; the root `EntityManager` (holding only the pre-warmed reference-data entities) stays alive for the whole job | Keeps the identity map's reference-data hit rate at "resolved once per batch" while preventing unbounded memory growth from every created row's entity accumulating in one `EntityManager` across a 2,000-row batch. |
| 11 | Checkpoint interval (how often to persist `ProgressJob.meta.lastCompletedRowIndex`) | Every 20 rows (tunable), with natural-key-conflict detection on resume so a replayed row within the checkpoint lag window is recognized as already-created rather than reported as a failure | Persisting a checkpoint after every single row adds write load to `ProgressJob` proportional to batch size; a small lag window is safe because it is closed by treating a unique-constraint conflict on a *replayed* row index as "already done, skip" rather than "invalid" — see Edge Cases. |

## 📝 Problem Statement

`packages/core/src/modules/catalog/api/` has a `bulk-delete` route but no bulk-create for products or categories. Each `POST /api/catalog/products` call pays roughly 9-10 explicit DB round-trips around the actual insert — tax-rate lookup, unit-default lookup, option-schema template lookup/assignment, offers/categories/tags dependent-collection sync, custom-field writes, event emission plus query-index upsert, and an audit-snapshot reload — consistent with the issue's measured ~44 queries/call once each helper's internal statements are counted individually. At the measured ~20-30 rows/sec/pod throughput, a catalog on the order of tens of thousands of SKUs (typical B2B/wholesale) takes hours to import.

Critically, the closest existing precedent — `bulk-delete` — does **not** solve this shape of problem: its worker loops `commandBus.execute('catalog.products.delete', ...)` once per ID, so every row still pays its own command-internal DB lookups; `bulk-delete` only removes the *HTTP-request* overhead (N requests → 1 request + N in-process command calls), not the *reference-data-lookup* overhead this issue is about. The same is true of `customers/lib/bulkDeals.ts`'s `bulk-update-owner`/`bulk-update-stage`. A batch entry point that actually resolves reference data once per batch, not once per row, requires going further than either precedent.

Two other in-flight issues (#5605, #2967) target parts of this same per-request overhead (an unscoped `custom_field_defs` scan, schema-cache scoping) — those help every row, including bulk-create's rows, but do not remove the fundamental one-lookup-per-row shape of repeated tax-rate/option-schema/unit-default resolution. `PR #4718` ("high-performance streaming data importers and exporters") explored batch-import for the `customers` module and was closed without merging; it is not being resurrected here, and file/streaming import stays explicitly out of scope (Resolved Assumption #7).

## 📝 Proposed Solution

Add one bulk-create route per entity (`products`, `categories`), each accepting a JSON array of the same per-row shape the single-row create endpoint validates. The route does the cheap, synchronous work only — auth, ACL, request-shape validation, mutation-guard check, `ProgressJob` creation — then enqueues one `@open-mercato/queue` job carrying the whole batch and returns `202` immediately with the `progressJobId`, exactly like `bulk-delete`.

The worker's row loop is the part that genuinely departs from the `bulk-delete`/`bulkDeals` precedent:

1. **One synthetic command context, one job-level root `EntityManager`.** The worker builds a single `CommandRuntimeContext` for the whole job (same idea `bulk-delete`'s worker already uses) plus one root `EntityManager` scoped to the job.
2. **Pre-warm, once for the batch.** Before the row loop, scan every structurally-valid row for the distinct reference-data keys it needs (tax rate IDs, option-schema IDs, UOM values) and issue one batch-fetch query per key type against the root `EntityManager` (e.g. `em.find(TaxRate, { id: { $in: distinctTaxRateIds } })`). This populates the root `EntityManager`'s identity map with every distinct reference-data row the batch will need.
3. **Fork per chunk of 100 rows.** For each row, `commandBus.execute('catalog.products.create'|'catalog.categories.create', { input, ctx })` runs against a **forked child `EntityManager`** (`rootEm.fork()`) that shares the root's identity map for reads but keeps its own working set for the row(s) it creates; the fork is discarded (not the root) every 100 rows, bounding memory growth from newly-created entities while keeping the reference-data cache warm for the whole job. Because the command's internal lookups (`resolveScopedTaxRate(em, ...)`, `resolveProductUnitDefaults(em, ...)`, etc.) already take an `em` parameter, an identity-map hit on the fork means zero additional DB round-trip for a reference-data value already seen earlier in the batch.
4. **Per-row failures are caught, not fatal.** A row that fails validation, hits a missing reference (cache-miss with no DB match either), or violates a DB constraint is caught, pushed into `failedItems`, and the loop continues — exactly matching the `customers/lib/bulkDeals.ts` precedent (Resolved Assumption #5). Because each row still goes through the unchanged command, it gets exactly the same atomicity (its own transaction, its own event emission, its own audit-snapshot capture) the single-row synchronous API already relies on today — this design changes nothing about a single row's own reliability, only how many rows run per HTTP request and how many times shared reference data is fetched from the DB.
5. **Checkpoint + idempotent resume.** After every 20 rows, the worker persists `ProgressJob.meta.lastCompletedRowIndex` (an absolute value, not an increment) via `progressService.updateProgress`. If the queue redelivers the job (worker crash, exception), the worker resumes at `lastCompletedRowIndex + 1`; any row in the small window that may have already been created before the crash (because the checkpoint lags real progress by up to 19 rows) hits its natural unique-constraint conflict on replay, which the worker recognizes as "already created — skip, do not report as a failure" rather than a genuine per-row error (see Edge Cases for the exact detection rule and its documented limitation).
6. **Completion.** `ProgressJob.resultSummary = { createdCount, failedCount, createdIds, failedItems }`, status `completed` (even with partial per-row failures), `failed` (only for whole-batch/infra failures — e.g. the pre-warm query itself erroring, or DB connectivity lost before any row starts), or `cancelled` (a cooperative check between rows).

**Alternatives considered:**
- *Reuse `bulk-delete`'s exact per-row-command-with-its-own-lookups pattern for create too* — rejected (Resolved Assumption #2): ships an endpoint that still resolves tax-rate/option-schema/unit-default context once per row, failing to address the issue.
- *New bulk-only helper functions that duplicate the command's per-row logic and batch-fetch caches directly* — rejected (Resolved Assumption #3): would bypass any interceptor registered on the create commands, violating AGENTS.md's "never bypass... command side effects" rule, and would create a second, drifting copy of already-complex per-row logic (tax resolution, option-schema assignment, offers/categories/tags sync).
- *A new `catalog.product.bulk_created` event* — rejected (Resolved Assumption #8): unnecessary once the unchanged command keeps emitting its normal per-row event.
- *One big chunked SQL transaction per 500 rows with side effects deferred to fire only after the chunk commits* — considered and rejected during review: introduces a non-atomic multi-step sequence (commit → bulk index upsert → event emission → checkpoint) whose crash windows can duplicate or drop side effects without a much more complex outbox-style design. Calling the existing, already-atomic single-row command per row avoids inventing that problem in the first place.
- *CSV/file-based streaming import* — rejected (Resolved Assumption #7), out of scope per the issue.

## 📝 Architecture

```
POST /api/catalog/products/bulk-create        POST /api/catalog/categories/bulk-create
        │ (auth, ACL, mutation guard,                  │ (same shape)
        │  zod array validation,                       │
        │  ProgressService.createJob)                  │
        ▼                                               ▼
  getCatalogQueue(CATALOG_PRODUCT_BULK_CREATE_QUEUE)   getCatalogQueue(CATALOG_CATEGORY_BULK_CREATE_QUEUE)
        │ enqueue({ progressJobId, items, scope })
        ▼
  workers/catalog-product-bulk-create.ts   workers/catalog-category-bulk-create.ts
        │
        ├─ lib/bulkCreateProducts.ts            ├─ lib/bulkCreateCategories.ts
        │   1. validate all rows (zod)          │   1. validate all rows (zod)
        │   2. build 1 root EntityManager +     │   2. build 1 root EntityManager +
        │      1 synthetic CommandRuntimeContext│      1 synthetic CommandRuntimeContext
        │   3. pre-warm: batch-fetch distinct   │   3. pre-warm: batch-fetch existing
        │      tax rates / option-schemas /     │      slugs / parent category IDs
        │      unit-default keys (1 query/type) │      referenced across the batch
        │   4. loop rows: fork em every 100     │   4. loop rows: fork em every 100
        │      rows, call commandBus.execute    │      rows, call commandBus.execute
        │      ('catalog.products.create', …)   │      ('catalog.categories.create', …)
        │      — UNCHANGED command, its own     │      — UNCHANGED command, its own
        │      transaction + events per row     │      transaction + events per row
        │   5. checkpoint every 20 rows,        │   5. checkpoint every 20 rows,
        │      idempotent resume on retry       │      idempotent resume on retry
        ▼                                               ▼
  ProgressJob (progress module) — polled/streamed via the existing ProgressTopBar (SSE or poll fallback)
```

Both entities share the route/queue/progress scaffolding (auth, ACL, mutation guard, `ProgressJob` lifecycle, shared-`EntityManager` pre-warm, fork/checkpoint mechanics) as a common pattern; each gets its own validators, pre-warm queries (keyed on the reference data each entity's create command actually looks up), and worker. There is no shared generic "bulk mutate any entity" abstraction in the codebase today, and inventing one is out of scope.

Per repo rules: every new route file exports `openApi`; the mutation-guard contract (`validateCrudMutationGuard` / `runCrudMutationGuardAfterSuccess`) wraps the route the same way `bulk-delete` and `bulk-update-owner`/`bulk-update-stage` do; **the create commands (`catalog.products.create` / `catalog.categories.create`) are entirely unchanged** — same command ID, same validator, same interceptor pipeline, same event emission, same audit-snapshot capture. Nothing about the single-row synchronous API path changes.

Implementation-risk note carried into Phase 2 (flagged for verification during implementation, not a design gap): the exact `EntityManager`-fork identity-map-sharing semantics depend on the ORM version/config in this repo. If any of the create commands' reference-data lookups go through a raw query-builder path that bypasses the identity map (rather than `em.findOne`/`em.find`), the pre-warm step alone will not produce a cache hit for that specific lookup — in that case, add a small, targeted memoizing wrapper around just that lookup call (not a duplicate of the whole command) as a minimal, additive fix, and note the actual hit rate achieved in the Phase 2 PR.

## 📝 Data Model

No new entities, tables, or migrations. Reuses:
- `ProgressJob` (`packages/core/src/modules/progress/data/entities.ts`) — new `jobType` values `catalog.products.bulk_create` / `catalog.categories.bulk_create`; `meta: { lastCompletedRowIndex, checkpointInterval, totalItems }`; `resultSummary: { createdCount, failedCount, createdIds: string[], failedItems: Array<{ index: number, sku?: string, message: string }> }`.
- Existing `CatalogProduct` / `CatalogCategory` (and dependent tables — offers, category assignments, tags) — no schema change; rows are inserted through the same unchanged commands the single-row path already uses.
- Existing `catalog.product.created` / `catalog.category.created` events (`packages/core/src/modules/catalog/events.ts`) — no new event IDs (Resolved Assumption #8), no change to when or how they fire — each still fires exactly once per row, from inside the unchanged command.

## 📝 API Contracts

### `POST /api/catalog/products/bulk-create`

Request:
```ts
{
  items: Array<ProductCreateRow>  // same per-row shape as productCreateSchema, 1..2000 items
}
```
`ProductCreateRow` omits `organizationId`/`tenantId` (taken from the authenticated scope, once, for the whole batch — not per row).

Response `202`:
```ts
{ ok: true, progressJobId: string, message: string }
```
Response `400`: standard validation error (empty array, >2000 items, a structurally invalid row) — no `ProgressJob` is created.
Response `401`/`403`: standard auth/ACL error (`requireAuth: true, requireFeatures: ['catalog.products.manage']`).

### `POST /api/catalog/categories/bulk-create`

Same shape, `items: Array<CategoryCreateRow>` (1..10000), `requireFeatures: ['catalog.categories.manage']`.

### Progress / result retrieval

No new read endpoint — the existing progress-module job-detail path (already consumed by `ProgressTopBar`, SSE with poll fallback) is reused unchanged; `resultSummary` surfaces `createdCount`/`failedCount`/`createdIds`/`failedItems` once the job reaches a terminal status.

## 📝 UI/UX

No new backend page. The existing `ProgressTopBar` already renders any `ProgressJob` by `jobType`; this spec adds two new `jobType` i18n labels ("Bulk product import", "Bulk category import") and surfaces `resultSummary.failedItems` in the job's detail/toast the same way an existing bulk job with partial failures would (no new UI pattern — the standard `ProgressJob` completion-with-failures presentation, reused as-is). Until Phase 3 adds the friendly labels, a job created by Phase 1/2 falls back to the generic job-type label `ProgressTopBar` already shows for any unrecognized `jobType` — functional, just unpolished in the interim.

## 📝 Edge Cases & Failure Scenarios

- **Whole-request validation failure** (malformed JSON, empty/oversized `items` array): `400` before any `ProgressJob` is created — nothing to clean up.
- **Individual row invalid** (schema violation, references a tax rate/option-schema/parent-category ID that resolves to nothing even after a DB lookup): caught by the command's own validation, pushed to `failedItems`, loop continues; the job still completes.
- **Genuine duplicate within the batch** (two distinct row indices carry the same SKU/slug): the second occurrence's command call fails its unique-constraint check against the first (already committed) row; caught, pushed to `failedItems` — this is real, reportable input data problem.
- **Worker crash / queue retry mid-batch**: the queue redelivers the job; the worker reads `ProgressJob.meta.lastCompletedRowIndex` and resumes at `lastCompletedRowIndex + 1`. Because the checkpoint is only persisted every 20 rows, up to 19 already-created rows may be replayed. Each replayed row's command call hits the same unique-constraint conflict a genuine duplicate would — the worker distinguishes this case by checking, **only for rows in the resume window**, whether a row with the same natural key already exists before attempting the command call; a match is treated as "already created by a prior attempt — skip, do not add to `failedItems`, do not re-run" rather than a failure. **Documented limitation**: this pre-check does not distinguish "created by this exact job's prior attempt" from "coincidentally created by an unrelated concurrent request between the crash and the resume" — the rare latter case is treated the same way (skipped, not reported), which is an acceptable, documented tradeoff given such cross-actor SKU collisions would themselves already be a data-integrity concern independent of this endpoint. A future hardening (tagging created rows with their originating `progressJobId`) is noted as a possible follow-up, not required for Phase 1/2.
- **Whole-batch/infra failure** (e.g., a pre-warm query itself throws, DB connection lost before any row starts): `ProgressService.failJob(...)` — the whole job ends `failed`; the queue's own retry policy (`attempts: 3`, exponential backoff) still applies per the standard worker contract.
- **User cancels mid-flight**: cooperative check (`progressService.isCancellationRequested`) between rows (or small row groups); the worker stops before the next row, marks the job `cancelled`, and reports `resultSummary` for the rows that did complete. Already-created rows remain (creation is non-destructive — Resolved Assumption #6); no batch-level undo is introduced — cancelling does not roll back rows already committed by the unchanged, already-atomic per-row command.
- **Reference-data cache miss** (a row's tax-rate/option-schema/UOM value wasn't captured by the pre-warm scan — should not normally happen since the scan covers every structurally-valid row, but is possible if a malformed row's reference field only becomes resolvable after partial normalization inside the command): the command's own internal lookup runs its normal DB query as a fallback: no duplicate logic, since it's the same command that always did this lookup — the only change is that in the common case it's now an identity-map hit. Cache-miss fallbacks are logged via the structured logger (`createLogger`) so the batch's actual reference-data cache-hit rate is observable in production.

## 📝 Risks & Impact Review

- **Blast radius**: two new, additive API routes, two new queue workers, two new lib files, one new pair of `jobType`/i18n label additions. No existing route, schema, event ID, or DI key changes (per `BACKWARD_COMPATIBILITY.md` §5/§7/§9/§10 — no new event IDs at all per Resolved Assumption #8; new routes and reused ACL feature IDs are both explicitly additive/OK per the compatibility matrix).
- **`createProductCommand`/`createCategoryCommand` are completely unchanged** (Resolved Assumption #3) — every existing interceptor, guard, event, and test for the single-row create path is unaffected. There is no code-duplication risk because there is no second copy of the per-row logic.
- **Rollback**: no migrations, no schema change — rollback is reverting the PR (removing the two routes/workers) or disabling via ACL. Existing single-row create/delete behavior is unaffected either way.
- **Interaction with #5605/#2967**: this endpoint's custom-field write path still goes through the same custom-field-defs resolution those issues target; if they land first, this endpoint benefits automatically (tenant-scoped caching) without any change here. This spec does not duplicate that fix.
- **Content-proportional work is not reduced, and the spec does not claim otherwise**: offers/categories/tags dependent-collection sync and custom-field value writes are proportional to each row's own content, not shared reference data — they run once per row today and once per row here too. This endpoint's win is specifically: (a) eliminating N-1 redundant HTTP-request/auth/ACL overhead instances by running the whole batch inside one async worker instead of N synchronous requests, and (b) eliminating N-1 redundant *shared reference-data* DB lookups (tax rate, option-schema template, unit defaults) via the identity-map pre-warm — not a reduction in the row-proportional insert/sync work itself.
- **Queue/worker connection budget**: one job holds one root `EntityManager` (bounded — only reference-data rows) plus rotating 100-row forks; combined with the existing worker-concurrency cap, this stays within the documented `DB_POOL_MAX` connection-budget invariant the same way `bulk-delete`'s worker already does.
- **`EntityManager` identity-map hit-rate risk**: flagged in Architecture as an implementation-time verification item — if any reference-data lookup bypasses the identity map (raw query-builder path), the pre-warm step alone won't cache it; the mitigation (a small targeted memoization wrapper around just that lookup) is additive and low-risk, not a redesign.

## 📋 Phasing

- **Phase 1 — Categories bulk-create.** Proves the scaffolding (route, queue, `ProgressJob`, shared-`EntityManager` pre-warm, checkpoint/resume) on the simpler entity first.
- **Phase 2 — Products bulk-create.** Reuses Phase 1's scaffolding; adds the heavier reference-data pre-warm (tax rate, option-schema template, unit defaults) relevant to products.
- **Phase 3 — Progress UI polish + docs.** i18n labels for the new `jobType`s, `resultSummary` surfaced in the job detail view, API docs for both new endpoints.

Each phase ships a working, independently useful capability; Phase 1 alone already gives categories the "resolve reference data once per batch" benefit even before Phase 2 lands.

## 📋 Implementation Plan

### Phase 1 — Categories bulk-create

1. **Route + validators**: add `packages/core/src/modules/catalog/api/categories/bulk-create/route.ts` and the `categoriesBulkCreateSchema`/`categoriesBulkCreateResponseSchema` in `data/validators.ts` (array of `CategoryCreateRow`, 1..10000). Wire `metadata.POST = { requireAuth: true, requireFeatures: ['catalog.categories.manage'] }`, the mutation-guard contract, and `ProgressService.createJob({ jobType: 'catalog.categories.bulk_create', cancellable: true, totalCount: items.length })`, then enqueue to a new `getCatalogQueue(CATALOG_CATEGORY_BULK_CREATE_QUEUE)`. Export `openApi`.
   - Test: route returns `202` + `progressJobId` for a valid batch; `400` for an empty or >10000-item array; `401`/`403` without auth/ACL.
2. **Worker**: add `packages/core/src/modules/catalog/workers/catalog-category-bulk-create.ts` and `packages/core/src/modules/catalog/lib/bulkCreateCategories.ts`. Build one root `EntityManager` + synthetic `CommandRuntimeContext` for the job; pre-warm by batch-fetching existing slugs for the org and every parent-category ID referenced across the batch (one query per type); loop rows, forking a child `EntityManager` every 100 rows, calling `commandBus.execute('catalog.categories.create', { input, ctx })` per row **unchanged**; catch per-row failures (slug conflict, missing/cyclical parent, DB constraint) into `failedItems`.
   - Test (integration): a batch of 50 valid categories completes with `createdCount=50`; a batch of 10 where 1 row references a non-existent parent completes with `createdCount=9`, `failedItems.length=1`, job status `completed`.
3. **Verify events/index fire per row as today**: because the command is unchanged, `catalog.category.created` and the query-index upsert already fire per row exactly as the single-row API does — this step is a verification test, not new code.
   - Test (integration): after a bulk-create call, a query-index entry and a fired `catalog.category.created` event exist for every created ID exactly once.
4. **Checkpoint + idempotent resume**: persist `meta.lastCompletedRowIndex` every 20 rows via `progressService.updateProgress`; on worker re-invocation with the same `progressJobId`, resume from `lastCompletedRowIndex + 1`, pre-checking natural-key existence for rows in the resume window before calling the command (per Edge Cases).
   - Test (integration): simulate a worker throw after row 15 of 40 (mid-checkpoint-window); re-invoke the worker for the same job; assert rows 16-40 process, rows already created before the crash are recognized and skipped (not duplicated, not reported as failures), and `resultSummary.createdCount` equals the true total.

### Phase 2 — Products bulk-create

5. **Worker + pre-warm**: add `packages/core/src/modules/catalog/workers/catalog-product-bulk-create.ts` and `packages/core/src/modules/catalog/lib/bulkCreateProducts.ts`, mirroring Phase 1's root-`EntityManager`/fork/checkpoint mechanics. Before the row loop, scan all structurally-valid rows for distinct `taxRateId`s, `optionSchemaId`s, and UOM values, and batch-fetch each set via the root `EntityManager` (`em.find(...)` per type) to pre-warm the identity map; loop rows, forking every 100, calling `commandBus.execute('catalog.products.create', { input, ctx })` per row unchanged.
   - Test (integration): a batch of 100 products sharing 2 distinct tax rates and 1 option schema completes with `createdCount=100`, and the tax-rate/option-schema lookup queries are asserted (via spy/query-count instrumentation on the shared `EntityManager`) to run a small constant number of times matching the distinct-value count, not once per row.
6. **Route + validators**: add `packages/core/src/modules/catalog/api/products/bulk-create/route.ts` and `productsBulkCreateSchema` (array of `ProductCreateRow`, 1..2000), mirroring Phase 1 Step 1's scaffolding with `requireFeatures: ['catalog.products.manage']` and `jobType: 'catalog.products.bulk_create'`.
   - Test: same shape as Phase 1 Step 1's route test, adjusted for the 2000-item cap.
7. **Identity-map hit-rate verification**: confirm (via the Step 5 test's query-count assertion) that `resolveScopedTaxRate`/`resolveProductUnitDefaults`/option-schema-template lookups actually hit the identity map on the shared/forked `EntityManager`; if any lookup bypasses it (raw query-builder path), add the minimal targeted memoization wrapper noted in Architecture and re-run the test.
   - Test: the Step 5 query-count assertion is the pass/fail signal for this step; document the achieved hit rate in the PR description.
8. **Per-row failure + resume parity with Phase 1**: apply the exact same `failedItems` collection and checkpoint/resume mechanics as Phase 1 Steps 2 and 4, for products.
   - Test (integration): mirrors Phase 1 Steps 2 and 4's tests for products.

### Phase 3 — Progress UI polish + docs

9. **i18n + job detail surfacing**: add locale entries for the two new `jobType`s in `ProgressTopBar`'s label map; confirm `resultSummary.failedItems` renders in the existing partial-failure presentation (no new UI component).
   - Test: a snapshot/rendering test for the new `jobType` labels; reuse of the existing failed-items UI is verified by an existing bulk-job-with-failures test fixture if one exists, otherwise a new one modeled on it.
10. **Docs**: document both new endpoints (request/response shape, cap, partial-failure model, `ProgressJob` reuse, and the "unchanged command per row + shared `EntityManager`" mechanism) in the catalog API reference under `apps/docs`; cross-link this spec and note the additive-only compatibility stance.
