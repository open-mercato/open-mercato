# Final gate — all 31 in-scope Steps complete

**Date:** 2026-09-19
**Branch:** feat/pluggable-tax-providers
**Scope:** Phases 1, 2, 3, 4 and 6. **Phase 5 deferred by the owner** (Steps 5.1–5.5 are `deferred` in PLAN.md).
**Runner:** local (`yarn X`) — no compose `app` container is running.

## The configured `validation.commands` gate, in order

| # | Command | Result |
|---|---|---|
| 1 | `yarn build:packages` | ✅ 38/38 |
| 2 | `yarn generate` | ✅ clean; `git status` shows no generated drift |
| 3 | `yarn build:packages` | ✅ 38/38 (FULL TURBO) |
| 4 | `yarn i18n:check-sync` | ✅ all 5 locales in sync |
| 5 | `yarn i18n:check-usage` | ✅ **0 missing keys** (4253 unused — pre-existing, advisory) |
| 6 | `yarn typecheck` | ✅ 38/38 |
| 7 | `yarn test` | ⚠️ see below |
| 8 | `yarn build:app` | ✅ built in 2m36s |

### Step 5 caught a real gap in this branch

`yarn i18n:check-usage` reported one missing key: `sales.audit.documents.recalculateTax`, referenced
by the `sales.documents.recalculate_tax` command's audit label. Added in all five locales. Re-run
reports zero missing keys.

### Step 7 — `yarn test`

- **`@open-mercato/core`: ✅ 1938 suites, 17,454 tests passing** (1 suite / 2 tests skipped, both pre-existing).
- Every other package green.
- **`@open-mercato/cli`: 5 failing tests, pre-existing and unrelated.**
  `src/lib/__tests__/resolve-environment.test.ts` (1) and `src/lib/__tests__/resolver.enterprise.test.ts` (4).
  **Reproduced on `origin/develop` in this same worktree** with identical messages — `resolveEnvironment`
  reports `monorepo` where the test expects `standalone`, because the temporary directory it creates
  resolves upward into this monorepo. This branch touches no file under `packages/cli`.

## Integration suite

**Not run.** `omw up --fresh` reported ready but left the database empty and did not wire
`apps/mercato/.env` to it; after completing `yarn db:migrate` + `yarn initialize` by hand against the
task's own isolated `om_task1` database, the running dev server still could not authenticate the
seeded admin (encrypted `users.email` values do not match the key the running process holds). This is
worktree provisioning, not the change.

Six Playwright acceptance specs ship with the branch and will run in CI:
`TC-SALES-TAX-001` … `TC-SALES-TAX-006`, plus the shared helper
`__integration__/helpers/taxProvider.ts`. Each is self-contained, creates every record it reads, and
restores the organization's provider selection in a `finally` block.

## Database-level verification of both migrations

The riskiest artifact was verified directly against Postgres rather than asserted:

- All **20** document tax columns across the four `sales_*` tables (3 orders / 4 quotes / 5 invoices /
  5 credit memos), matching the per-table asymmetry.
- All **4** partial `*_tax_transaction_ref_idx` indexes.
- `yarn initialize` completed on the migrated schema, so a first run is not broken.
- `yarn db:generate` reports `sales: no changes` and `customers: no changes` — both snapshots are
  consistent with their entities.

## Style compliance

- `yarn i18n:check-hardcoded`: neither new component (`TaxBreakdownSection`, `TaxProviderSettings`)
  reports a hardcoded string.
- Both new components use semantic DS tokens only — no hardcoded Tailwind status colors, no arbitrary
  values, no `dark:` overrides.
- Every icon-only affordance carries an `aria-label`; the collapse toggle carries `aria-expanded`.
