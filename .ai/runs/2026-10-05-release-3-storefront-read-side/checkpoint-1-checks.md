# Checkpoint 1 — Phase 1 (prerequisites)

**Timestamp:** 2026-10-05T11:05:17Z
**Steps covered:** 1.1–1.6 (8be09af845 .. 068dda8806)
**Runner:** local mode (no compose `app` container)
**Touched areas:** packages/shared catalog-visibility; core catalog pricing lib + price-row indexes; core customer_groups service, validators, terms route, migration.

| Check | Result | Notes |
|---|---|---|
| `yarn turbo run typecheck --filter=@open-mercato/shared --filter=@open-mercato/core --force` | ✅ pass | 2/2 tasks, cache bypassed |
| `yarn workspace @open-mercato/shared test src/lib/catalog-visibility` | ✅ pass | 5 suites, 53 tests |
| `yarn workspace @open-mercato/core test src/modules/catalog src/modules/customer_groups src/__tests__/hot-path-indexes` | ✅ pass | 106 suites, 1051 tests |
| `yarn db:generate` drift probe | ✅ catalog + customer_groups: no changes | unrelated pre-existing wms snapshot drift is discarded each run (not ours) |
| UI verification | ⏭️ skipped | no UI touched in Phase 1 |
| Integration suite | ⏭️ deferred | migrations not applied locally (owner approval required before `yarn db:migrate`) |

Step review mode: `final` (no per-checkpoint review).
