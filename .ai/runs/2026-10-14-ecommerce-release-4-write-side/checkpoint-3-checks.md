# Checkpoint 3 — Steps 8.1–8.5 (QA fixes F14, F12, CONC-05, F10, F15/F13)

**Range:** `7a0a001bf2..cb1cdd3ab4` (Steps 8.1, 8.2, 8.4, 8.5 landed code; Step 8.3 was discovered already-fixed by pre-Phase-8 commit `dd0747db83` — no new commit, Tasks row flipped via the `7a0a001bf2` docs-only correction commit).

| Step | Commit | Summary |
|---|---|---|
| 8.1 | `d7e9118b44` | Narrow `fetchLinePriceRows` to the line's own variant (QA F14) |
| 8.2 | `c5be747249` | Line mutations (`add`/`update`/`remove`/`bulkAdd`) recompute promotions + totals in the same `withAtomicFlush` (QA F12) |
| 8.3 | `dd0747db83` (pre-existing) | CONC-05 advisory-lock fix already shipped before Phase 8 reopened; no new work |
| 8.4 | `30090ba149` | `CartView.promotions` now a real `AppliedPromotionView[]` (QA F10) |
| 8.5 | `cb1cdd3ab4` | `409 cart_not_active` on non-active-cart writes; warning messages routed through i18n, no more raw `[internal]` leaking to buyers (QA F15, F13) |

Also landed in this window (docs-only, no code): `7a0a001bf2` corrected two executors' stale Commit-cell SHAs and documented the Step 8.3 discovery.

## Targeted validation (re-run independently by the orchestrating session, not just trusted from executor reports)

| Check | Result |
|---|---|
| `yarn build:packages --force` (root, full monorepo — these files are consumed well beyond `cart`/`promotions`) | ✅ 39/39 tasks, clean |
| `yarn generate` | ✅ clean, no diffs |
| `yarn workspace @open-mercato/core run typecheck` | ✅ clean, 0 errors (incidentally resolved 4 pre-existing errors in `lines.ts` as a side effect of Step 8.2's restructuring) |
| `cd packages/core && jest src/modules/cart src/modules/promotions` | ✅ 35 suites / 419 tests passing (was 405 before this window) |
| `totalsEquivalence.property.test.ts` | ✅ still green, unaffected |
| Repo-wide structural guards (`optimistic-lock-command-coverage`, `command-interceptor-http-coverage`, `explicit-sort-comparators`) | ✅ still 17/17 |
| `npx eslint packages/core/src/modules/{cart,promotions} packages/core/src/modules/catalog/lib/pricing.ts` | ✅ 0 errors, 2 pre-existing warnings (confirmed byte-identical to baseline: `cart/di.ts` anonymous-default-export, an unrelated `promotions` eslint-disable warning) |
| `yarn i18n:check-sync` | ✅ clean, 5/5 locales |
| `yarn i18n:check-hardcoded` | ✅ no new findings for `cart` |

## UI verification

**Skipped — none of Steps 8.1–8.5 touched any UI-rendering file** (no `.tsx`, no `packages/ui/src/**`, no `**/components/**`). All five are backend/API-level fixes (pricing, command logic, response envelope shape, HTTP status codes, i18n message routing). Per the checkpoint contract, UI verification is conditional on UI changes in the window — none occurred, so this portion is correctly skipped, not deferred.

## Live integration specs — deferred, not skipped

Three new live Playwright specs were added in this window and are written + typechecked but **not yet run against a real Postgres + dev-server stack**:
- `TC-CART-PRICE-03-variant-reprice-isolation.spec.ts` (8.1)
- `TC-CART-PROM-05-applied-promotions-view.spec.ts` (8.4)
- `TC-CART-F15-F13-01-non-active-write-and-warning-i18n.spec.ts` (8.5)

(Step 8.2 added Jest-only coverage; no new live spec.)

Each executor judged standing up a fresh disposable-DB + dev-server stack too large a cost for its own single Step, and flagged this transparently in its own NOTIFY.md entry. This mirrors this run's own established precedent (Steps 5.2/5.5, 7.1–7.5/7.6) of deferring live-stack re-verification to a batched moment rather than paying the stack-standup cost per Step. Given Step 8.12 is explicitly scoped as "Phase 8 gate: full repo gate, **the live integration suites for cart/promotions**", these three specs (plus whatever Steps 8.6–8.11 add) will all run live together at that gate, which is the next natural batching point — not deferred indefinitely.

## Outcome

Clean. No blockers. Proceeding to Step 8.6.
