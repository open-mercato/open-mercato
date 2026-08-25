# HANDOFF — Catalog Bulk-Create (Products & Categories)

**PR:** #5610 (`feat/catalog-bulk-create` → `develop`, fork `adeptofvoltron/open-mercato`)
**Status:** in-progress
**Last commit:** (pending — this resume's seed commit)
**Next concrete action:** Step 1.1 — add `POST /api/catalog/categories/bulk-create` route + `categoriesBulkCreateSchema` in `data/validators.ts`.

## Where things stand

The PR was opened by an interrupted `om-auto-create-pr` run: only the spec (`.ai/specs/2026-08-25-catalog-bulk-create.md`) and a flat execution plan were produced; no implementation landed. This resume (`om-auto-continue-pr-loop`) migrated the flat plan (`.ai/runs/2026-08-25-catalog-bulk-create.md`) into this run folder and is now starting Phase 1 from scratch.

## Reference implementation to mirror

`packages/core/src/modules/catalog/api/bulk-delete/route.ts`, `workers/catalog-product-bulk-delete.ts`, `lib/bulkDelete.ts`, `lib/__tests__/bulkDelete.test.ts` — the existing bulk-delete scaffolding (route → `ProgressJob` → `@open-mercato/queue` → worker → lib). Bulk-create's worker/lib differ from this precedent in one key way (see below).

## Key implementation note (verified while planning, not yet coded)

`createCategoryCommand.execute` / `createProductCommand.execute` (in `commands/categories.ts` / `commands/products.ts`) resolve their `EntityManager` via `(ctx.container.resolve('em') as EntityManager).fork()` — they do **not** accept an `em` through `ctx` directly. `createRequestContainer()` registers `em` with `asValue(em)` (one instance per container). This means:

- To get the spec's "shared root `EntityManager`, forked every 100 rows" identity-map-reuse behavior, the worker must build its own container (or a child Awilix scope) whose `em` registration points at the job's pre-warmed root/chunk `EntityManager`, and pass **that** container as `ctx.container` to `commandBus.execute(...)` — reusing the plain `createRequestContainer()` per row (like `bulk-delete` reuses one container per whole batch, not per row) would NOT reset `em` between rows, which is actually what we want for identity-map sharing, but every row would then fork the *same* `em` reference repeatedly — need to verify this still bounds memory correctly per the "fork every 100 rows" requirement in Resolved Assumption #10. Recommended approach for Step 1.2: register the job-scoped container with `container.register({ em: asValue(currentChunkEm) })` and re-register a fresh chunk fork every 100 rows, by creating a **child container** per chunk via `container.createScope()` (Awilix) rather than mutating a shared container's `em` registration in place (avoids any concurrent-access surprises even though this worker is single-threaded per job).
- Confirm the actual identity-map-sharing behavior of MikroORM v7's `em.fork()` in this repo (check `packages/shared/src/lib/db/mikro.ts` / ORM config for `useContext`/`clear` defaults) before assuming pre-warm reads are cache hits — this is exactly the risk the spec flags in Architecture/Risks. If forked children do NOT share the parent's identity map by default, the "pre-warm" step needs `{ useContext: true }` (or equivalent) or the memoization-wrapper fallback the spec allows.

## Environment / worktree

- Worktree: `~/workspace/OpenMercatoTest/.ai/tmp/om-auto-create-pr/catalog-bulk-create-20260825-115305` (branch `feat/catalog-bulk-create`, remote `fork` = `adeptofvoltron/open-mercato`, PR is cross-repository).
- `.ai/agentic.config.json`: `baseBranch: develop`, `qaGate: true`, labels enabled, validation gate = `yarn build:packages`, `yarn generate`, `yarn build:packages`, `yarn i18n:check-sync`, `yarn i18n:check-usage`, `yarn typecheck`, `yarn test`, `yarn build:app`.

## Blockers

None yet — this is the resume's first action.
