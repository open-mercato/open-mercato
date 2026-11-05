# Checkpoint 1 — Steps 0.1 through 3.4

**Fired at:** 2026-08-26T06:10Z
**Covers:** Phase 0 (spec approval record), Phase 1 (types + calculation engine + unit tests), Phase 2 (shared mapper extraction), Phase 3 (request schema + upsert decomposition) — 15 of 24 Steps.
**Runner:** local. No compose `app` container is running in this worktree, so the local-mode rule applies and `yarn <cmd>` was used directly.

## Why this checkpoint is late

The cadence calls for a checkpoint every ~5 Steps, which would have put the first one at Step 1.1. It fired here instead, and the reason is worth recording rather than hiding: the reused worktree had no `node_modules` and no generated registries, so until `yarn install`, `yarn build:packages` and `yarn generate` had all completed in that order, *no* validation command could produce a trustworthy signal. Running one earlier would have reported failures that said nothing about the change. Steps 0.1–1.3 were therefore verified by targeted test runs only, and this checkpoint is the first with a full typecheck behind it.

## Environment bootstrap

| Command | Result |
|---|---|
| `yarn install` | ✅ exit 0. The worktree started with no `node_modules`. |
| `yarn build:packages` | ✅ exit 0 — 27/27 turbo tasks successful. |
| `yarn generate` | ✅ exit 0 (1m28s) after the build; **it had failed before it** with `Error: CLI not built. Run "yarn build:packages" first.` This is why the configured gate lists `build:packages` ahead of `generate`. |

An earlier `yarn generate` in this run was recorded as passing when it had not: the command was written as `yarn generate > log 2>&1; echo "exit=$?"`, so the reported status came from `echo`, not from yarn. Every command in this checkpoint was re-run with its real exit code captured.

## Targeted validation

| Command | Scope | Result |
|---|---|---|
| `npx tsc --noEmit -p tsconfig.json` | `@open-mercato/core` | ✅ exit 0, no diagnostics |
| `npx jest src/modules/sales` | the whole sales module | ✅ **97 suites passed, 722 tests passed**, 0 failed |
| `npx jest src/modules/sales/lib/__tests__/calculations.test.ts` | the changed engine | ✅ 28 passed (13 pre-existing + 15 new) |

Before the generated registries existed, the same sales run reported `2 failed, 95 passed` — both failures were `Could not locate module #generated/entities/sales_shipment` / `sales_channel`, i.e. missing generated files, not the change. Both suites pass now.

## Negative control — do the new tests actually catch the bug?

A test that passes against the unfixed code locks in nothing, so the engine source was reverted to its pre-fix state (`git show 19be24efc:…/calculations.ts`) and the new suite re-run against it:

```
Tests: 10 failed, 18 passed, 28 total
```

**10 of the 15 new tests fail against the unfixed engine**, including the stored-line-total case, the percentage-first heal, the D3 zero case, the five-pass round trip and the #3757 document-level assertion. The 5 that pass either way cover behaviour the change deliberately preserves — a caller-supplied amount still multiplying by quantity, and the no-discount case. The source was restored immediately afterwards and verified identical to `HEAD`.

## What changed in the covered Steps

- **Phase 0** — the spec now reads `Status: approved — implementation in progress`, carries a `## Decision Record` for D1–D6, and gained the `## Implementation Plan` it never had. That absence is why no automation could implement this spec before today.
- **Phase 1** — `SalesLineDiscountBasis` plus two optional snapshot fields; `buildBaseLineResult` delegates to a new `resolveLineDiscountTotal` that puts the percentage first and only multiplies by quantity on the path where the value genuinely arrived per unit. The clamp bounds are untouched.
- **Phase 2** — one shared `mapOrderLineEntityToSnapshot` in `lib/lineSnapshots.ts`, tagging every rebuilt snapshot `discountAmountFromStoredRow: true`. Both command files import it; the byte-for-byte duplicate in `commands/returns.ts` is gone, which is what stops the three persisting return flows from writing inflated order header totals.
- **Phase 3** — `discountAmountBasis` on the shared `linePricingSchema` only, and a `resolveUpsertDiscountFields` helper applied at both upsert sites so origin is decided per operand rather than per expression.

## Deviations worth flagging to review

1. **The shared mapper uses the stricter `toNumeric`.** The two duplicated copies differed: the `returns.ts` one guarded numbers with `Number.isFinite`, the `documents.ts` one did not. The shared implementation keeps the guarded version, so a `NaN` reaching the documents path now yields `0` instead of propagating. Values arrive from `numeric` columns as strings, so this is not reachable in practice, but it is a real (and safer) behaviour change rather than a pure move.
2. **`mapQuoteLineEntityToSnapshot` was folded into the same shared implementation** (Step 2.4). Both mappers were identical apart from their parameter type, so they now share one private `mapPersistedLine` and keep separate typed entry points.
3. **Step 3.3 landed with 3.2.** The per-operand split is one shared helper applied at two call sites, so splitting it across two commits would have meant committing the order path calling a helper the quote path duplicated — precisely the shape this change removes.

## UI

Not exercised. No rendered surface has changed yet; the only UI file in scope, `SalesOrderDraftLines.tsx`, is Step 5.1 and has not been touched.

## Next

Phase 4 — the command-level tests, starting with Step 4.1.
