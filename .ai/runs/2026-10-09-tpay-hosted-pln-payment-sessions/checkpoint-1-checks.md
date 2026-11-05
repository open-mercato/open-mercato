# Checkpoint 1 — steps 1.1..1.4

- **Timestamp:** 2026-10-09T13:30:12Z
- **Steps covered:** 1.1, 1.2, 1.3, 1.3-review-fix, 1.4 (`7ec44b8a3`..`5d33e4bd1`)
- **Touched areas:** new package `packages/gateway-tpay` (scaffold, HTTP client, adapter, status map, callback URL, integration definition, health check, DI), `yarn.lock`
- **Runner:** local (no Open Mercato app container)

| Check | Result | Notes |
|-------|--------|-------|
| `yarn workspace @open-mercato/gateway-tpay typecheck` | ✅ pass | |
| `yarn workspace @open-mercato/gateway-tpay test` | ✅ pass | 8 suites, 128 tests |
| `yarn workspace @open-mercato/gateway-tpay build` | ✅ pass | |
| `yarn i18n:check-sync` | ✅ pass | five locales in sync |
| `npx eslint packages/gateway-tpay/src` | ✅ pass | |
| UI verification | ⏭️ skipped | no UI-rendering files touched in this window |

Review notes: Step 1.3 swallowed provider/translation errors without `reportError`; fixed in `1.3-review-fix` (`75d7119fe`).
