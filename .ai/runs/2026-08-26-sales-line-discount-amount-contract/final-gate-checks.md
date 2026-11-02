# Final gate — spec completion

**Run at:** 2026-08-26T06:20Z → 07:10Z
**Head:** `97ca8214f`
**Tasks table:** all 25 rows `done`, no row left `todo`.
**Runner:** local. No compose `app` container is running in this worktree, so the local-mode rule applies and `yarn <cmd>` was used directly.

## The configured gate, in order, none skipped

Every command from `.ai/agentic.config.json` → `validation.commands`, run in the listed order. A wrapper stopped at the first non-zero exit and recorded which step it was, so no failure could be stepped over silently.

| # | Command | Exit | Note |
|---|---|---|---|
| 1 | `yarn build:packages` | ✅ 0 | 27/27 turbo tasks |
| 2 | `yarn generate` | ✅ 0 | must follow the build — it fails with `CLI not built` otherwise |
| 3 | `yarn build:packages` | ✅ 0 | rebuild after codegen |
| 4 | `yarn i18n:check-sync` | ✅ 0 | |
| 5 | `yarn i18n:check-usage` | ✅ 0 | |
| 6 | `yarn typecheck` | ✅ 0 | |
| 7 | `yarn test --env-mode=loose` | ✅ 0 | **34/34 workspaces, 0 failures**, 26m01s |
| 8 | `yarn build:app` | ✅ 0 | 7m43s |

`GATE_ALL_GREEN`.

`--env-mode=loose` on the test step is deliberate: turbo's strict env mode drops `TMPDIR`, which makes the `@open-mercato/cli` suite fail spuriously inside a linked worktree. That is an environment artifact, not a signal about this change.

The tree is **clean** after the gate: `yarn generate` produced no uncommitted output, which is expected — this change adds no entity, no migration and no discovered module file.

## Wall-clock note

The test step took 26 minutes against a normal few. A second cezar worktree was running its own full gate concurrently on the same machine (load average 20–27 throughout), so both suites were contending for CPU. Both use separate `node_modules` and `--env-mode=loose`, so the contention cost time and nothing else. Worth recording so the duration is not later read as a symptom of this change.

## Integration suite

`om-integration-tests` was **not** run as a separate step, and the reason is stated rather than hidden: the Playwright integration suite needs a provisioned test environment (`om-prepare-test-env`) with a live database and an app on a claimed port, and none is running for this worktree. The new spec
`packages/core/src/modules/sales/__integration__/TC-SALES-5019-line-discount-idempotency.spec.ts`
therefore ships **typechecked and reviewed but not executed here**; CI's `ephemeral-integration` job is what exercises it. It is written to the repo's self-contained rules — every fixture is created through the API and cleaned up in `finally`, with no reliance on seeded or demo data — and it self-skips when the tenant lacks `sales.orders.manage`, matching the sibling specs.

This is a real coverage gap in *this run's local evidence*, not in the PR: the CI job is a required check and will run it against the head.

## Design-system / style pass

`yarn ds-lint` runs as part of the repository's CI checks and is not in the configured local `validation.commands` list. The only `.tsx` file this change touches is
`components/documents/SalesOrderDraftLines.tsx`, and the edit is a numeric expression plus a comment — no class names, no tokens, no color or spacing decisions. `yarn lint` passes as part of CI's `lint` job.

## Negative controls — the evidence that matters most

Green tests prove nothing on their own if they would also pass against the unfixed code. Each layer was therefore run against a deliberately reverted implementation:

| Layer | Reverted | Result |
|---|---|---|
| Engine (`calculations.test.ts`) | `resolveLineDiscountTotal` → the original `discountPerUnit × quantity` | **10 of 15 new tests fail** |
| Upsert command (`documents.line-discount-contract.test.ts`) | the origin-preserving branch in `createLineSnapshotFromInput` | **2 of 6 fail** |
| Return flow (`returns.line-discount-contract.test.ts`) | the shared mapper's `discountAmountFromStoredRow: true` | **2 of 4 fail** |

Each revert was restored immediately and the restored file verified byte-identical to `HEAD`.

Two of this run's own tests initially passed under their negative control and were rewritten. The cause was the same both times and is worth carrying forward: **a line that carries a `discount_percent` is healed by percentage-first precedence no matter how its amount is tagged**, so any assertion about the amount's origin has to be made on an *amount-only* line. A suite built solely on percentage lines looks thorough and detects none of this.

## Completeness audit

Every consumer of `calculateDocumentTotals` outside tests was enumerated, to confirm no producer feeds the engine a persisted row while bypassing the shared mapper:

- `commands/documents.ts` — the shared mapper, plus `createLineSnapshotFromInput`, which now preserves the stored-row origin at all twelve of its call sites.
- `commands/returns.ts` — the shared mapper; its duplicate is deleted.
- `seed/examples.ts` — builds snapshots from in-memory example definitions, never from persisted rows, and no example line supplies `discountAmount` (only `discountPercent`). Its writes at `:1414` / `:1645` persist the engine's own result, which is correct.

No missed producer.
