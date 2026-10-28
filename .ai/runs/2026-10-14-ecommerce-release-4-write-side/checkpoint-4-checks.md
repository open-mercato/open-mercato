# Checkpoint 4 — Steps 8.6–8.10 (QA fixes F2, F1/F3, F5/F8/F4, F7, F9)

**Range:** `8e372e4598..8d9c24baef`.

| Step | Commit | Summary |
|---|---|---|
| 8.6 | `8e372e4598` | Promotion/code partial updates no longer re-apply create-time schema defaults (QA F2) |
| 8.7 | `9827edb6f6` | Currency/budget fields added to the promotion form; rule-tree save surfaces real 422 issues (QA F1, F3) |
| 8.8 | `92cc2c294a` | `Select` for rule/benefit type pickers; labels editor locale `Select` + DS-scale layout + aligned control heights (QA F5, F8, F4) |
| 8.9 | `b0d766608d` | Date-only promotion end date treated as inclusive through end of day, UTC anchor (QA F7) |
| 8.10 | `8d9c24baef` | Static/generated code casing + charset normalized on write and lookup, including a real direct-lookup bypass found and closed in `useCode`'s dynamic-code branch (QA F9) |

Also corrected five executors' stale Commit-cell SHAs (8.6, 8.7, 8.8, 8.9, 8.10) to their real final values in this checkpoint's own commit.

## Targeted validation (re-run independently by the orchestrating session)

| Check | Result |
|---|---|
| `yarn build:packages --force` (root) | ✅ 39/39 tasks, clean |
| `yarn generate` | ✅ clean, no diffs |
| `yarn workspace @open-mercato/core run typecheck` | ✅ clean, 0 errors |
| `cd packages/core && jest src/modules/cart src/modules/promotions` | ✅ 41 suites / 466 tests passing (was 419 at the start of Checkpoint 3's window, 453 after 8.9, 466 after 8.10 — net +47 across this checkpoint's own 5 Steps) |
| `npx eslint packages/core/src/modules/{cart,promotions}` | ✅ 0 errors, same 2 pre-existing warnings as Checkpoint 3 |
| `yarn i18n:check-sync` | ✅ clean, 5/5 locales |
| `yarn i18n:check-hardcoded` | ✅ zero findings attributable to `cart`/`promotions` (916 pre-existing findings across 66 OTHER modules repo-wide, advisory/exit-0, unrelated to this release) |

## UI verification — deliberately deferred to Step 8.12, not skipped

Steps 8.7 and 8.8 both touched UI (`promotionFormFields.tsx`'s new currency/budget fields, `RuleTreeBuilder.tsx`'s error surfacing, `RuleCard.tsx`/`BenefitCard.tsx`'s `Select` swap and `LabelsEditor` DS fixes), so this checkpoint's UI-verification portion is in scope per the checkpoint contract — and genuinely deferred this time, not "nothing to check":

- Two long-running `next-server` processes already active on this machine (ports 3100/3001, owned by other concurrent cezar sessions dating back to September) — starting a third dev server + disposable Postgres + auth bootstrap for a standalone UI pass here risks colliding with that other work, the same caution every dispatched executor in this Phase already exercised (8.2/8.4/8.5/8.7/8.8 each independently made the same call).
- Standing up that stack is a real, non-trivial cost (migrate, seed, auth, server start, Playwright run) that **Step 8.12's own PLAN.md text already explicitly budgets for**: "Phase 8 gate: full repo gate, the live integration suites for cart/promotions, **UI screenshots for 8.7/8.8**." Paying that cost twice — once here, once at 8.12 — would be pure waste for zero additional confidence, since nothing material changes about 8.7/8.8's own UI between now and 8.12 (only 8.11, a docs+guard-test Step, lands in between).
- This mirrors this run's own established precedent from Phases 5 and 7 (Steps 5.2/5.5, 7.1–7.5/7.6) of batching live-stack verification to one designated checkpoint rather than paying the stand-up cost at every Step that touches UI.

**This is the batching point, not an indefinite deferral**: Step 8.12 is the very next Step and is explicitly scoped to cover this. If Step 8.12 is somehow skipped or the live pass can't happen there either, that failure mode must be caught and reported explicitly — it would NOT be acceptable to let this slide a second time.

Six new live Playwright specs now await that one combined live pass: `TC-CART-PRICE-03` (8.1), `TC-CART-PROM-05` (8.4), `TC-CART-F15-F13-01` (8.5), plus `TC-PROM-074`'s own extension (8.7/8.8, now driving the currency field and locale `Select` through the real form).

## Outcome

Clean. No blockers. Proceeding to Step 8.11.
