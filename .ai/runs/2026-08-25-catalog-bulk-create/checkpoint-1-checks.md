# Checkpoint 1 — Steps 1.1, 1.2, 1.4 (Phase 1: Categories bulk-create)

**Step range:** 1.1 → 1.4 (1.3 not yet landed — see below)
**Commit range:** `86d8beeee`..`0fd7a9085` (plus the resume seed commit `5ecb320c3`/`c949372` migrating the plan into this run folder)
**Touched areas:** `packages/core/src/modules/catalog/data/validators.ts`, `packages/core/src/modules/catalog/api/categories/bulk-create/route.ts`, `packages/core/src/modules/catalog/lib/bulkCreateCategories.ts`, `packages/core/src/modules/catalog/lib/__tests__/bulkCreateCategories.test.ts`, `packages/core/src/modules/catalog/workers/catalog-category-bulk-create.ts`. No UI/`.tsx` files touched.

## Checks run

| Check | Result | Notes |
|---|---|---|
| `yarn build:packages` | ✅ pass | Run once before `generate` (CLI must be built first in a fresh worktree) and again after. |
| `yarn generate` | ✅ pass | Picked up the new route + worker via auto-discovery; 525 API route files indexed (was 524). |
| `yarn typecheck` | ✅ pass | 27/27 packages, including `@open-mercato/core` (cache miss, executed fresh). |
| `yarn workspace @open-mercato/core test catalog` | ✅ pass (1435/1436 suites) | The one failing suite, `warranty_claims/__tests__/quantity.test.ts`, fails on this machine's Polish decimal-comma locale (`toBe('2.5')` receives `'2,5'`) — pre-existing, unrelated to this change (matches a known locale issue already on file for this repo's local test runs). All catalog suites, including the new `bulkCreateCategories.test.ts` (7/7), pass. |
| `yarn eslint` on the 4 new/changed files | ✅ pass | No findings (one unrelated informational warning about a missing `pages/` directory, printed for every eslint invocation in this repo). |
| `yarn i18n:check-hardcoded` | ✅ pass | New files not flagged. |
| `yarn i18n:check-usage` | ⏭ skipped | Not run this checkpoint — no i18n keys added yet (Phase 3 adds the `jobType` labels); will run at the final gate. |
| `yarn build:app` | ⏭ skipped | Deferred to the final gate (step 7) once all phases land — an app build for a partial Phase 1 slice would not be independently meaningful. |
| UI verification (screenshots) | ⏭ skipped, reason: no UI touched | This checkpoint's diff is API route + worker + lib + unit test only; no `.tsx`, no `packages/ui/src/**`, no `**/components/**`. |

## Step 1.3 status

"Verify events/index fire per row unchanged" is explicitly scoped by the spec as a verification-only integration test (no new production code) — confirming `catalog.category.created` fires and a query-index entry is written exactly once per row created via the bulk-create worker, exactly as the existing single-row path already does (since `commandBus.execute('catalog.categories.create', ...)` is called unchanged). Not yet written in this resume; it is the first `todo` row in the Tasks table and the next concrete action on the following resume.

## Known/open items carried forward (see NOTIFY.md for full reasoning)

- The spec's literal "shared EntityManager identity-map pre-warm" cannot reduce the create command's own internal lookups, given MikroORM's `fork()` defaults to a cleared identity map and the command is unchanged. Implemented instead as batch pre-validation (fail-fast on provably-invalid rows). Flagged for the operator/Phase-2-reviewer rather than resolved unilaterally.
- Checkpoint persistence follows a dynamic resume-boundary search rather than assuming the nominal 20-row lag, because `ProgressService.updateProgress` persists on an internal throttle, not on every call.
